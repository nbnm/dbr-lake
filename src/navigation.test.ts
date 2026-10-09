import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { buildLakeLayout, lighthousePoint, antaresPoint } from "./layout";
import { buildNavigation, vesselKey } from "./navigation";
import { makePath, positionAt } from "./motion";
import { buildSurroundings } from "./environment";
import { lakeOutline } from "./shoreline";
import { sailboatPose, SAILBOAT_RADIUS } from "./landmarks";
import { separateTraffic } from "./traffic";
import { swimPose, SWIM_RADIUS } from "./wildlife";
import type { Attempt, LakeObject } from "./types";

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
        for (const x of [
          dock.center[0] - dock.width / 2,
          dock.center[0],
          dock.center[0] + dock.width / 2,
        ]) {
          expect(
            insideLake(layout, x, dock.center[2] - dock.direction * 1.4),
          ).toBe(false);
          expect(
            insideLake(layout, x, dock.center[2] - dock.direction * 0.2),
          ).toBe(true);
        }
        for (const pier of dock.piers)
          expect(
            insideLake(
              layout,
              pier.center[0],
              pier.center[2] - pier.direction * 1.4,
            ),
          ).toBe(false);
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
      for (const d of layout.docks)
        expect(
          Math.abs(x - d.center[0]) > d.width / 2 + 0.6 ||
            Math.abs(z - d.center[2]) > 2,
        ).toBe(true);
    }
    expect(
      buildSurroundings(
        buildLakeLayout([...tables].reverse(), [task("flight", 0, 3, "plane")]),
      ),
    ).toEqual(surroundings);
  });
});

describe("SecondStack shore mooring", () => {
  it("keeps the hull in water and clear of mascot lanes and ship travel/holding positions", () => {
    const ships = [
      task("left", 0, 0),
      task("right", 17, 17),
      task("cross", 0, 17),
    ];
    const layouts = [
      buildLakeLayout([]),
      buildLakeLayout(tables, ships),
      buildLakeLayout(
        Array.from({ length: 30 }, (_, i) => ({
          ...tables[0],
          id: `m:c${i}.s.t`,
          catalog: `c${i}`,
        })),
        ships,
      ),
    ];
    for (const layout of layouts) {
      for (let at = 0; at < 420000; at += 5000) {
        const boat = sailboatPose(layout.water, at);
        for (const [x, z] of [
          [0, 1.65],
          [-0.6, 0.65],
          [-0.55, -1.3],
          [0.55, -1.3],
          [0.6, 0.65],
        ]) {
          const px =
            boat.point[0] +
            x * Math.cos(boat.heading) +
            z * Math.sin(boat.heading);
          const pz =
            boat.point[2] -
            x * Math.sin(boat.heading) +
            z * Math.cos(boat.heading);
          expect(insideLake(layout, px, pz)).toBe(true);
        }
        for (const mascot of ["ducks", "octopus"] as const) {
          const p = swimPose(mascot, layout.water, at).point;
          expect(
            Math.hypot(p[0] - boat.point[0], p[2] - boat.point[2]),
          ).toBeGreaterThan(SAILBOAT_RADIUS + SWIM_RADIUS + 0.18);
        }
      }
      const center = sailboatPose(layout.water, 0).point;
      for (const ship of ships) {
        if (!layout.objects.some((o) => o.id === ship.route.source_ids[0]))
          continue;
        const path = makePath(
          ship,
          layout.objects,
          layout.airports,
          layout.piers,
          undefined,
          layout,
        );
        for (const p of [
          ...path.curve.getSpacedPoints(100),
          ...Array.from(
            { length: 60 },
            (_, i) => positionAt(ship, path, 181000 + i * 1000).position,
          ),
        ])
          expect(Math.hypot(p.x - center[0], p.z - center[2])).toBeGreaterThan(
            SAILBOAT_RADIUS + 0.82 + 0.18,
          );
      }
      expect(sailboatPose(layout.water, 0, true)).toEqual(
        sailboatPose(layout.water, 123456, true),
      );
    }
  });
});

