import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  buildLakeLayout,
  lighthousePoint,
  antaresPoint,
  harborPoint,
} from "./layout";
import { buildNavigation, vesselKey } from "./navigation";
import { makePath, positionAt } from "./motion";
import { buildSurroundings } from "./environment";
import { lakeOutline } from "./shoreline";
import { sailboatPose, SAILBOAT_RADIUS } from "./landmarks";
import { ambientTraffic, separateTraffic } from "./traffic";
import { swimPose, SWIM_RADIUS, surfaceLoopMs, openWater } from "./wildlife";
import type { Attempt, LakeObject } from "./types";
import { PAPER_SHIP_RADIUS } from "./vesselSize";

const tables: LakeObject[] = Array.from({ length: 18 }, (_, i) => ({
  id: `m:catalog_${Math.floor(i / 6)}.schema_${Math.floor(i / 3)}.table_${i % 3}`,
  metastore_id: "m",
  catalog: `catalog_${Math.floor(i / 6)}`,
  schema_name: `schema_${Math.floor(i / 3)}`,
  name: `table_${i % 3}`,
  type: "table",
  workspace_ids: ["w"],
  position: [0, 0, 0],
}));
function task(
  id: string,
  source = 0,
  target = 3,
  kind: Attempt["kind"] = "ship",
): Attempt {
  return {
    id,
    account_id: "a",
    workspace_id: "w",
    job_id: "j",
    run_id: id,
    task_run_id: id,
    task_key: "transfer",
    attempt_number: 0,
    name: id,
    kind,
    phase: "running",
    raw_state: "RUNNING",
    started_at: 1000,
    ended_at: 201000,
    observed_at: 1000,
    source_id: "fixture",
    native_url: null,
    collection_stale_at: null,
    route: {
      version: "v1",
      evidence: "configured",
      external_source: kind === "plane" ? "Airport" : null,
      source_ids: kind === "plane" ? [] : [tables[source].id],
      target_ids: [tables[target].id],
      source_record_ids: [],
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
}
function insideLake(
  layout: ReturnType<typeof buildLakeLayout>,
  x: number,
  z: number,
) {
  const polygon = lakeOutline(
    layout.water.halfWidth,
    layout.water.halfDepth,
  ).getPoints(64);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      -a.y > z !== -b.y > z &&
      x < ((b.x - a.x) * (z + a.y)) / (-b.y + a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

describe("shore and countryside", () => {
  it("attaches every catalog promenade and schema foundation to actual dry land, including large inventories", () => {
    for (const count of [0, 1, 3, 8, 25]) {
      const inventory = Array.from({ length: count }, (_, i) => ({
        ...tables[0],
        id: `m:c${i}.s.t`,
        catalog: `c${i}`,
      }));
      const layout = buildLakeLayout(inventory);
      for (const dock of layout.docks) {
        for (const x of [-dock.width / 2, 0, dock.width / 2]) {
          const dry = harborPoint(dock, x, -1.4),
            wet = harborPoint(dock, x, -0.2);
          expect(
            insideLake(layout, dry[0], dry[2]),
            `${count} catalogs: ${dock.catalog} ${dock.bank} x=${x}, center=${dock.center}, angle=${dock.rotation}`,
          ).toBe(false);
          expect(insideLake(layout, wet[0], wet[2])).toBe(true);
        }
        for (const pier of dock.piers) {
          const dry = harborPoint(pier, 0, -1.4);
          expect(insideLake(layout, dry[0], dry[2])).toBe(false);
        }
      }
      expect(
        insideLake(
          layout,
          ...([lighthousePoint(layout)[0], lighthousePoint(layout)[2]] as [
            number,
            number,
          ]),
        ),
      ).toBe(false);
    }
  });
  it("sets airports back from the water and leaves forest, crops and roads clear of aprons and docks", () => {
    const layout = buildLakeLayout(tables, [task("flight", 0, 3, "plane")]);
    expect(
      Math.abs(layout.airports[0].center[0]) - 2.15 - layout.water.halfWidth,
    ).toBeGreaterThan(4);
    const tower = antaresPoint(layout);
    for (const x of [tower[0] - 1.35, tower[0] + 1.35])
      for (const z of [tower[2] - 1.1, tower[2] + 1.1]) {
        expect(insideLake(layout, x, z)).toBe(false);
        expect(Math.abs(x)).toBeLessThan(layout.ground.halfWidth);
        expect(Math.abs(z)).toBeLessThan(layout.ground.halfDepth);
      }
    for (const airport of layout.airports)
      expect(Math.abs(tower[2] - airport.center[2])).toBeGreaterThan(4.6);
    const surroundings = buildSurroundings(layout);
    expect(surroundings.fields).toHaveLength(6);
    expect(surroundings.trees.length).toBeGreaterThan(20);
    expect(surroundings.roads.length).toBeGreaterThan(4);
    for (const {
      point: [x, , z],
    } of surroundings.trees) {
      expect(insideLake(layout, x, z)).toBe(false);
      expect(Math.hypot(x - tower[0], z - tower[2])).toBeGreaterThan(2.2);
      for (const a of layout.airports)
        expect(
          Math.abs(x - a.center[0]) > 3.2 || Math.abs(z - a.center[2]) > 4.1,
        ).toBe(true);
      for (const d of layout.docks) {
        const dx = x - d.center[0],
          dz = z - d.center[2];
        const localX = dx * Math.cos(d.rotation) - dz * Math.sin(d.rotation);
        const localZ = dx * Math.sin(d.rotation) + dz * Math.cos(d.rotation);
        expect(
          Math.abs(localX) > d.width / 2 + 0.6 || Math.abs(localZ) > 2,
        ).toBe(true);
      }
    }
    expect(
      buildSurroundings(
        buildLakeLayout([...tables].reverse(), [task("flight", 0, 3, "plane")]),
      ),
    ).toEqual(surroundings);
  });
});

describe("ambient journeys across the lake", () => {
  it("takes the duck flock, octopus and sailboat across both halves without leaving the water or touching piers", () => {
    const layouts = [
      buildLakeLayout([]),
      buildLakeLayout(tables),
      buildLakeLayout(
        Array.from({ length: 30 }, (_, i) => ({
          ...tables[0],
          id: `m:c${i}.s.t`,
          catalog: `c${i}`,
        })),
      ),
    ];
    for (const lake of layouts) {
      const period = surfaceLoopMs(lake.water);
      const bounds = openWater(lake.water);
      for (const kind of ["ducks", "octopus", "sailboat"] as const) {
        const poseAt = (at: number, reduced = false) =>
          kind === "sailboat"
            ? sailboatPose(lake.water, at, reduced)
            : swimPose(kind, lake.water, at, reduced);
        const points: Vector3[] = [];
        for (let at = 0; at <= period; at += period / 240) {
          const pose = poseAt(at);
          const p = new Vector3(...pose.point);
          points.push(p);
          const radius = kind === "sailboat" ? SAILBOAT_RADIUS : SWIM_RADIUS;
          for (const [x, z] of [
            [radius, 0],
            [-radius, 0],
            [0, radius],
            [0, -radius],
          ])
            expect(insideLake(lake, p.x + x, p.z + z)).toBe(true);
          for (const pier of lake.piers) {
            const dx = p.x - pier.center[0],
              dz = p.z - pier.center[2];
            const localX =
              dx * Math.cos(pier.rotation) - dz * Math.sin(pier.rotation);
            const localZ =
              dx * Math.sin(pier.rotation) + dz * Math.cos(pier.rotation);
            expect(
              Math.abs(localX) > pier.width / 2 + radius ||
                localZ > pier.depth + radius ||
                localZ < -1.55 - radius,
            ).toBe(true);
          }
          // Models face their travel direction, including both turns.
          const next = new Vector3(...poseAt(at + 10).point)
            .sub(p)
            .setY(0)
            .normalize();
          expect(
            next.dot(
              new Vector3(Math.sin(pose.heading), 0, Math.cos(pose.heading)),
            ),
          ).toBeGreaterThan(0.99);
        }
        expect(
          Math.max(...points.map((p) => p.x)) -
            Math.min(...points.map((p) => p.x)),
        ).toBeGreaterThan((bounds.maxX - bounds.minX) * 0.995);
        expect(
          Math.max(...points.map((p) => p.z)) -
            Math.min(...points.map((p) => p.z)),
        ).toBeGreaterThan((bounds.maxZ - bounds.minZ) * 0.995);
        expect(Math.min(...points.map((p) => p.x))).toBeLessThan(0);
        expect(Math.max(...points.map((p) => p.x))).toBeGreaterThan(0);
        expect(Math.min(...points.map((p) => p.z))).toBeLessThan(0);
        expect(Math.max(...points.map((p) => p.z))).toBeGreaterThan(0);
        expect(
          new Vector3(...poseAt(period - 1).point).distanceTo(
            new Vector3(...poseAt(period + 1).point),
          ),
        ).toBeLessThan(0.01);
        expect(poseAt(86_400_000, true)).toEqual(poseAt(0, true));
        expect(poseAt(0).point).not.toEqual(poseAt(20_000).point);
      }
      for (let at = 0; at <= period * 2; at += period / 200) {
        const items = ambientTraffic(lake.water, at, false, true);
        for (let i = 0; i < items.length; i++)
          for (const other of items.slice(i + 1))
            expect(
              items[i].position.distanceTo(other.position),
            ).toBeGreaterThan(items[i].radius! + other.radius! + 0.18);
      }
    }
  });

  it("shares clearance with moving ships and stationary unresolved paper ships while replay is paused", () => {
    const jobs = [
      task("left", 0, 0),
      task("right", 17, 17),
      task("cross", 0, 17),
      ...Array.from({ length: 3 }, (_, i) =>
        task(`processing${i}`, 0, 3, "buoy"),
      ),
    ];
    const lake = buildLakeLayout(tables, jobs);
    const paths = jobs.map((a) =>
      makePath(a, lake.objects, lake.airports, lake.piers, undefined, lake),
    );
    for (const paused of [true, false])
      for (
        let elapsed = 0;
        elapsed < surfaceLoopMs(lake.water) * 2;
        elapsed += 250
      ) {
        const vessels = jobs.map((a, i) => ({
          key: a.id,
          kind: a.kind,
          fixed: paused || a.kind === "buoy",
          position: positionAt(
            a,
            paths[i],
            paused ? 45_000 : (elapsed % 160_000) + 1000,
          ).position,
        }));
        const swimmers = ambientTraffic(lake.water, elapsed, false, true);
        const resolved = separateTraffic([...vessels, ...swimmers], lake.water);
        for (const swimmer of swimmers) {
          const p = resolved.get(swimmer.key)!;
          expect(insideLake(lake, p.x, p.z)).toBe(true);
          for (const vessel of vessels) {
            const q = resolved.get(vessel.key)!;
            expect(
              Math.hypot(p.x - q.x, p.z - q.z),
              `${swimmer.key} / ${vessel.key} at ${elapsed}`,
            ).toBeGreaterThan(swimmer.radius! + PAPER_SHIP_RADIUS + 0.17);
            if (vessel.fixed) expect(q).toEqual(vessel.position);
          }
          for (const other of swimmers.filter((o) => o.key !== swimmer.key))
            expect(p.distanceTo(resolved.get(other.key)!)).toBeGreaterThan(
              swimmer.radius! + other.radius! + 0.17,
            );
        }
      }
    expect(ambientTraffic(lake.water, 0, true, true)).toEqual(
      ambientTraffic(lake.water, 123456, true, true),
    );
    expect(
      ambientTraffic(lake.water, 0, false, false).map((a) => a.key),
    ).toEqual(["ambient:sailboat"]);
  });

  it("keeps aircraft above the SecondStack mast at crossings", () => {
    const lake = buildLakeLayout(tables);
    const boat = ambientTraffic(lake.water, 0, false, false)[0];
    const plane = {
      key: "plane",
      kind: "plane" as const,
      fixed: false,
      position: boat.position.clone().setY(3.8),
    };
    const positions = separateTraffic([boat, plane], lake.water);
    expect(
      positions.get("plane")!.y - positions.get(boat.key)!.y,
    ).toBeGreaterThanOrEqual(4.3);
  });
});

describe("replay navigation", () => {
  it("leaves clearance between neighboring catalogs for side-berth departures", () => {
    const inventory = Array.from({ length: 48 }, (_, i) => ({
      ...tables[0],
      id: `m:c${Math.floor(i / 6)}.s${Math.floor(i / 3) % 2}.t${i % 3}`,
      catalog: `c${Math.floor(i / 6)}`,
      schema_name: `s${Math.floor(i / 3) % 2}`,
    }));
    const branches = Array.from({ length: 12 }, (_, i) => ({
      ...tables[0],
      id: `m:system.s${i}.t`,
      catalog: "system",
      schema_name: `s${i}`,
    }));
    const jobs = Array.from({ length: 8 }, (_, i) => ({
      ...task(`catalog-${i}`),
      route: {
        ...task(`catalog-${i}`).route,
        source_ids: [inventory[i * 6].id],
        target_ids: [inventory[i * 6 + 3].id],
      },
    }));
    const lake = buildLakeLayout([...inventory, ...branches], jobs);
    for (const a of jobs) {
      const path = makePath(a, lake.objects, [], lake.piers, undefined, lake);
      for (const p of path.curve.getSpacedPoints(300)) {
        for (const pier of lake.piers) {
          const dx = p.x - pier.center[0],
            dz = p.z - pier.center[2];
          const x = dx * Math.cos(pier.rotation) - dz * Math.sin(pier.rotation);
          const z = dx * Math.sin(pier.rotation) + dz * Math.cos(pier.rotation);
          expect(
            Math.abs(x) > pier.width / 2 + PAPER_SHIP_RADIUS ||
              z > pier.depth + PAPER_SHIP_RADIUS ||
              z < -1.55 - PAPER_SHIP_RADIUS,
          ).toBe(true);
        }
      }
    }
  });
  it("parks ships parallel alongside long narrow piers without a jump on completion or overlapping concurrent berths", () => {
    const branches = Array.from({ length: 24 }, (_, i) => ({
      ...tables[0],
      id: `m:system.s${Math.floor(i / 3)}.t${i % 3}`,
      catalog: "system",
      schema_name: `s${Math.floor(i / 3)}`,
    }));
    const inventory = [...tables, ...branches];
    const jobs = inventory.map((o, i) => ({
      ...task(`berth-${i}`),
      replay_duration_ms: 100_000,
      ended_at: 101_000,
      route: {
        ...task(`berth-${i}`).route,
        source_ids: [inventory[(i + 5) % inventory.length].id],
        target_ids: [o.id],
      },
    }));
    const lake = buildLakeLayout(inventory, jobs);
    const parked: Vector3[] = [];
    for (const a of jobs) {
      const path = makePath(a, lake.objects, [], lake.piers, undefined, lake);
      for (const [id, point] of [
        [a.route.source_ids[0], path.from],
        [a.route.target_ids[0], path.to],
      ] as const) {
        const pier = lake.piers.find((p) =>
          p.objects.some((o) => o.id === id),
        )!;
        expect(pier.width).toBeLessThan(2);
        expect(pier.depth).toBeGreaterThanOrEqual(7);
        const dx = point.x - pier.center[0],
          dz = point.z - pier.center[2];
        const x = dx * Math.cos(pier.rotation) - dz * Math.sin(pier.rotation);
        const z = dx * Math.sin(pier.rotation) + dz * Math.cos(pier.rotation);
        expect(Math.abs(x)).toBeGreaterThan(pier.width / 2 + 0.8);
        expect(Math.abs(x)).toBeLessThan(pier.width / 2 + 1.35);
        expect(z).toBeGreaterThan(1);
        expect(z).toBeLessThan(pier.depth - 1);
        parked.push(point);
      }
      const approaching = positionAt(a, path, 100_999);
      const finished = positionAt({ ...a, phase: "succeeded" }, path, 101_000);
      expect(approaching.position.distanceTo(finished.position)).toBeLessThan(
        0.01,
      );
      const pier = lake.piers.find((p) =>
        p.objects.some((o) => o.id === a.route.target_ids[0]),
      )!;
      expect(Math.abs(Math.sin(finished.heading - pier.rotation))).toBeLessThan(
        1e-8,
      );
      expect(Math.cos(approaching.heading - finished.heading)).toBeGreaterThan(
        0.999,
      );
      expect(path.curve.getPointAt(1)).toEqual(path.to);
    }
    parked.forEach((p, i) => {
      for (const q of parked.slice(i + 1))
        expect(p.distanceTo(q)).toBeGreaterThan(PAPER_SHIP_RADIUS * 2 + 0.18);
    });
  });
  it("keeps ships and swimmers clear of the system dock's spine and every branch", () => {
    const branches = Array.from({ length: 36 }, (_, i) => ({
      ...tables[0],
      id: `m:system.s${Math.floor(i / 3)}.t${i % 3}`,
      catalog: "system",
      schema_name: `s${Math.floor(i / 3)}`,
      name: `t${i % 3}`,
    }));
    const jobs = [
      [0, 32],
      [9, 20],
      [30, 5],
    ].map(([source, target], i) => ({
      ...task(`branch-ship-${i}`),
      route: {
        ...task(`branch-ship-${i}`).route,
        source_ids: [branches[source].id],
        target_ids: [branches[target].id],
      },
    }));
    const lake = buildLakeLayout([...tables, ...branches], jobs);
    const system = lake.docks.find((dock) => dock.catalog === "system")!;
    const clear = (p: Vector3) => {
      expect(insideLake(lake, p.x, p.z)).toBe(true);
      const dx = p.x - system.center[0],
        dz = p.z - system.center[2];
      const x = dx * Math.cos(system.rotation) - dz * Math.sin(system.rotation);
      const z = dx * Math.sin(system.rotation) + dz * Math.cos(system.rotation);
      expect(Math.abs(x) > 1.7 || z < -1 || z > system.depth + 1).toBe(true);
      for (const pier of system.piers) {
        const root = harborPoint(pier, 0, -1.1);
        const dx = root[0] - system.center[0],
          dz = root[2] - system.center[2];
        const rx =
          dx * Math.cos(system.rotation) - dz * Math.sin(system.rotation);
        const rz =
          dx * Math.sin(system.rotation) + dz * Math.cos(system.rotation);
        expect(
          x < Math.min(0, rx) - 1.2 ||
            x > Math.max(0, rx) + 1.2 ||
            Math.abs(z - rz) > 1.16,
        ).toBe(true);
      }
      for (const pier of lake.piers) {
        const dx = p.x - pier.center[0],
          dz = p.z - pier.center[2];
        const x = dx * Math.cos(pier.rotation) - dz * Math.sin(pier.rotation);
        const z = dx * Math.sin(pier.rotation) + dz * Math.cos(pier.rotation);
        expect(
          Math.abs(x) > pier.width / 2 + PAPER_SHIP_RADIUS ||
            z > pier.depth + PAPER_SHIP_RADIUS ||
            z < -2.45,
        ).toBe(true);
      }
    };
    for (const job of jobs) {
      const path = makePath(
        job,
        lake.objects,
        lake.airports,
        lake.piers,
        undefined,
        lake,
      );
      for (const point of path.curve.getSpacedPoints(240)) clear(point);
      clear(path.to);
    }
    const period = surfaceLoopMs(lake.water);
    for (let at = 0; at < period; at += period / 240)
      for (const swimmer of ambientTraffic(lake.water, at, false, true))
        clear(swimmer.position);
  });
  it("reserves separate lanes and moorings for overlapping attempts, reusing them after the display window", () => {
    const first = task("first"),
      second = task("second"),
      later = { ...task("later"), started_at: 2000000, ended_at: 2200000 };
    const nav = buildNavigation([first, second, later]);
    const a = nav.slots[vesselKey(first)],
      b = nav.slots[vesselKey(second)];
    expect(a.lane).not.toBe(b.lane);
    expect(a.ports[tables[3].id]).not.toBe(b.ports[tables[3].id]);
    expect(nav.slots[vesselKey(later)].lane).toBe(a.lane);
    expect(buildNavigation([later, second, first])).toEqual(nav);
  });
  it("keeps dense schemas' grouped berths and large unknown-route captures from stacking or leaving the lake", () => {
    const dense = Array.from({ length: 24 }, (_, i) => ({
      ...tables[0],
      id: `m:c.s.t${String(i).padStart(2, "0")}`,
    }));
    const flights = dense.map((o, i) => ({
      ...task(`flight${i}`, 0, 0, "plane"),
      route: { ...task(`flight${i}`, 0, 0, "plane").route, target_ids: [o.id] },
    }));
    const harbor = buildLakeLayout(dense, flights);
    const arrivals = flights.map(
      (a) =>
        makePath(
          a,
          harbor.objects,
          harbor.airports,
          harbor.piers,
          a.route.target_ids[0],
          harbor,
        ).to,
    );
    expect(new Set(arrivals.map((p) => p.toArray().join())).size).toBe(24);
    const buoys = Array.from({ length: 100 }, (_, i) => ({
      ...task(`buoy${i}`, 0, 0, "buoy"),
      route: {
        ...task(`buoy${i}`, 0, 0, "buoy").route,
        evidence: "unknown" as const,
        source_ids: [],
        target_ids: [],
      },
    }));
    const lake = buildLakeLayout([], buoys);
    const centers = buoys.map((a) => {
      const path = makePath(a, lake.objects, [], [], undefined, lake);
      const p = positionAt(a, path, 50000).position;
      expect(insideLake(lake, p.x, p.z)).toBe(true);
      expect(positionAt(a, path, 150000).position).toEqual(p);
      return p;
    });
    centers.forEach((p, i) => {
      for (const q of centers.slice(i + 1))
        expect(p.distanceTo(q)).toBeGreaterThan(2.5);
    });
  });
  it("keeps ship travel and holding loops clear of all timber fingers and inside the water", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task(`ship${i}`, i, (i + 7) % tables.length),
    );
    const layout = buildLakeLayout(tables, tasks);
    for (const a of tasks) {
      const path = makePath(
        a,
        layout.objects,
        layout.airports,
        layout.piers,
        undefined,
        layout,
      );
      for (let t = 1000; t <= 200000; t += 500) {
        const { position: p } = positionAt({ ...a, ended_at: null }, path, t);
        expect(insideLake(layout, p.x, p.z)).toBe(true);
        for (const pier of layout.piers) {
          const dx = p.x - pier.center[0],
            dz = p.z - pier.center[2];
          const localX =
            dx * Math.cos(pier.rotation) - dz * Math.sin(pier.rotation);
          const localZ =
            dx * Math.sin(pier.rotation) + dz * Math.cos(pier.rotation);
          expect(
            Math.abs(localX) > pier.width / 2 + 1 ||
              localZ > pier.depth + 0.8 ||
              localZ < -2.45,
          ).toBe(true);
        }
      }
    }
  });
  it("retains constant planned speed and separates ships where reserved corridors cross", () => {
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task(`ship${i}`, i, (i + 7) % tables.length),
    );
    const layout = buildLakeLayout(tables, tasks);
    const paths = tasks.map((a) =>
      makePath(
        a,
        layout.objects,
        layout.airports,
        layout.piers,
        undefined,
        layout,
      ),
    );
    paths.forEach((path, i) => {
      const nominal = path.length / 90000;
      for (let t = 1000; t < 90000; t += 1000) {
        const step =
          positionAt(tasks[i], path, t).position.distanceTo(
            positionAt(tasks[i], path, t + 10).position,
          ) / 10;
        expect(Math.abs(step - nominal) / nominal).toBeLessThan(0.05);
      }
    });
    for (let t = 1000; t < 160000; t += 3000) {
      const resolved = separateTraffic(
        tasks.map((a, i) => ({
          key: a.id,
          kind: a.kind,
          fixed: false,
          position: positionAt(a, paths[i], t).position,
        })),
        layout.water,
      );
      const positions = [...resolved.values()];
      positions.forEach((p, i) => {
        expect(insideLake(layout, p.x, p.z)).toBe(true);
        for (const q of positions.slice(i + 1))
          expect(p.distanceTo(q)).toBeGreaterThan(PAPER_SHIP_RADIUS * 2 + 0.17);
      });
    }
  });
  it("separates simultaneous planes on the apron and in cruise while keeping arrival off the pier", () => {
    const flight = {
      ...task("flight", 0, 0, "plane"),
      route: {
        ...task("flight", 0, 0, "plane").route,
        target_ids: [tables[0].id, tables[7].id, tables[13].id],
      },
    };
    const layout = buildLakeLayout(tables, [flight]);
    const paths = flight.route.target_ids.map((id) =>
      makePath(
        flight,
        layout.objects,
        layout.airports,
        layout.piers,
        id,
        layout,
      ),
    );
    expect(new Set(paths.map((p) => p.from.toArray().join())).size).toBe(3);
    expect(
      new Set(
        paths.map((p) =>
          p.curve
            .getSpacedPoints(300)
            .reduce((max, v) => Math.max(max, v.y), 0)
            .toFixed(1),
        ),
      ).size,
    ).toBe(3);
    for (const path of paths) {
      expect(path.to.y).toBeGreaterThan(1.5);
      expect(insideLake(layout, path.to.x, path.to.z)).toBe(true);
      expect(Math.abs(path.curve.getTangentAt(1).y)).toBeLessThan(0.01);
    }
  });
  it("expands busy airport aprons away from the lake and keeps queued planes clear of the control tower", () => {
    const flights = Array.from({ length: 20 }, (_, i) => ({
      ...task(`plane${i}`, 0, i % tables.length, "plane"),
      route: {
        ...task(`plane${i}`, 0, i % tables.length, "plane").route,
        external_source: i < 10 ? "A" : "B",
      },
    }));
    const layout = buildLakeLayout(tables, flights);
    const starts = flights.map(
      (a) =>
        makePath(
          a,
          layout.objects,
          layout.airports,
          layout.piers,
          a.route.target_ids[0],
          layout,
        ).from,
    );
    for (const [i, p] of starts.entries()) {
      expect(insideLake(layout, p.x, p.z)).toBe(false);
      expect(Math.abs(p.x) + 1).toBeLessThan(layout.ground.halfWidth);
      for (const q of starts.slice(i + 1))
        expect(p.distanceTo(q)).toBeGreaterThanOrEqual(1.79);
      for (const airport of layout.airports) {
        expect(
          Math.abs(p.x - airport.center[0] - 1.08) > 1.2 ||
            Math.abs(p.z - airport.center[2] + 1.17) > 1.2,
        ).toBe(true);
      }
    }
    for (const flight of flights) {
      const path = makePath(
        flight,
        layout.objects,
        layout.airports,
        layout.piers,
        flight.route.target_ids[0],
        layout,
      );
      expect(
        Math.max(...path.curve.getSpacedPoints(100).map((p) => p.y)),
      ).toBeLessThan(10);
    }
  });
  it("yields at crossings without moving frozen vessels or depending on frame history or input order", () => {
    const water = { halfWidth: 15, halfDepth: 15 };
    const items = [
      {
        key: "frozen",
        kind: "ship" as const,
        position: new Vector3(0, 0.28, 0),
        fixed: true,
      },
      {
        key: "a",
        kind: "ship" as const,
        position: new Vector3(0.1, 0.28, 0),
        fixed: false,
      },
      {
        key: "b",
        kind: "ship" as const,
        position: new Vector3(0.2, 0.28, 0.1),
        fixed: false,
      },
      {
        key: "plane1",
        kind: "plane" as const,
        position: new Vector3(0, 3.8, 0),
        fixed: false,
      },
      {
        key: "plane2",
        kind: "plane" as const,
        position: new Vector3(0, 3.8, 0),
        fixed: false,
      },
    ];
    const resolved = separateTraffic(items, water);
    expect(resolved.get("frozen")).toEqual(items[0].position);
    expect(resolved.get("a")!.distanceTo(resolved.get("b")!)).toBeGreaterThan(
      1.7,
    );
    expect(
      resolved.get("a")!.distanceTo(resolved.get("frozen")!),
    ).toBeGreaterThan(1.7);
    expect(
      Math.abs(resolved.get("plane1")!.y - resolved.get("plane2")!.y),
    ).toBeGreaterThanOrEqual(0.69);
    expect(separateTraffic([...items].reverse(), water)).toEqual(resolved);
    expect(items[1].position.x).toBe(0.1);
  });
});
