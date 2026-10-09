"""Invented, deterministic examples. Never represent these as live telemetry."""
from copy import deepcopy
from datetime import datetime, timezone
from .estimates import HistoricalAttempt, estimate_duration
from .models import Attempt, LakeObject, Route, SceneEvent, Workspace

BASE = int(datetime(2026, 10, 8, 16, tzinfo=timezone.utc).timestamp() * 1000)
END = BASE + 86_400_000
REFERENCE = BASE + 600_000
SCHEMAS = [
    ("sales", "raw", (-8, 0, -4)), ("sales", "refined", (-8, 0, 4)),
    ("operations", "events", (0, 0, -5)), ("operations", "metrics", (0, 0, 5)),
    ("finance", "ledger", (8, 0, -4)), ("finance", "reporting", (8, 0, 4)),
]


def topology() -> list[LakeObject]:
    names = [["orders", "customers", "returns"], ["orders", "customers", "daily_sales"],
             ["clickstream", "inventory", "shipments"], ["fulfillment", "sessions", "daily_ops"],
             ["payments", "accounts", "invoices"], ["revenue", "balances", "forecast"]]
    return [LakeObject(id=f"demo-metastore:{catalog}.{schema}.{name}", metastore_id="demo-metastore",
                       catalog=catalog, schema_name=schema, name=name,
                       workspace_ids=["ws-east", "ws-west"],
                       position=(pos[0] + (i - 1) * .75, .18, pos[2]),
                       source_id=f"fixture:table:{catalog}.{schema}.{name}", observed_at=BASE)
            for (catalog, schema, pos), tables in zip(SCHEMAS, names) for i, name in enumerate(tables)]


def workspaces() -> list[Workspace]:
    metastores = {"canadacentral": "demo-metastore", "westus2": "demo-us-metastore", "westeurope": "demo-eu-metastore"}
    return [Workspace(id=id, name=name, region=region, metastore_id=metastores[region],
                      status=status, last_successful_poll=BASE,
                      lineage_observed_at=BASE - 300_000, reason=reason)
            for id, name, region, status, reason in [
                ("ws-east", "Production East", "canadacentral", "connected", None),
                ("ws-west", "Production West", "canadacentral", "connected", None),
                ("ws-eu", "Analytics Europe", "westeurope", "connected", None),
                ("ws-lab", "Research Lab", "canadacentral", "restricted", "Jobs read permission is missing."),
                ("ws-sandbox", "Sandbox", "westus2", "excluded", "Excluded from demo collection scope."),
            ]]


def oid(name: str) -> str:
    return f"demo-metastore:{name}"


