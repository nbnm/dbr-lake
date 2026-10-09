import { describe, expect, it } from "vitest";
import type { Attempt, LakeObject } from "./types";
import { buildLakeLayout } from "./layout";
import { makePath, positionAt } from "./motion";
import {
  expandVessels,
  flightSelection,
  flightTableIds,
  selectedDestination,
} from "./vessels";
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

describe("outbound export flights", () => {
  const outbound: Attempt = {
    ...plane,
    id: "export",
    name: "Export orders",
    replay_duration_ms: 100000,
    route: {
      ...plane.route,
      external_source: null,
      external_target: "Partner API",
      source_ids: [objects[0].id],
      target_ids: [],
    },
  };
  it("departs from the selected source berth, crosses open water and lands at the external airport", () => {
    const lake = buildLakeLayout(objects, [plane, outbound]);
    const source = lake.objects.find((o) => o.id === objects[0].id)!;
    const airport = lake.airports.find((p) => p.role === "export")!;
    expect(airport.source_ids).toEqual([source.id]);
    expect(airport.target_ids).toEqual([]);
    const instance = expandVessels([outbound])[0];
    expect(instance.destinationId).toBe(source.id);
    const path = makePath(
      outbound,
      lake.objects,
      lake.airports,
      lake.piers,
      instance.destinationId,
      lake,
    );
    expect(path.from.x).toBe(source.position[0]);
    expect(Math.abs(path.from.z)).toBeLessThan(lake.water.halfDepth);
    expect(path.to.toArray()).toEqual(airport.departure);
    expect(positionAt(outbound, path, 1000).position.toArray()).toEqual(
      path.from.toArray(),
    );
    expect(positionAt(outbound, path, 51000).position.y).toBeGreaterThan(3);
    expect(
      positionAt(
        { ...outbound, phase: "succeeded", ended_at: 101000 },
        path,
        101000,
      ).position.toArray(),
    ).toEqual(airport.departure);
    expect(path.curve.getPointAt(0).toArray()).toEqual(path.from.toArray());
    expect(path.curve.getPointAt(1).distanceTo(path.to)).toBeLessThan(0.001);
    const oldPath = makePath(
      outbound,
      lake.objects,
      lake.airports,
      lake.piers,
      source.id,
    );
    expect(oldPath.curve.getPointAt(0).distanceTo(oldPath.from)).toBeLessThan(
      0.001,
    );
    expect(oldPath.curve.getPointAt(1).distanceTo(oldPath.to)).toBeLessThan(
      0.001,
    );
  });
  it("reserves source ports and keeps the source selection in job-run links", () => {
    const other = { ...outbound, id: "another-export", run_id: "another-run" };
    const lake = buildLakeLayout(objects, [outbound, other]);
    const flights = expandVessels([outbound, other]);
    expect(flightTableIds(outbound)).toEqual([objects[0].id]);
    expect(
      selectedDestination(outbound, flightSelection(outbound, objects[0].id)),
    ).toBe(objects[0].id);
    expect(lake.navigation.slots[flights[0].key].ports[objects[0].id]).not.toBe(
      lake.navigation.slots[flights[1].key].ports[objects[0].id],
    );
    expect(lake.navigation.slots[flights[0].key].launch).not.toBe(
      lake.navigation.slots[flights[1].key].launch,
    );
    const link = jobRunLink(outbound, "demo", 51000, objects[0].id, "demo-v5")!;
    expect(
      new URL(link.href, "http://localhost").searchParams.get("destination"),
    ).toBe(objects[0].id);
    expect(
      new URL(
        lakeAttemptLink(outbound, 51000, objects[0].id, "demo-v5"),
        "http://localhost",
      ).searchParams.get("destination"),
    ).toBe(objects[0].id);
  });
});

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
      const pier = layout.piers.find((p) =>
        p.objects.some((o) => o.id === target.id),
      )!;
      // Park in the water just beyond the timber finger, leaving hull clearance.
      expect(landed.position.z).toBeCloseTo(
        target.position[2] + pier.direction * 1.2,
      );
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
