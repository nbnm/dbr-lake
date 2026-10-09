"""Invented runs with names modeled on workspace conventions, never live telemetry."""
from copy import deepcopy
from datetime import datetime, timezone
from .estimates import HistoricalAttempt, estimate_duration
from .models import Attempt, LakeObject, Route, SceneEvent, Workspace

BASE = int(datetime(2026, 10, 8, 16, tzinfo=timezone.utc).timestamp() * 1000)
END = BASE + 86_400_000
REFERENCE = BASE + 600_000
CAPTURE_ID = "demo-v5"
# Keep the corrected scenario separate from previously persisted fixture events.
STORE_REVISION = "workspace-names-v1"
JOB_RUN_COUNT = 80
SCHEMAS = [
    ("de_platform_offering", "de_bronze", (-8, 0, -4),
     ["api_tracking_raw", "delivery_performance_raw", "carrier_performance_raw"]),
    ("de_platform_offering", "de_silver", (-8, 0, 4),
     ["api_tracking_parsed", "silver_delivery_performance", "silver_carrier_performance"]),
    ("t1a_sandbox", "antares_raw", (0, 0, -5),
     ["cohort_mthly_add", "cohort_mthly_eop", "cohort_mthly_flow"]),
    ("t1a_sandbox", "antares_sigma", (0, 0, 5),
     ["sales_mthly_flow", "sales_mthly_add", "bv_sales_mthly_add"]),
    ("lakesentry_dev_stg", "ledger", (8, 0, -4),
     ["usage_line_item", "work_unit_run", "warehouse"]),
    ("lakesentry_dev_stg", "metrics", (8, 0, 4),
     ["work_unit_run_cost", "weekly_spend", "query_fact"]),
]


