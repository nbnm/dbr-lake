import { describe, expect, it } from "vitest";
import type { Attempt, LakeObject } from "./types";
import { makePath, positionAt } from "./motion";
import { isOverdue, reconstruct, status } from "./state";
import type { Replay } from "./types";
import { duckVisible } from "./ducks";

const objects: LakeObject[] = [
  {
    id: "from",
    metastore_id: "demo",
    catalog: "sales",
    schema_name: "raw",
    name: "orders",
    type: "table",
    workspace_ids: ["east", "west"],
    position: [-5, 0, -3],
  },
  {
    id: "to",
    metastore_id: "demo",
    catalog: "sales",
    schema_name: "refined",
    name: "orders",
    type: "table",
    workspace_ids: ["east", "west"],
    position: [4, 0, 4],
  },
];
const attempt: Attempt = {
  id: "task",
  account_id: "demo",
  workspace_id: "east",
  job_id: "1",
  run_id: "2",
  task_run_id: "3",
  task_key: "task",
  attempt_number: 0,
  name: "Transform orders",
  kind: "ship",
  phase: "running",
  raw_state: "RUNNING",
  started_at: 1000,
  ended_at: null,
  observed_at: 1000,
  source_id: "fixture",
  collection_stale_at: null,
  native_url: null,
  route: {
    version: "v1",
    evidence: "observed",
    source_ids: ["from"],
    target_ids: ["to"],
    external_source: null,
    source_record_ids: ["fixture"],
    observed_at: 1000,
  },
  estimate: {
    predicted_duration_ms: 100000,
    sample_count: 12,
    q1_ms: 90000,
    q3_ms: 110000,
    confidence: "historical",
    version: "v1",
    timing_basis: "observed_active_start",
  },
};

describe("motion contract", () => {
  const path = makePath(attempt, objects);
  it("samples equal path distance at equal elapsed intervals within five percent", () => {
    const nominal = path.length / 90;
    for (let t = 1000; t < 90000; t += 1000) {
      const p = positionAt(attempt, path, t).position;
      const next = positionAt(attempt, path, t + 1000).position;
      expect(Math.abs(p.distanceTo(next) - nominal) / nominal).toBeLessThan(
        0.05,
      );
    }
  });
  it("joins the holding loop continuously at the same nominal speed", () => {
    const before = positionAt(attempt, path, 90999).position;
    const after = positionAt(attempt, path, 91001).position;
    expect(before.distanceTo(after)).toBeLessThan(0.001);
    const nominal = path.length / 90000;
    const increments = [92000, 110000, 210000].map(
      (t) =>
        positionAt(attempt, path, t).position.distanceTo(
          positionAt(attempt, path, t + 10).position,
        ) / 10,
    );
    for (const speed of increments)
      expect(Math.abs(speed - nominal) / nominal).toBeLessThan(0.05);
  });
  it("expired prediction loops without reporting success", () => {
    expect(positionAt(attempt, path, 250000).holding).toBe(true);
    expect(isOverdue(attempt, 250000)).toBe(true);
    expect(status(attempt, 250000)).toBe("Overdue");
    expect(
      positionAt(attempt, path, 250000).position.distanceTo(path.to),
    ).toBeGreaterThan(0.1);
  });
  it("freezes stale and failed tasks", () => {
    const stale = { ...attempt, collection_stale_at: 42000 };
    expect(
      positionAt(stale, path, 45000).position.equals(
        positionAt(stale, path, 90000).position,
      ),
    ).toBe(true);
    expect(status(stale, 200000)).toBe("Collection stale");
    const failed = { ...attempt, phase: "failed" as const, ended_at: 40000 };
    expect(
      positionAt(failed, path, 45000).position.equals(
        positionAt(failed, path, 200000).position,
      ),
    ).toBe(true);
  });
  it("does not move queued tasks or fabricate unknown ETA", () => {
    const queued = { ...attempt, phase: "queued" as const, started_at: null };
    expect(positionAt(queued, path, 90000).position.equals(path.from)).toBe(
      true,
    );
    const unknown = {
      ...attempt,
      estimate: { ...attempt.estimate, predicted_duration_ms: null },
    };
    expect(positionAt(unknown, path, 200000).holding).toBe(true);
    expect(isOverdue(unknown, 200000)).toBe(false);
  });
  it("docks only after an observed success", () => {
    expect(
      positionAt(
        { ...attempt, phase: "succeeded", ended_at: 2000 },
        path,
        2500,
      ).position.equals(path.to),
    ).toBe(true);
  });
});

it("reconstructs the same event-time state on repeated seeks without future state", () => {
  const replay: Replay = {
    mode: "demo",
    retention_days: 7,
    available_duration_ms: 3000,
    checkpoint: {
      mode: "demo",
      account_id: "demo",
      server_time: 0,
      cursor: 0,
      range: { start: 0, end: 3000 },
      objects,
      attempts: [],
      workspaces: [],
      gaps: [],
    },
    events: [
      {
        event_id: "start",
        schema_version: 1,
        account_id: "demo",
        workspace_id: "east",
        execution_attempt_id: "task",
        event_time: 1000,
        observed_at: 1000,
        sequence: 1,
        type: "attempt.upsert",
        payload: attempt as unknown as Record<string, unknown>,
      },
      {
        event_id: "end",
        schema_version: 1,
        account_id: "demo",
        workspace_id: "east",
        execution_attempt_id: "task",
        event_time: 2000,
        observed_at: 2000,
        sequence: 2,
        type: "attempt.upsert",
        payload: { ...attempt, phase: "succeeded", ended_at: 2000 },
      },
    ],
  };
  const first = reconstruct(replay, 1500);
  reconstruct(replay, 3000);
  expect(reconstruct(replay, 1500)).toEqual(first);
  expect(first.attempts[0].phase).toBe("running");
  expect(first.attempts[0].estimate).toEqual(attempt.estimate);
});

it("keeps duck appearances deterministic and waits at least three minutes", () => {
  for (let t = 0; t < 180000; t += 1000) expect(duckVisible(t)).toBe(false);
  const schedule = Array.from({ length: 1800 }, (_, i) =>
    duckVisible(i * 1000),
  );
  expect(schedule.some(Boolean)).toBe(true);
  expect(Array.from({ length: 1800 }, (_, i) => duckVisible(i * 1000))).toEqual(
    schedule,
  );
  expect(
    Array.from({ length: 3600 }, (_, i) =>
      duckVisible((23 * 3600 + i) * 1000),
    ).some(Boolean),
  ).toBe(true);
});
