"""One-shot, read-only Jobs/Unity Catalog imports. No background telemetry polling."""
import hashlib
import json
import time
from uuid import uuid4
import httpx
from .models import Attempt, LakeObject, Route, Workspace
from .estimates import DAY_MS, HistoricalAttempt, estimate_duration


class ImportFailure(Exception):
    pass


class DatabricksReader:
    def __init__(self, settings, token, transport=None):
        self.settings = settings
        self.client = httpx.Client(base_url=settings['host'], headers={'Authorization': f'Bearer {token}'},
                                   timeout=30, follow_redirects=False, transport=transport, trust_env=False)

    def get(self, path, params=None):
        # Paths are application constants. Neither response URLs nor user input can redirect credentials.
        for retry in range(3):
            try:
                r = self.client.get(path, params=params)
            except httpx.HTTPError:
                raise ImportFailure('The workspace could not be reached. Check the URL and network access.') from None
            if r.status_code in (429, 503) and retry < 2:
                time.sleep(min(2 ** retry, 4))
                continue
            if r.status_code == 401:
                raise ImportFailure('Databricks rejected the token. Check its value and expiry.')
            if r.status_code == 403:
                raise ImportFailure('The token does not have permission to read this metadata.')
            if r.status_code != 200:
                raise ImportFailure(f'Databricks metadata request failed (HTTP {r.status_code}).')
            try:
                return r.json()
            except ValueError:
                raise ImportFailure('Databricks returned an invalid metadata response.') from None

    def pages(self, path, key, params=None):
        query = dict(params or {})
        seen = set()
        for _ in range(1000):
            data = self.get(path, query)
            yield from data.get(key, [])
            token = data.get('next_page_token')
            if not token:
                return
            if token in seen:
                raise ImportFailure('Repeated pagination token; capture was not saved.')
            seen.add(token)
            query['page_token'] = token
        raise ImportFailure('Import exceeds the local page limit; capture was not saved.')

    def test(self):
        self.get('/api/2.2/jobs/runs/list', {'limit': 1})

    def inventory(self, at):
        objects, schemas, warnings = [], [], []
        ws = self.settings['id']
        metastore = f'unresolved:{ws}'
        try:
            metastore = self.get('/api/2.1/unity-catalog/metastore_summary').get('metastore_id') or metastore
            for catalog in self.pages('/api/2.1/unity-catalog/catalogs', 'catalogs', {'max_results': 0}):
                name = catalog['name']
                schemas.append({'metastore_id': metastore, 'catalog': name, 'schema_name': None})
                try:
                    for schema in self.pages('/api/2.1/unity-catalog/schemas', 'schemas', {'catalog_name': name, 'max_results': 0}):
                        sn = schema['name']
                        schemas.append({'metastore_id': metastore, 'catalog': name, 'schema_name': sn})
                        try:
                            for table in self.pages('/api/2.1/unity-catalog/tables', 'tables',
                                                    {'catalog_name': name, 'schema_name': sn, 'max_results': 0}):
                                full = table.get('full_name') or f"{name}.{sn}.{table['name']}"
                                objects.append(LakeObject(id=f'{metastore}:{full}', metastore_id=metastore,
                                    catalog=name, schema_name=sn, name=table['name'], type='view' if 'VIEW' in table.get('table_type', '') else 'table',
                                    workspace_ids=[ws], position=(0, 0, 0), source_id=f'uc:{full}', observed_at=at,
                                    provenance='unity_catalog_api').model_dump())
                        except ImportFailure as e:
                            warnings.append(f'Tables in {name}.{sn}: {e}')
                except ImportFailure as e:
                    warnings.append(f'Schemas in {name}: {e}')
        except ImportFailure as e:
            warnings.append(f'Catalog inventory unavailable: {e}')
        return metastore, objects, schemas, warnings

    def runs(self, start, end):
        # Scan retained history, then test interval overlap. A start-time-only filter
        # would silently omit long runs that started before this 24-hour window.
        for parent in self.pages('/api/2.2/jobs/runs/list', 'runs',
                {'limit': 100, 'expand_tasks': 'true', 'start_time_to': end}):
            started, ended = parent.get('start_time', 0), parent.get('end_time', 0)
            if started > end or (ended and ended < start):
                continue
            detail = self.get('/api/2.2/jobs/runs/get', {'run_id': parent['run_id'], 'include_history': 'true'})
            tasks = list(detail.get('tasks', []))
            repairs = list(detail.get('repair_history', []))
            page, seen = detail.get('next_page_token'), set()
            while page:
                if page in seen or len(seen) >= 1000:
                    raise ImportFailure('Task pagination did not complete; capture was not saved.')
                seen.add(page)
                data = self.get('/api/2.2/jobs/runs/get', {'run_id': parent['run_id'], 'page_token': page, 'include_history': 'true'})
                tasks.extend(data.get('tasks', []))
                repairs.extend(data.get('repair_history', []))
                page = data.get('next_page_token')
            # Repair history contains prior task run IDs; fetch their actual records.
            known = {str(t.get('run_id')) for t in tasks}
            for repair in repairs:
                for task_id in repair.get('task_run_ids', []):
                    if str(task_id) not in known:
                        tasks.append(self.get('/api/2.2/jobs/runs/get', {'run_id': task_id}))
                        known.add(str(task_id))
            yield detail, tasks or [detail]

    def close(self):
        self.client.close()


