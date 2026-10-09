export type Phase =
  "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type Evidence = "observed" | "historical" | "configured" | "unknown";
export interface Workspace {
  id: string;
  name: string;
  region: string;
  metastore_id: string;
  status: "connected" | "restricted" | "stale" | "excluded" | "unsupported";
  last_successful_poll: number | null;
  lineage_observed_at: number | null;
  capabilities: string[];
  reason: string | null;
}
export interface LakeObject {
  id: string;
  metastore_id: string;
  catalog: string;
  schema_name: string;
  name: string;
  position: [number, number, number];
  workspace_ids: string[];
  type: "table" | "view";
  provenance?: string;
}
export interface Estimate {
  predicted_duration_ms: number | null;
  sample_count: number;
  q1_ms: number | null;
  q3_ms: number | null;
  confidence: "historical" | "low" | "unknown";
  version: string;
  timing_basis: string;
}
export interface Route {
  version: string;
  evidence: Evidence;
  source_ids: string[];
  target_ids: string[];
  external_source: string | null;
  external_target?: string | null;
  source_record_ids: string[];
  observed_at: number;
}
export interface Attempt {
  id: string;
  account_id: string;
  workspace_id: string;
  job_id: string;
  run_id: string;
  task_run_id: string;
  task_key: string;
  attempt_number: number;
  name: string;
  kind: "plane" | "ship" | "buoy";
  phase: Phase;
  raw_state: string;
  started_at: number | null;
  ended_at: number | null;
  observed_at: number;
  source_id: string;
  route: Route;
  estimate: Estimate;
  collection_stale_at: number | null;
  native_url: string | null;
  scope?: "task_run" | "job_run";
  replay_duration_ms?: number | null;
  run_tasks?: {
    task_key: string;
    task_run_id: string;
    started_at: number;
    ended_at: number | null;
    raw_state: string;
  }[];
}
export interface Gap {
  start: number;
  end: number;
  reason: string;
  workspace_id: string;
}
export interface Snapshot {
  mode: "demo" | "replay";
  capture_id?: string;
  captured_at?: number;
  inventory?: InventoryEntry[];
  warnings?: string[];
  history_note?: string;
  account_id: string;
  server_time: number;
  cursor: number;
  range: { start: number; end: number };
  objects: LakeObject[];
  attempts: Attempt[];
  workspaces: Workspace[];
  gaps: Gap[];
}
export interface SceneEvent {
  event_id: string;
  schema_version: number;
  account_id: string;
  workspace_id: string;
  execution_attempt_id: string | null;
  event_time: number;
  observed_at: number;
  sequence: number;
  type: "attempt.upsert" | "coverage.update" | "collection.gap";
  payload: Record<string, unknown>;
}
export interface Replay {
  checkpoint: Snapshot;
  events: SceneEvent[];
  mode: "demo" | "replay";
  retention_days: number;
  available_duration_ms: number;
}
export type Selection =
  | { type: "attempt"; id: string; destination_id?: string }
  | { type: "schema"; id: string }
  | { type: "catalog"; id: string }
  | { type: "table"; id: string }
  | { type: "airport"; id: string }
  | { type: "coverage" };
export type StatusFilter = "all" | "running" | "failed" | "overdue";
export interface InventoryEntry {
  metastore_id: string;
  catalog: string;
  schema_name: string | null;
}
export interface ConnectionSettings {
  id: string;
  name: string;
  host: string;
  region: string;
  token_configured: boolean;
  auth_method?: "token" | "databricks_cli";
  cli_profile?: string | null;
  credential_configured?: boolean;
  authentication_error?: string | null;
  routes: TaskMapping[];
  import_source?: "system_tables" | "jobs_api";
  warehouse_id?: string | null;
}
export interface TaskMapping {
  job_id: string;
  task_key: string;
  source_tables: string[];
  target_tables: string[];
  external_source?: string | null;
}
