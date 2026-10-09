import os
from threading import Lock
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from . import fixtures
from .store import EventStore
from .connections import ConnectionInput, ReplayRepository
from .replay_import import DatabricksReader, ImportFailure, build_capture, scene_at


def snapshot(store: EventStore, at: int) -> dict:
    attempts, gaps = {}, []
    coverage = {w.id: w.model_dump() for w in fixtures.workspaces()}
    cursor = 0
    for event in store.read(at):
        cursor = event.sequence
        if event.type == "attempt.upsert":
            previous = attempts.get(event.execution_attempt_id)
            if previous is None or event.payload["observed_at"] >= previous["observed_at"]:
                attempts[event.execution_attempt_id] = event.payload
        elif event.type == "coverage.update":
            coverage[event.workspace_id].update(event.payload)
        elif event.type == "collection.gap":
            gaps.append({**event.payload, "workspace_id": event.workspace_id})
    return {"mode": "demo", "capture_id": fixtures.CAPTURE_ID, "captured_at": fixtures.END, "warnings": [],
            "history_note": f"Simulated 24-hour capture: {fixtures.JOB_RUN_COUNT} job runs plus one repair attempt. Names follow workspace conventions. All job data is invented.",
            "account_id": "t1a-demo", "server_time": at, "cursor": cursor,
            "range": {"start": fixtures.BASE, "end": fixtures.END},
            "objects": [o.model_dump() for o in fixtures.topology()],
            "attempts": list(attempts.values()), "workspaces": list(coverage.values()), "gaps": gaps}