def topology() -> list[LakeObject]:
    return [LakeObject(id=f"demo-metastore:{catalog}.{schema}.{name}", metastore_id="demo-metastore",
                       catalog=catalog, schema_name=schema, name=name,
                       workspace_ids=["ws-east", "ws-west"],
                       position=(pos[0] + (i - 1) * .75, .18, pos[2]),
                       source_id=f"fixture:table:{catalog}.{schema}.{name}", observed_at=BASE)
            for catalog, schema, pos, tables in SCHEMAS for i, name in enumerate(tables)]


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
        rows.append(SceneEvent(event_id=f"{CAPTURE_ID}:{typ}:{ws}:{attempt_id}:{time}:{len(rows)}",
                               workspace_id=ws, execution_attempt_id=attempt_id,
                               event_time=BASE + time * 1000, observed_at=BASE + time * 1000,
                               type=typ, payload=payload))

    specs = [
        ("ingest-orders", "ADF_SimLake_landing_pipeline1_Notebook1", "ws-east", "plane", 440, 240, 700, "succeeded", [], ["de_platform_offering.de_bronze.api_tracking_raw", "t1a_sandbox.antares_raw.cohort_mthly_add", "lakesentry_dev_stg.ledger.usage_line_item"], "configured", "Azure Event Hubs", 0),
        ("refine-orders", "DEPlatform-api_tracking-silver-refresh", "ws-east", "ship", 210, 300, 920, "succeeded", ["de_platform_offering.de_bronze.api_tracking_raw"], ["de_platform_offering.de_silver.api_tracking_parsed"], "observed", None, 0),
        ("ingest-inventory", "ADF_SimLake_cohort_mthly_eop_API_landing", "ws-west", "plane", 480, 360, 860, "succeeded", [], ["t1a_sandbox.antares_raw.cohort_mthly_eop"], "configured", "Sigma API", 0),
        ("fulfillment", "Sigma Demo SimLake-sales_mthly_flow-tables-deploy", "ws-west", "ship", 390, 420, 780, "succeeded", ["t1a_sandbox.antares_raw.cohort_mthly_flow"], ["t1a_sandbox.antares_sigma.sales_mthly_flow"], "historical", None, 0),
        ("payments", "LakeSentry-work_unit_run_cost-refresh", "ws-east", "ship", 350, 360, 520, "failed", ["lakesentry_dev_stg.ledger.usage_line_item"], ["lakesentry_dev_stg.metrics.work_unit_run_cost"], "observed", None, 0),
        ("payments-retry", "LakeSentry-work_unit_run_cost-refresh", "ws-east", "ship", 580, 360, 980, "succeeded", ["lakesentry_dev_stg.ledger.usage_line_item"], ["lakesentry_dev_stg.metrics.work_unit_run_cost"], "observed", None, 1),
        ("daily-sales", "DEPlatform-carrier_performance-silver-refresh", "ws-west", "buoy", 470, 480, 1100, "succeeded", ["de_platform_offering.de_silver.api_tracking_parsed", "de_platform_offering.de_silver.silver_delivery_performance"], ["de_platform_offering.de_silver.silver_carrier_performance"], "observed", None, 0),
        ("forecast", "LakeSentry-query_fact-refresh", "ws-eu", "buoy", 300, 540, 1200, "succeeded", [], [], "unknown", None, 0),
        ("unknown", "ADF_SimLake_validation_pipeline1_Notebook1", "ws-west", "buoy", 550, None, 1000, "cancelled", [], [], "unknown", None, 0),
        ("queued-sessions", "Sigma Demo SimLake-sales_mthly_add-tables-deploy", "ws-east", "ship", 660, 300, 1080, "succeeded", ["t1a_sandbox.antares_raw.cohort_mthly_add"], ["t1a_sandbox.antares_sigma.sales_mthly_add"], "configured", None, 0),
        ("short-run", "LakeSentry-weekly_spend-refresh", "ws-east", "ship", 105, 60, 113, "succeeded", ["lakesentry_dev_stg.ledger.work_unit_run"], ["lakesentry_dev_stg.metrics.weekly_spend"], "observed", None, 0),
    ]
    # Seventy further runs cover all remaining hours. Each hour is a small
    # pipeline: API landing, table movement, then an export after its inputs land.
    pipelines = [
        ("tracking", "Tracking API", ["de_platform_offering.de_bronze.api_tracking_raw", "de_platform_offering.de_bronze.delivery_performance_raw"], "de_platform_offering.de_bronze.api_tracking_raw", "de_platform_offering.de_silver.api_tracking_parsed", "Power BI API", "DEPlatform-api_tracking"),
        ("cohort", "Sigma API", ["t1a_sandbox.antares_raw.cohort_mthly_eop"], "t1a_sandbox.antares_raw.cohort_mthly_eop", "t1a_sandbox.antares_sigma.bv_sales_mthly_add", "Sigma API", "Sigma Demo SimLake-bv_sales_mthly_add"),
        ("usage", "Databricks Billing API", ["lakesentry_dev_stg.ledger.usage_line_item", "lakesentry_dev_stg.ledger.warehouse"], "lakesentry_dev_stg.ledger.usage_line_item", "lakesentry_dev_stg.metrics.work_unit_run_cost", "FinOps Object Storage", "LakeSentry-work_unit_run_cost"),
        ("delivery", "Tracking API", ["de_platform_offering.de_bronze.delivery_performance_raw"], "de_platform_offering.de_bronze.delivery_performance_raw", "de_platform_offering.de_silver.silver_delivery_performance", "Power BI API", "DEPlatform-delivery_performance"),
        ("sales-flow", "Sigma API", ["t1a_sandbox.antares_raw.cohort_mthly_flow"], "t1a_sandbox.antares_raw.cohort_mthly_flow", "t1a_sandbox.antares_sigma.sales_mthly_flow", "Sigma API", "Sigma Demo SimLake-sales_mthly_flow"),
        ("run-cost", "Databricks Billing API", ["lakesentry_dev_stg.ledger.work_unit_run"], "lakesentry_dev_stg.ledger.work_unit_run", "lakesentry_dev_stg.metrics.weekly_spend", "FinOps Object Storage", "LakeSentry-weekly_spend"),
    ]
    export_destinations = {}
    for hour in range(1, 24):
        tag, api, landing, source, target, destination, job_prefix = pipelines[(hour - 1) % len(pipelines)]
        offset = hour * 3600
        # Deterministic stagger, varied durations and overlap across hour edges.
        stagger = ((hour * 37) % 90)
        ingest_start, transform_start = offset + 90 + stagger, offset + 1080 + stagger
        transform_finish = transform_start + 1380 + (hour % 3) * 120
        export_start = transform_finish + 60
        export_finish = min(export_start + 720 + (hour % 4) * 120, 86_340)
        specs.extend([
            (f"api-{tag}-{hour:02}", f"ADF_SimLake_{tag.replace('-', '_')}_API_landing", "ws-east" if hour % 2 else "ws-west", "plane", ingest_start, 780, ingest_start + 780, "succeeded", [], landing, "observed", api, 0),
            (f"move-{tag}-{hour:02}", f"{job_prefix}-tables-deploy" if job_prefix.startswith("Sigma") else f"{job_prefix}-refresh", "ws-west" if hour % 2 else "ws-east", "ship", transform_start, transform_finish - transform_start, transform_finish, "succeeded", [source], [target], "observed", None, 0),
            (f"export-{tag}-{hour:02}", f"{job_prefix}-export", "ws-west", "plane", export_start, export_finish - export_start, export_finish, "cancelled" if hour == 11 else "succeeded", [target], [], "observed", None, 0),
        ])
        export_destinations[f"export-{tag}-{hour:02}"] = destination
    # Bridge the opening examples to the first hourly pipeline: exactly 80
    # parent runs, plus the cost-refresh repair as a separate execution attempt.
    specs.append(("publish-sales", "LakeSentry-query_fact-tables-deploy", "ws-east", "ship", 1500, 2400, 3900, "succeeded", ["de_platform_offering.de_silver.silver_carrier_performance"], ["lakesentry_dev_stg.metrics.query_fact"], "observed", None, 0))
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
                    scope="job_run" if index >= 11 else "task_run",
                    replay_duration_ms=(finish - start) * 1000 if index >= 11 else None,
                    route=Route(version=f"{id}:route-v2", evidence=evidence,
                                source_ids=[oid(n) for n in sources], target_ids=[oid(n) for n in targets],
                                external_source=external, external_target=export_destinations.get(id),
                                source_record_ids=[f"fixture:route:{id}"] if evidence != "unknown" else [],
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
    for t in [*range(15, 1801, 15), *range(2100, 86_401, 300)]:
        for ws in ("ws-east", "ws-west", "ws-eu"):
            if ws == "ws-eu" and 515 < t < 900:
                continue
            add(t, "coverage.update", ws, {"status": "connected", "last_successful_poll": BASE + t * 1000,
                "lineage_observed_at": BASE + (t - 300) * 1000, "reason": None})
    add(560, "coverage.update", "ws-eu", {"status": "stale", "reason": "Three consecutive polls missed; motion is frozen."})
    add(560, "collection.gap", "ws-eu", {"start": BASE + 515_000, "end": BASE + 900_000,
                                         "reason": "Demo network outage; task state reconciled at recovery."})
    return sorted(deepcopy(rows), key=lambda e: (e.event_time, e.event_id))
