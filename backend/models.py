"""Normalized contracts. Timestamps are UTC Unix milliseconds throughout."""
from typing import Literal
from pydantic import BaseModel, Field, model_validator


class Workspace(BaseModel):
    account_id: str = "t1a-demo"
    id: str
    name: str
    cloud: str = "azure"
    region: str
    metastore_id: str
    host: str | None = None
    status: Literal["connected", "restricted", "stale", "excluded", "unsupported"]
    last_successful_poll: int | None
    lineage_observed_at: int | None
    capabilities: list[str] = Field(default_factory=lambda: ["bounded_jobs"])
    reason: str | None = None


class LakeObject(BaseModel):
    id: str
    metastore_id: str
    catalog: str
    schema_name: str
    name: str
    type: Literal["table", "view"] = "table"
    workspace_ids: list[str]
    position: tuple[float, float, float]
    source_id: str
    observed_at: int
    provenance: str = "demo_fixture"


class Estimate(BaseModel):
    predicted_duration_ms: int | None = Field(ge=1)
    sample_count: int
    q1_ms: int | None = None
    q3_ms: int | None = None
    confidence: Literal["historical", "low", "unknown"]
    version: str
    timing_basis: str = "observed_active_start"


class Route(BaseModel):
    version: str
    evidence: Literal["observed", "historical", "configured", "unknown"]
    source_ids: list[str]
    target_ids: list[str]
    external_source: str | None = None
    source_record_ids: list[str]
    observed_at: int
    provenance: str = "demo_fixture"


class Attempt(BaseModel):
    id: str
    account_id: str = "t1a-demo"
    workspace_id: str
    job_id: str
    run_id: str
    task_run_id: str
    task_key: str
    attempt_number: int = 0
    name: str
    kind: Literal["plane", "ship", "buoy"]
    phase: Literal["queued", "running", "succeeded", "failed", "cancelled", "unknown"]
    raw_state: str
    started_at: int | None
    ended_at: int | None = None
    observed_at: int
    source_id: str
    provenance: str = "demo_fixture"
    route: Route
    estimate: Estimate
    collection_stale_at: int | None = None
    native_url: str | None = None
    scope: Literal['task_run', 'job_run'] = 'task_run'
    run_tasks: list[dict] = Field(default_factory=list)
    replay_duration_ms: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def truthful_transport(self):
        if self.kind == "plane" and (not self.route.external_source or self.route.evidence == "unknown"):
            raise ValueError("A plane requires supported external source evidence.")
        if self.kind == "ship" and (not self.route.source_ids or not self.route.target_ids or self.route.evidence == "unknown"):
            raise ValueError("An unknown or read-only route must use a processing buoy.")
        return self


class SceneEvent(BaseModel):
    event_id: str
    schema_version: int = 1
    account_id: str = "t1a-demo"
    workspace_id: str
    execution_attempt_id: str | None = None
    event_time: int
    observed_at: int
    sequence: int = 0
    type: Literal["attempt.upsert", "coverage.update", "collection.gap"]
    payload: dict