def create_app(db_path: str | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if os.environ.get("LAKE_MODE", "demo") != "demo":
            raise RuntimeError("Live collection is not enabled. Configure and test viewer authorization before adding real metadata.")
        path = db_path or os.environ.get("LAKE_DB_PATH", f".data/{fixtures.CAPTURE_ID}-{fixtures.STORE_REVISION}.sqlite")
        store = EventStore(path)
        store.append_many(fixtures.events())
        app.state.store = store
        app.state.repository = ReplayRepository(str(Path(path).parent / 'replay-settings.sqlite'))
        app.state.import_lock = Lock()
        yield
        store.close()
        app.state.repository.close()

    app = FastAPI(title="SimLake API", version="0.1.0", lifespan=lifespan)

    @app.middleware('http')
    async def local_api_only(request: Request, call_next):
        if request.url.path.startswith('/api/'):
            host = request.url.hostname
            client = request.client.host if request.client else None
            origin = request.headers.get('origin')
            same_origin = not origin or origin.rstrip('/') == str(request.base_url).rstrip('/') or origin in ('http://127.0.0.1:5173', 'http://localhost:5173')
            if client not in ('127.0.0.1', '::1') or host not in ('localhost', '127.0.0.1', '::1') or not same_origin:
                return JSONResponse({'detail': 'This replay tool is available only on the local machine and same origin.'}, status_code=403)
        response = await call_next(request)
        if request.url.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.exception_handler(RequestValidationError)
    async def private_validation(request, exc):
        # Pydantic normally echoes invalid input, which could include a token.
        return JSONResponse({'detail': [{'loc': e['loc'], 'msg': e['msg'], 'type': e['type']} for e in exc.errors()]}, status_code=422)

    def stored_capture(request, capture=None):
        if capture == fixtures.CAPTURE_ID: return None
        value = request.app.state.repository.capture(capture)
        if capture and value is None: raise HTTPException(404, 'Replay capture not found.')
        return value

    def current_scene(request, at=None, capture=None):
        saved = stored_capture(request, capture)
        if saved:
            bounds = saved['checkpoint']['range']
            at = bounds['end'] if at is None else at
            if not bounds['start'] <= at <= bounds['end']:
                raise HTTPException(422, 'Time must be inside the selected capture.')
            return scene_at(saved, at)
        return snapshot(request.app.state.store, at_time(at))

    @app.get('/api/configuration')
    def configuration(request: Request):
        saved = request.app.state.repository.capture()
        return {'connections': request.app.state.repository.list(), 'replay_hours': 24, 'realtime_enabled': False,
                'last_capture': {**{k: saved['checkpoint'][k] for k in ('capture_id', 'captured_at', 'range')},
                                 'simulation': saved['checkpoint'].get('simulation')} if saved else None}

    @app.post('/api/configuration')
    def save_connection(settings: ConnectionInput, request: Request):
        return request.app.state.repository.save(settings)

    @app.delete('/api/configuration/{connection_id}')
    def remove_connection(connection_id: str, request: Request):
        request.app.state.repository.delete(connection_id)
        return {'removed': True}

    @app.post('/api/configuration/{connection_id}/test')
    def test_connection(connection_id: str, request: Request):
        try:
            settings, token = request.app.state.repository.credential(connection_id)
            from .system_import import SystemTablesReader
            system = settings.get('import_source') == 'system_tables'
            reader = (SystemTablesReader if system else DatabricksReader)(settings, token)
            try: reader.test()
            finally: reader.close()
            return {'ok': True, 'message': 'Connected. Regional job history and lineage access verified.' if system else 'Connected. Historical Jobs API access verified.'}
        except (ValueError, ImportFailure) as e:
            raise HTTPException(400, str(e)) from None

    @app.post('/api/replay/import')
    def import_replay(request: Request, connection_id: str | None = None):
        if not request.app.state.import_lock.acquire(blocking=False):
            raise HTTPException(409, 'A replay import is already running.')
        try:
            repo = request.app.state.repository
            settings = repo.list()
            if not settings: raise ValueError('Add a workspace connection first.')
            if connection_id:
                settings = [s for s in settings if s['id'] == connection_id]
                if not settings: raise ValueError('The selected integration workspace was not found.')
            elif len(settings) > 1:
                raise ValueError('Select one integration workspace to import account history.')
            credentials = [repo.credential(s['id']) for s in settings]
            capture = build_capture(credentials)
            repo.save_capture(capture)  # Atomic activation; previous capture survives failures.
            return capture
        except (ValueError, ImportFailure) as e:
            raise HTTPException(400, str(e)) from None
        finally:
            request.app.state.import_lock.release()

    @app.post('/api/replay/simulate')
    @app.post('/api/replay/simulate/more')
    def simulate_replay(request: Request, capture: str | None = None):
        from .simulation import build_simulation
        additional = request.url.path.endswith('/more')
        if additional and not capture:
            raise HTTPException(400, 'Select a saved capture to add another 80 simulated runs.')
        if not request.app.state.import_lock.acquire(blocking=False):
            raise HTTPException(409, 'A replay import or simulation is already running.')
        try:
            repo = request.app.state.repository
            source = repo.capture(capture)
            if source is None:
                raise ValueError('Import a real workspace replay before adding simulated runs.')
            if source['checkpoint'].get('simulation') and not additional:
                source = repo.capture(source['checkpoint']['simulation']['source_capture_id'])
                if source is None:
                    raise ValueError('The source workspace capture is unavailable. Import it again.')
            result = build_simulation(source, additional=additional)
            existing = repo.capture(result['checkpoint']['capture_id'])
            if existing:
                repo.activate_capture(existing['checkpoint']['capture_id'])
                return existing
            repo.save_capture(result)
            return result
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        finally:
            request.app.state.import_lock.release()

    def at_time(at: int | None) -> int:
        at = fixtures.REFERENCE if at is None else at
        if not fixtures.BASE <= at <= fixtures.END:
            raise HTTPException(422, "Time must be inside the demo capture interval.")
        return at

    @app.get("/api/health")
    def health(request: Request):
        return {"status": "ok", "mode": "replay" if request.app.state.repository.capture() else "demo", "live_collection": False}

    @app.get("/api/scene")
    def scene(request: Request, at: int | None = None, capture: str | None = None):
        return current_scene(request, at, capture)

    @app.get("/api/coverage")
    def coverage(request: Request, at: int | None = None, capture: str | None = None):
        s = current_scene(request, at, capture)
        return {"mode": s['mode'], "workspaces": s["workspaces"], "server_time": s["server_time"]}

    @app.get("/api/events")
    def incremental(request: Request, cursor: int = Query(0, ge=0), at: int | None = None,
                    limit: int = Query(1000, ge=1, le=5000)):
        if request.app.state.repository.capture():
            raise HTTPException(409, 'Historical replay only. Load the fixed capture from /api/replay.')
        store = request.app.state.store
        if not store.valid_cursor(cursor):
            raise HTTPException(409, "Cursor is invalid or expired; request a new scene snapshot.")
        events = store.read(at_time(at), after=cursor, limit=limit + 1)
        return {"events": [e.model_dump() for e in events[:limit]],
                "cursor": events[min(len(events), limit) - 1].sequence if events else cursor,
                "has_more": len(events) > limit}

    @app.get("/api/attempts/{attempt_id}")
    def attempt_detail(attempt_id: str, request: Request, at: int | None = None, capture: str | None = None):
        s = current_scene(request, at, capture)
        attempt = next((a for a in s["attempts"] if a["id"] == attempt_id), None)
        if attempt is None:
            raise HTTPException(404, "Attempt not present at this event time.")
        return attempt

    @app.get("/api/replay")
    def replay(request: Request, start: int | None = None, end: int | None = None, capture: str | None = None):
        saved = stored_capture(request, capture)
        if saved:
            start = saved['checkpoint']['range']['start'] if start is None else start
            end = saved['checkpoint']['range']['end'] if end is None else end
            if not saved['checkpoint']['range']['start'] <= start <= end <= saved['checkpoint']['range']['end']:
                raise HTTPException(422, 'Replay must be inside the selected 24-hour capture.')
            return {**saved, 'checkpoint': {**scene_at(saved, start), 'range': {'start': start, 'end': end}},
                    'events': [e for e in saved['events'] if start < e['event_time'] <= end], 'available_duration_ms': end - start}
        start = fixtures.BASE if start is None else start
        end = fixtures.END if end is None else end
        at_time(start)
        at_time(end)
        if end < start or end - start > 7 * 86_400_000:
            raise HTTPException(422, "Replay requires an ordered interval within the capture.")
        checkpoint = snapshot(request.app.state.store, start)
        return {"mode": "demo", "checkpoint": checkpoint,
                # Replay is ordered by event time, not by an ingestion cursor: a
                # late event can have a higher sequence than future capture events.
                "events": [e.model_dump() for e in request.app.state.store.read(end) if e.event_time > start],
                "retention_days": 1, "available_duration_ms": end - start}

    dist = Path(__file__).resolve().parents[1] / "dist"
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
        if (dist / "brands").exists():
            app.mount("/brands", StaticFiles(directory=dist / "brands"), name="brands")

        @app.get("/")
        def index():
            return FileResponse(dist / "index.html")

    return app


app = create_app()
