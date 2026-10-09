import { describe, expect, it } from "vitest";
import { buildReplayLakeLayout } from "./layout";
import { reconstruct } from "./state";
import type { Attempt, LakeObject, Replay, SceneEvent } from "./types";

function table(
  catalog: string,
  schema: string,
  name: string,
  metastore = "meta",
): LakeObject {
  return {
    id: `${metastore}:${catalog}.${schema}.${name}`,
    metastore_id: metastore,
    catalog,
    schema_name: schema,
    name,
    type: "table",
    workspace_ids: ["workspace"],
    position: [0, 0, 0],
    provenance: "system.information_schema.tables",
  };
}
function attempt(
  id: string,
  source: string[],
  target: string[],
  evidence: Attempt["route"]["evidence"] = "historical",
): Attempt {
  return {
    id,
    account_id: "account",
    workspace_id: "workspace",
    job_id: "job",
    run_id: id,
    task_run_id: id,
    task_key: "task",
    attempt_number: 0,
    name: "Job",
    kind: "buoy",
    phase: "running",
    raw_state: "RUNNING",
    started_at: 1000,
    ended_at: null,
    observed_at: 1000,
    source_id: "history",
    collection_stale_at: null,
    native_url: null,
    route: {
      version: "v1",
      evidence,
      source_ids: source,
      target_ids: target,
      external_source: null,
      source_record_ids: [],
      observed_at: 1000,
    },
    estimate: {
      predicted_duration_ms: null,
      sample_count: 0,
      q1_ms: null,
      q3_ms: null,
      confidence: "unknown",
      version: "v1",
      timing_basis: "history",
    },
  };
}
function event(a: Attempt, at: number, sequence: number): SceneEvent {
  return {
    event_id: `event-${sequence}`,
    schema_version: 1,
    account_id: "account",
    workspace_id: a.workspace_id,
    execution_attempt_id: a.id,
    event_time: at,
    observed_at: 86_400_000,
    sequence,
    type: "attempt.upsert",
    payload: { ...a },
  };
}
function capture(
  objects: LakeObject[],
  attempts: Attempt[] = [],
  events: SceneEvent[] = [],
): Replay {
  return {
    mode: "replay",
    retention_days: 1,
    available_duration_ms: 86_400_000,
    events,
    checkpoint: {
      mode: "replay",
      account_id: "account",
      cursor: 0,
      server_time: 0,
      range: { start: 0, end: 86_400_000 },
      objects,
      attempts,
      workspaces: [],
      gaps: [],
      inventory: [
        { metastore_id: "meta", catalog: "empty", schema_name: null },
        { metastore_id: "meta", catalog: "used", schema_name: "empty_schema" },
      ],
    },
  };
}

describe("used catalog and schema rendering", () => {
  it("renders source and destination schemas, keeps their table inventory, and omits unused siblings and catalogs", () => {
    const source = table("used", "input", "source");
    const peer = table("used", "input", "other_table");
    const target = table("output", "result", "target");
    const unusedSibling = table("used", "idle", "ignored");
    const unusedCatalog = table("unused", "idle", "ignored");
    const replay = capture(
      [source, peer, target, unusedSibling, unusedCatalog],
      [attempt("transform", [source.id], [target.id])],
    );
    const lake = buildReplayLakeLayout(replay);
    expect(lake.docks.map((d) => d.catalog).sort()).toEqual(["output", "used"]);
    expect(lake.piers.map((p) => p.schema).sort()).toEqual(["input", "result"]);
    expect(lake.objects.map((o) => o.id).sort()).toEqual(
      [source.id, peer.id, target.id].sort(),
    );
    expect(replay.checkpoint.objects).toHaveLength(5);
    expect(replay.checkpoint.inventory).toHaveLength(2);
  });

  it("counts read-only and ad hoc lineage even without a matched job run and keeps metastore identities separate", () => {
    const read = {
      ...table("same", "schema", "read", "east"),
      provenance: "system.access.table_lineage",
    };
    const peer = table("same", "schema", "peer", "east");
    const otherMetastore = table("same", "schema", "read", "west");
    const lake = buildReplayLakeLayout(capture([read, peer, otherMetastore]));
    expect(lake.docks).toHaveLength(1);
    expect(lake.piers).toHaveLength(1);
    expect(lake.docks[0].metastore).toBe("east");
    expect(lake.objects.map((o) => o.id).sort()).toEqual(
      [read.id, peer.id].sort(),
    );
  });

  it.each(["v1", "v2"])(
    "includes all captured route updates (%s) and stays deterministic across seeking and inventory order",
    (version) => {
      const early = table("early", "schema", "table");
      const later = table("later", "schema", "table");
      const first = attempt("run", [], [early.id]);
      const revised = {
        ...first,
        route: { ...first.route, version, target_ids: [later.id] },
      };
      const replay = capture(
        [early, later],
        [],
        [event(first, 1000, 1), event(revised, 2000, 2)],
      );
      expect(reconstruct(replay, 0).attempts).toHaveLength(0);
      expect(reconstruct(replay, 1500).attempts[0].route.target_ids).toEqual([
        early.id,
      ]);
      expect(reconstruct(replay, 2500).attempts[0].route.target_ids).toEqual([
        later.id,
      ]);
      const lake = buildReplayLakeLayout(replay);
      expect(lake.docks).toHaveLength(2);
      expect(
        buildReplayLakeLayout({
          ...replay,
          checkpoint: { ...replay.checkpoint, objects: [later, early] },
        }),
      ).toEqual(lake);
    },
  );

  it("keeps an empty lake when usage is unknown, retains processing buoys, and does not invent docks from hierarchy entries", () => {
    const unused = table("unused", "schema", "table");
    const unknown = attempt("unresolved", [unused.id], [unused.id], "unknown");
    const lake = buildReplayLakeLayout(capture([unused], [unknown]));
    expect(lake.docks).toHaveLength(0);
    expect(lake.piers).toHaveLength(0);
    expect(lake.objects).toHaveLength(0);
    expect(Object.keys(lake.navigation.slots)).toHaveLength(1);
    expect(
      [...Object.values(lake.water), ...Object.values(lake.ground)].every(
        Number.isFinite,
      ),
    ).toBe(true);
  });
});