describe("replay navigation", () => {
  it("keeps both mascots in separate open-water lanes throughout the full replay day", () => {
    const layouts = [buildLakeLayout([]), buildLakeLayout(tables)];
    for (const layout of layouts) {
      for (let at = 0; at <= 86_400_000; at += 60_000) {
        const duck = swimPose("ducks", layout.water, at);
        const octopus = swimPose("octopus", layout.water, at);
        expect(
          new Vector3(...duck.point).distanceTo(new Vector3(...octopus.point)),
        ).toBeGreaterThan(SWIM_RADIUS * 2);
        for (const pose of [duck, octopus]) {
          expect(Math.abs(pose.point[0]) + SWIM_RADIUS).toBeLessThan(
            layout.water.halfWidth - 0.3,
          );
          expect(Math.abs(pose.point[2]) + SWIM_RADIUS).toBeLessThan(
            layout.water.halfDepth - 2.7,
          );
          for (const pier of layout.piers)
            expect(Math.abs(pose.point[0] - pier.center[0])).toBeGreaterThan(
              pier.width / 2 + SWIM_RADIUS,
            );
        }
      }
    }
  });
  it("swims at an ambient pace and holds visible positions with reduced motion", () => {
    const water = buildLakeLayout(tables).water;
    for (const mascot of ["ducks", "octopus"] as const) {
      const first = swimPose(mascot, water, 123456789);
      swimPose(mascot, water, 123456789 + 86_400_000);
      expect(swimPose(mascot, water, 123456789)).toEqual(first);
      expect(swimPose(mascot, water, 123476789).point).not.toEqual(first.point);
      expect(
        new Vector3(...swimPose(mascot, water, 1000).point).distanceTo(
          new Vector3(...swimPose(mascot, water, 0).point),
        ),
      ).toBeGreaterThan(0.2);
      expect(swimPose(mascot, water, 123456789, true)).toEqual(
        swimPose(mascot, water, 123556789, true),
      );
    }
  });
  it("leaves mascot lanes clear of ship turns, frozen holding positions and processing buoys", () => {
    const ships = [
      task("left", 0, 0),
      task("right", 17, 17),
      task("cross", 0, 17),
    ];
    const buoys = Array.from({ length: 100 }, (_, i) =>
      task(`buoy${i}`, 0, 3, "buoy"),
    );
    for (const attempts of [ships, buoys]) {
      const layout = buildLakeLayout(tables, attempts);
      for (const a of attempts) {
        const path = makePath(
          a,
          layout.objects,
          layout.airports,
          layout.piers,
          undefined,
          layout,
        );
        const positions =
          a.kind === "buoy"
            ? [path.from]
            : [
                ...path.curve.getSpacedPoints(100),
                ...Array.from(
                  { length: 60 },
                  (_, i) => positionAt(a, path, 181000 + i * 1000).position,
                ),
              ];
        for (const mascot of ["ducks", "octopus"] as const) {
          for (let at = 0; at < 420_000; at += 10_000) {
            const point = new Vector3(
              ...swimPose(mascot, layout.water, at).point,
            );
            const radius = a.kind === "buoy" ? 0.35 : 0.82;
            for (const position of positions)
              expect(
                Math.hypot(point.x - position.x, point.z - position.z),
                `${a.id} / ${mascot} at ${at}: ${position.toArray()} vs ${point.toArray()}`,
              ).toBeGreaterThan(SWIM_RADIUS + radius + 0.18);
          }
        }
      }
    }
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
          const localZ = (p.z - pier.center[2]) * pier.direction;
          expect(
            Math.abs(p.x - pier.center[0]) > pier.width / 2 + 1 ||
              localZ > 3.05 ||
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
          expect(p.distanceTo(q)).toBeGreaterThan(1.6);
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
    expect(layout.bounds.max[1]).toBeLessThan(10);
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