def phase_for(state):
    result = state.get('result_state')
    if result in ('SUCCESS', 'SUCCEEDED'): return 'succeeded'
    if result in ('FAILED', 'TIMEDOUT', 'ERROR', 'MAXIMUM_CONCURRENT_RUNS_REACHED', 'ERROR_WITH_PARTIAL_SUCCESS', 'TIMED_OUT', 'UPSTREAM_FAILED'): return 'failed'
    if result in ('CANCELED', 'CANCELLED'): return 'cancelled'
    if state.get('life_cycle_state') in ('PENDING', 'QUEUED', 'WAITING_FOR_RETRY', 'BLOCKED'): return 'queued'
    if state.get('life_cycle_state') in ('RUNNING', 'TERMINATING'): return 'running'
    return 'unknown'


def build_capture(credentials, end=None, reader_factory=DatabricksReader):
    end = int(time.time() * 1000) if end is None else end
    if any(s.get('import_source') == 'system_tables' for s, _ in credentials):
        if len(credentials) != 1:
            raise ImportFailure('Select one integration workspace for the system-table import.')
        from .system_import import build_system_capture
        return build_system_capture(*credentials[0], end=end)
    start, capture_id = end - DAY_MS, uuid4().hex
    objects, schemas, workspaces, events, warnings = {}, {}, [], [], []
    records = {}
    for settings, token in credentials:
        reader = reader_factory(settings, token)
        try:
            reader.test()
            meta, tables, structure, notes = reader.inventory(end)
            warnings.extend(f"{settings['name']}: {n}" for n in notes)
            for o in tables:
                if o['id'] in objects:
                    o['workspace_ids'] = sorted(set(objects[o['id']]['workspace_ids'] + o['workspace_ids']))
                objects[o['id']] = o
            for entry in structure:
                schemas[json.dumps(entry, sort_keys=True)] = entry
            workspaces.append(Workspace(account_id='local-replay', id=settings['id'], name=settings['name'], host=settings['host'],
                region=settings['region'], metastore_id=meta, status='connected', last_successful_poll=end,
                lineage_observed_at=None, reason='Historical import; task routes use optional explicit mappings.').model_dump())
            for parent, tasks in reader.runs(start, end):
                for task in tasks:
                    job, run, task_run = str(parent.get('job_id', 'unknown')), str(parent['run_id']), str(task.get('run_id', parent['run_id']))
                    attempt_no = int(task.get('attempt_number', parent.get('attempt_number', 0)))
                    ident = json.dumps([settings['id'], job, run, task_run, attempt_no], separators=(',', ':'))
                    launched = task.get('start_time') or None
                    finished = task.get('end_time') or None
                    if launched and launched > end or finished and finished < start:
                        continue
                    key = task.get('task_key') or parent.get('task_key') or 'main'
                    mapping = next((r for r in settings['routes'] if r['job_id'] == job and r['task_key'] == key), None)
                    def ids(names):
                        resolved = [o['id'] for o in tables if f"{o['catalog']}.{o['schema_name']}.{o['name']}" in names]
                        if len(resolved) != len(set(names)):
                            warnings.append(f"{settings['name']} / {key}: some mapped tables are absent from the authorized inventory.")
                        return resolved
                    sources, targets, external = [], [], None
                    if mapping:
                        sources, targets = ids(mapping['source_tables']), ids(mapping['target_tables'])
                        external = mapping.get('external_source')
                    kind = 'plane' if external and targets else 'ship' if len(sources) == 1 and targets else 'buoy'
                    supported = bool(mapping and (sources or targets))
                    route = Route(version=f'{capture_id}:configured', evidence='configured' if supported else 'unknown',
                        source_ids=sources, target_ids=targets, external_source=external, source_record_ids=[f'configuration:{settings["id"]}:{job}:{key}'] if supported else [],
                        observed_at=end, provenance='user_mapping' if supported else 'unresolved').model_dump()
                    state = task.get('state', {})
                    settings_signature = {k: v for k, v in task.items() if k.endswith('_task') or k in ('existing_cluster_id', 'new_cluster', 'job_cluster_key')}
                    signature = hashlib.sha256(json.dumps([settings['id'], job, key, settings_signature, parent.get('job_clusters', [])], sort_keys=True).encode()).hexdigest()
                    records[ident] = dict(id=ident, workspace_id=settings['id'], job_id=job, run_id=run, task_run_id=task_run,
                        task_key=key, attempt_number=attempt_no, name=f"{parent.get('run_name', 'Job ' + job)} · {key}", kind=kind,
                        phase=phase_for(state), raw_state=state.get('result_state') or state.get('life_cycle_state') or 'UNKNOWN',
                        started_at=launched, ended_at=finished, observed_at=end, account_id='local-replay',
                        source_id=f'jobs-api:{settings["id"]}:{task_run}', provenance='jobs_api_history', route=route,
                        native_url=parent.get('run_page_url'), signature=signature,
                        queued_at=max(start, parent.get('start_time') or start))
        finally:
            reader.close()
    return finish_capture(records.values(), list(objects.values()), list(schemas.values()), workspaces,
                          warnings, start, end, capture_id, 'local-replay', 'jobs_api_start_time',
                          'Historical states reconstructed from Jobs API start/end times. Intermediate states were not polled. Routes require explicit task mappings.')


