import { describe, expect, it } from "vitest";
import type { Attempt, LakeObject } from "./types";
import { buildLakeLayout } from "./layout";
import { makePath, positionAt } from "./motion";
import { expandVessels, flightSelection, selectedDestination } from "./vessels";
import { jobRunLink, lakeAttemptLink, resolveJobRun } from "./runLinks";

const objects: LakeObject[] = ["orders", "clickstream", "payments"].map(
  (name, i) => ({
    id: `metastore:catalog.schema_${i}.${name}`,
    metastore_id: "metastore",
    catalog: "catalog",
    schema_name: `schema_${i}`,
    name,
    type: "table",
    workspace_ids: ["east"],
    position: [0, 0, 0],
  }),
);
const plane: Attempt = {
  id: "ingest",
  account_id: "account",
  workspace_id: "east",
  job_id: "job",
  run_id: "run",
  task_run_id: "task-run",
  task_key: "ingest",
  attempt_number: 0,
  name: "Ingest",
  kind: "plane",
  phase: "running",
  raw_state: "RUNNING",
  started_at: 1000,
  ended_at: null,
  observed_at: 1000,
  source_id: "fixture",
  native_url: null,
  collection_stale_at: null,
  route: {
    version: "v1",
    evidence: "configured",
    source_ids: [],
    target_ids: objects.map((o) => o.id),
    external_source: "Event Hubs",
    source_record_ids: ["fixture"],
    observed_at: 1000,
  },
  estimate: {
    version: "v1",
    confidence: "historical",
    predicted_duration_ms: 100000,
    sample_count: 5,
    q1_ms: 90000,
    q3_ms: 110000,
    timing_basis: "observed_active_start",
  },
};
const layout = buildLakeLayout(objects, [plane]);
const paths = plane.route.target_ids.map((id) =>
  makePath(plane, layout.objects, layout.airports, layout.piers, id),
);

describe("landing flights", () => {
  it("projects one plane per distinct target without duplicating task executions or mutating routes", () => {
    const route = structuredClone(plane.route);
    const flights = expandVessels([plane]);
    expect(flights).toHaveLength(3);
    expect(new Set(flights.map((v) => v.key)).size).toBe(3);
    expect(flights.map((v) => v.destinationId)).toEqual(plane.route.target_ids);
    expect(new Set(flights.map((v) => v.attempt)).size).toBe(1);
    expect(plane.route).toEqual(route);
    expect(
      expandVessels([
        {
          ...plane,
          route: {
            ...plane.route,
            target_ids: [...plane.route.target_ids, objects[0].id],
          },
        },
      ]),
    ).toHaveLength(3);
  });
  it("keeps single targets, processing buoys and retries as independent visual identities", () => {
    const retry = {
      ...plane,
      id: "retry",
      attempt_number: 1,
      task_run_id: "retry-run",
    };
    expect(new Set(expandVessels([plane, retry]).map((v) => v.key)).size).toBe(
      6,
    );
    expect(expandVessels([{ ...plane, kind: "buoy" }])).toHaveLength(1);
    expect(
      expandVessels([
        { ...plane, route: { ...plane.route, target_ids: [objects[0].id] } },
      ]),
    ).toHaveLength(1);
  });
  it("selects the clicked landing and falls back safely for invalid or unrelated selections", () => {
    expect(
      selectedDestination(plane, flightSelection(plane, objects[2].id)),
    ).toBe(objects[2].id);
    expect(selectedDestination(plane, flightSelection(plane, "invalid"))).toBe(
      objects[0].id,
    );
    expect(
      selectedDestination(plane, {
        type: "attempt",
        id: "another",
        destination_id: objects[2].id,
      }),
    ).toBe(objects[0].id);
  });
  it("separates queued flights on the runway and sends every branch to its own berth", () => {
    expect(new Set(paths.map((p) => p.from.toArray().join())).size).toBe(3);
    expect(
      new Set(
        paths.map((p) => positionAt(plane, p, 60000).position.toArray().join()),
      ).size,
    ).toBe(3);
    paths.forEach((path, i) => {
      const target = layout.objects.find((o) => o.id === objects[i].id)!;
      const landed = positionAt(
        { ...plane, phase: "succeeded", ended_at: 101000 },
        path,
        120000,
      );
      expect(landed.position.x).toBe(target.position[0]);
      expect(landed.position.z).toBe(target.position[2]);
      expect(
        positionAt(
          { ...plane, phase: "queued", started_at: null },
          path,
          60000,
        ).position.equals(path.from),
      ).toBe(true);
    });
  });
  it("maintains constant travel speed and shared stale and overdue semantics for every branch", () => {
    paths.forEach((path) => {
      const nominal = path.length / 90;
      for (let t = 1000; t < 90000; t += 1000) {
        const step = positionAt(plane, path, t).position.distanceTo(
          positionAt(plane, path, t + 1000).position,
        );
        expect(Math.abs(step - nominal) / nominal).toBeLessThan(0.05);
      }
      const stale = { ...plane, collection_stale_at: 40000 };
      expect(
        positionAt(stale, path, 45000).position.equals(
          positionAt(stale, path, 90000).position,
        ),
      ).toBe(true);
      expect(positionAt(plane, path, 120000).holding).toBe(true);
      expect(positionAt(plane, path, 120000).position.equals(path.to)).toBe(
        false,
      );
    });
  });
});