def events() -> list[SceneEvent]:
    rows: list[SceneEvent] = []

    def add(time: int, typ: str, ws: str, payload: dict, attempt_id: str | None = None):
        rows.append(SceneEvent(event_id=f"demo-v4:{typ}:{ws}:{attempt_id}:{time}:{len(rows)}",
                               workspace_id=ws, execution_attempt_id=attempt_id,
                               event_time=BASE + time * 1000, observed_at=BASE + time * 1000,
                               type=typ, payload=payload))

    specs = [
        ("ingest-orders", "Ingest commerce events", "ws-east", "plane", 440, 240, 700, "succeeded", [], ["sales.raw.orders", "operations.events.clickstream", "finance.ledger.payments"], "configured", "Azure Event Hubs", 0),
        ("refine-orders", "Enrich customer orders", "ws-east", "ship", 210, 300, 920, "succeeded", ["sales.raw.orders"], ["sales.refined.orders"], "observed", None, 0),
        ("ingest-inventory", "Sync inventory", "ws-west", "plane", 480, 360, 860, "succeeded", [], ["operations.events.inventory"], "configured", "Supplier API", 0),
        ("fulfillment", "Build fulfillment metrics", "ws-west", "ship", 390, 420, 780, "succeeded", ["operations.events.shipments"], ["operations.metrics.fulfillment"], "historical", None, 0),
        ("payments", "Reconcile payments", "ws-east", "ship", 350, 360, 520, "failed", ["finance.ledger.payments"], ["finance.reporting.revenue"], "observed", None, 0),
        ("payments-retry", "Reconcile payments · retry", "ws-east", "ship", 580, 360, 980, "succeeded", ["finance.ledger.payments"], ["finance.reporting.revenue"], "observed", None, 1),
        ("daily-sales", "Aggregate daily sales", "ws-west", "buoy", 470, 480, 1100, "succeeded", ["sales.refined.orders", "sales.refined.customers"], ["sales.refined.daily_sales"], "observed", None, 0),
        ("forecast", "Refresh revenue forecast", "ws-eu", "buoy", 300, 540, 1200, "succeeded", [], [], "unknown", None, 0),
        ("unknown", "Ad hoc reconciliation", "ws-west", "buoy", 550, None, 1000, "cancelled", [], [], "unknown", None, 0),
        ("queued-sessions", "Compact session events", "ws-east", "ship", 660, 300, 1080, "succeeded", ["operations.events.clickstream"], ["operations.metrics.sessions"], "configured", None, 0),
        ("short-run", "Update account balances", "ws-east", "ship", 105, 60, 113, "succeeded", ["finance.ledger.accounts"], ["finance.reporting.balances"], "observed", None, 0),
    ]
    for index, (id, name, ws, kind, start, duration, finish, result, sources, targets, evidence, external, retry) in enumerate(specs):
        signature = f"{ws}:job-{index if not retry else 4}:reconcile:incremental:v1"
        launch = BASE + start * 1000
        history = [HistoricalAttempt(signature, BASE - (i + 1) * 86_400_000,
                                     int(duration * (0.8 + (i % 5) * .1) * 1000)) for i in range(12)] if duration else []
        estimate = estimate_duration(history, signature, launch, "demo-cohort-v1")
        a = Attempt(id=id, workspace_id=ws, job_id=str(2400 + (4 if retry else index)),
                    run_id=str(88000 + (4 if retry else index)), task_run_id=str(99000 + index),
                    task_key=id.replace("-retry", ""), attempt_number=retry, name=name, kind=kind,
                    phase="queued", raw_state="PENDING", started_at=None,
                    observed_at=BASE + (start - 40) * 1000, source_id=f"fixture:task:{id}",
                    route=Route(version=f"{id}:route-v2", evidence=evidence,
                                source_ids=[oid(n) for n in sources], target_ids=[oid(n) for n in targets],
                                external_source=external, source_record_ids=[f"fixture:route:{id}"] if evidence != "unknown" else [],
                                observed_at=launch), estimate=estimate)
        add(start - 40, "attempt.upsert", ws, a.model_dump(), id)
        a.phase, a.raw_state, a.started_at, a.observed_at = "running", "RUNNING", launch, launch
        add(start, "attempt.upsert", ws, a.model_dump(), id)
        if id == "forecast":
            a.collection_stale_at = BASE + 560_000
            a.observed_at = BASE + 515_000
            add(560, "attempt.upsert", ws, a.model_dump(), id)
            a.collection_stale_at = None
            a.observed_at = BASE + 900_000
            add(900, "attempt.upsert", ws, a.model_dump(), id)
        a.phase, a.raw_state, a.ended_at, a.observed_at = result, result.upper(), BASE + finish * 1000, BASE + finish * 1000
        add(finish, "attempt.upsert", ws, a.model_dump(), id)
    for t in range(15, 1801, 15):
        for ws in ("ws-east", "ws-west", "ws-eu"):
            if ws == "ws-eu" and 515 < t < 900:
                continue
            add(t, "coverage.update", ws, {"status": "connected", "last_successful_poll": BASE + t * 1000,
                "lineage_observed_at": BASE + (t - 300) * 1000, "reason": None})
    add(560, "coverage.update", "ws-eu", {"status": "stale", "reason": "Three consecutive polls missed; motion is frozen."})
    add(560, "collection.gap", "ws-eu", {"start": BASE + 515_000, "end": BASE + 900_000,
                                         "reason": "Demo network outage; task state reconciled at recovery."})
    first_hour = deepcopy(rows)
    for hour in range(1, 24):
        offset = hour * 3_600_000
        for original in first_hour:
            e = original.model_copy(deep=True)
            e.event_id = f'{original.event_id}:hour-{hour}'
            e.event_time += offset
            e.observed_at += offset
            if e.execution_attempt_id:
                e.execution_attempt_id += f':hour-{hour}'
                e.payload['id'] = e.execution_attempt_id
                e.payload['run_id'] = str(int(e.payload['run_id']) + hour * 100)
                e.payload['task_run_id'] = str(int(e.payload['task_run_id']) + hour * 100)
                for key in ('started_at', 'ended_at', 'observed_at', 'collection_stale_at'):
                    if e.payload.get(key) is not None: e.payload[key] += offset
                e.payload['route']['observed_at'] += offset
            elif e.type == 'coverage.update':
                for key in ('last_successful_poll', 'lineage_observed_at'):
                    if e.payload.get(key) is not None: e.payload[key] += offset
            elif e.type == 'collection.gap':
                e.payload['start'] += offset
                e.payload['end'] += offset
            rows.append(e)
    return sorted(deepcopy(rows), key=lambda e: (e.event_time, e.event_id))