def finish_capture(records, objects, schemas, workspaces, warnings, start, end, capture_id,
                   account_id, timing_basis, history_note):
    records = [dict(r) for r in records]
    events = []
    history = [HistoricalAttempt(r['signature'], r['ended_at'], r['ended_at'] - r['started_at'], r['phase'])
               for r in records if r['ended_at'] and r['started_at'] and r['ended_at'] > r['started_at']]
    for r in records:
        signature, queued_at = r.pop('signature'), r.pop('queued_at')
        estimate = estimate_duration(history, signature, r['started_at'] or end, f'{capture_id}:prior-successes')
        estimate.timing_basis = timing_basis
        a = Attempt(**r, estimate=estimate)
        if a.started_at is not None:
            running = a.model_copy(update={'phase': 'running', 'raw_state': 'REPLAY_RUNNING', 'ended_at': None, 'collection_stale_at': None})
            events.append((a.started_at, running))
        if a.ended_at is not None and a.ended_at <= end:
            events.append((a.ended_at, a))
        elif a.started_at is None:
            events.append((queued_at, a))
        elif a.collection_stale_at is not None:
            events.append((a.collection_stale_at, a))
    envelopes = [dict(event_id=f'{capture_id}:{i}', schema_version=1, sequence=i + 1, account_id=account_id,
        workspace_id=a.workspace_id, execution_attempt_id=a.id, event_time=t, observed_at=end,
        type='attempt.upsert', payload=a.model_dump()) for i, (t, a) in enumerate(sorted(events, key=lambda e: (e[0], e[1].id)))]
    checkpoint = dict(mode='replay', capture_id=capture_id, captured_at=end, account_id=account_id, server_time=start,
        cursor=0, range={'start': start, 'end': end}, objects=objects, inventory=schemas,
        attempts=[], workspaces=workspaces, gaps=[], warnings=list(dict.fromkeys(warnings)),
        history_note=history_note)
    for e in envelopes:
        if e['event_time'] <= start:
            checkpoint['attempts'] = [a for a in checkpoint['attempts'] if a['id'] != e['payload']['id']] + [e['payload']]
            checkpoint['cursor'] = e['sequence']
    return dict(mode='replay', checkpoint=checkpoint, events=[e for e in envelopes if start < e['event_time'] <= end],
                retention_days=1, available_duration_ms=DAY_MS)


def scene_at(capture, at):
    cp = capture['checkpoint']
    attempts = {a['id']: a for a in cp['attempts']}
    cursor = cp['cursor']
    for e in capture['events']:
        if e['event_time'] <= at:
            attempts[e['execution_attempt_id']] = e['payload']
            cursor = max(cursor, e['sequence'])
    return {**cp, 'attempts': list(attempts.values()), 'server_time': at, 'cursor': cursor}