describe("job-run navigation", () => {
  it("preserves an exact native run URL ahead of the demo fallback", () => {
    const native_url =
      "https://workspace.example/jobs/2400/runs/88000?o=123#task/99000";
    expect(jobRunLink({ ...plane, native_url }, "demo", 60000)?.href).toBe(
      native_url,
    );
    expect(jobRunLink({ ...plane, native_url }, "live", 60000)?.label).toBe(
      "Open Databricks run",
    );
  });
  it("builds a working demo link with execution scope, selected landing, and event time", () => {
    const link = jobRunLink(plane, "demo", 60000.7, objects[2].id, "demo-v4")!;
    const params = new URL(link.href, "http://localhost").searchParams;
    expect(link.label).toBe("Open demo job run");
    expect(params.get("job-run")).toBe(plane.run_id);
    expect(params.get("job")).toBe(plane.job_id);
    expect(params.get("workspace")).toBe(plane.workspace_id);
    expect(params.get("account")).toBe(plane.account_id);
    expect(params.get("attempt")).toBe(plane.id);
    expect(params.get("destination")).toBe(objects[2].id);
    expect(params.get("at")).toBe("60000");
    expect(params.get("capture")).toBe("demo-v4");
    const back = new URL(
      lakeAttemptLink(plane, 60000, objects[2].id, "demo-v4"),
      "http://localhost",
    ).searchParams;
    expect(back.get("destination")).toBe(objects[2].id);
    expect(back.get("attempt")).toBe(plane.id);
    expect(back.get("capture")).toBe("demo-v4");
    expect(back.has("job-run")).toBe(false);
  });
  it("never fabricates a native link and excludes invalid destination IDs", () => {
    expect(jobRunLink(plane, "live", 60000)).toBeNull();
    expect(
      jobRunLink(
        { ...plane, native_url: "javascript:alert(1)" },
        "live",
        60000,
      ),
    ).toBeNull();
    expect(
      new URL(
        jobRunLink(plane, "demo", 60000, "foreign")!.href,
        "http://localhost",
      ).searchParams.has("destination"),
    ).toBe(false);
  });
  it("resolves only the scoped parent run, retains retries and rejects unrelated attempts", () => {
    const retry = {
      ...plane,
      id: "retry",
      task_run_id: "retry-task",
      attempt_number: 1,
    };
    const attempts = [
      plane,
      retry,
      { ...plane, id: "foreign-ws", workspace_id: "west" },
      { ...plane, id: "foreign-account", account_id: "other" },
      { ...plane, id: "foreign-job", job_id: "other" },
    ];
    const scene = {
      mode: "demo" as const,
      account_id: "account",
      server_time: 60000,
      cursor: 0,
      range: { start: 0, end: 120000 },
      objects,
      attempts,
      workspaces: [],
      gaps: [],
    };
    const params = new URL(
      jobRunLink(retry, "demo", 60000)!.href,
      "http://localhost",
    ).searchParams;
    const resolved = resolveJobRun(scene, params);
    expect(resolved.attempts).toEqual([plane, retry]);
    expect(resolved.selected).toBe(retry);
    params.set("attempt", "foreign-ws");
    expect(resolveJobRun(scene, params).selected).toBeUndefined();
  });
});
