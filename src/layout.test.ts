import { describe, expect, it } from "vitest";
import type { Attempt, LakeObject } from "./types";
import { buildLakeLayout, cameraFit, schemaId } from "./layout";
import { makePath, positionAt } from "./motion";

function inventory(schemas: number, tables = 3): LakeObject[] {
  return Array.from({ length: schemas * tables }, (_, i) => ({
    id: `metastore:catalog.schema_${Math.floor(i / tables)}.table_${i % tables}`,
    metastore_id: "metastore",
    catalog: `catalog_${Math.floor(i / tables / 2)}`,
    schema_name: `schema_${Math.floor(i / tables)}`,
    name: `table_${i % tables}`,
    type: "table",
    workspace_ids: ["east", "west"],
    position: [0, 0, 0],
  }));
}
function ingestion(id: string, target: string, name = "Event Hubs"): Attempt {
  return {
    id,
    account_id: "account",
    workspace_id: "east",
    job_id: "job",
    run_id: "run",
    task_run_id: id,
    task_key: id,
    attempt_number: 0,
    name: "Ingest",
    kind: "plane",
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
      evidence: "configured",
      external_source: name,
      source_ids: [],
      target_ids: [target],
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
}

describe("inventory-driven harbor", () => {
  it("groups schemas as piers of catalog docks and retains empty catalog/schema inventory", () => {
    const tables = inventory(6);
    const layout = buildLakeLayout(tables);
    expect(layout.docks).toHaveLength(3);
    expect(layout.piers).toHaveLength(6);
    expect(
      layout.docks.every(
        (d) =>
          d.piers.length === 2 && d.piers.every((p) => p.catalog_id === d.id),
      ),
    ).toBe(true);
    const empty = buildLakeLayout(
      [],
      [],
      [
        { metastore_id: "m", catalog: "empty", schema_name: null },
        { metastore_id: "m", catalog: "empty", schema_name: "raw" },
      ],
    );
    expect(empty.docks).toHaveLength(1);
    expect(empty.piers).toHaveLength(1);
    expect(empty.objects).toHaveLength(0);
  });
  it("handles empty and single-table inventories without a hardcoded center table", () => {
    const empty = buildLakeLayout([]);
    expect(empty.docks).toHaveLength(0);
    expect(empty.objects).toHaveLength(0);
    const one = buildLakeLayout(inventory(1, 1));
    expect(one.docks).toHaveLength(1);
    expect(one.piers[0].slots).toBe(1);
    expect(one.objects[0].position.every(Number.isFinite)).toBe(true);
    expect(cameraFit(empty, 390, 350)).toBeGreaterThan(0);
  });
  it("grows both lake dimensions and frames a larger inventory", () => {
    const single = buildLakeLayout(inventory(1, 1));
    const small = buildLakeLayout(inventory(6));
    expect(single.water.halfWidth).toBeLessThan(small.water.halfWidth);
    expect(single.water.halfDepth).toBeLessThan(small.water.halfDepth);
    const large = buildLakeLayout(inventory(48));
    expect(large.docks).toHaveLength(24);
    expect(large.piers).toHaveLength(48);
    expect(large.water.halfWidth).toBeGreaterThan(small.water.halfWidth);
    expect(large.water.halfDepth).toBeGreaterThan(small.water.halfDepth);
    expect(cameraFit(large, 1100, 450)).toBeLessThan(
      cameraFit(small, 1100, 450),
    );
  });
  it("packs docks without overlap and keeps every berth inside the lake", () => {
    for (const n of [1, 2, 6, 7, 30, 100]) {
      const layout = buildLakeLayout(inventory(n, 8));
      for (const dock of layout.docks) {
        expect(Math.abs(dock.center[0]) + dock.width / 2).toBeLessThan(
          layout.water.halfWidth,
        );
        for (const other of layout.docks.filter((d) => d.id !== dock.id))
          expect(
            Math.abs(other.center[2] - dock.center[2]) > 4 ||
              Math.abs(other.center[0] - dock.center[0]) >
                (other.width + dock.width) / 2 + 1,
          ).toBe(true);
      }
      for (const o of layout.objects) {
        expect(Math.abs(o.position[0])).toBeLessThan(layout.water.halfWidth);
        expect(Math.abs(o.position[2])).toBeLessThan(layout.water.halfDepth);
      }
    }
  });
  it("deduplicates shared objects and separates identically named schemas across metastores", () => {
    const [table] = inventory(1, 1);
    const regional = {
      ...table,
      id: "eu:catalog.schema_0.table_0",
      metastore_id: "eu",
    };
    const layout = buildLakeLayout([table, table, regional]);
    expect(layout.objects).toHaveLength(2);
    expect(layout.docks).toHaveLength(2);
    expect(schemaId(table)).not.toBe(schemaId(regional));
  });
  it("sizes dock modules from table count and retains the complete dense-schema inventory", () => {
    const one = buildLakeLayout(inventory(1, 1));
    const many = buildLakeLayout(inventory(1, 100));
    expect(many.docks[0].width).toBeGreaterThan(one.docks[0].width);
    expect(many.piers[0].slots).toBe(6);
    expect(many.objects).toHaveLength(100);
    expect(new Set(many.objects.map((o) => o.id)).size).toBe(100);
  });
  it("keeps topology deterministic across discovery order and repeated observations", () => {
    const tables = inventory(6);
    const attempts = [
      ingestion("a", tables[0].id),
      ingestion("b", tables[4].id),
    ];
    const full = buildLakeLayout(tables, attempts);
    expect(buildLakeLayout([...tables].reverse(), attempts).objects).toEqual(
      full.objects,
    );
    const reordered = buildLakeLayout(
      [...tables].reverse(),
      [...attempts].reverse().concat(attempts),
    );
    expect(reordered.airports.map((p) => [p.id, p.center])).toEqual(
      full.airports.map((p) => [p.id, p.center]),
    );
    expect(full.airports).toHaveLength(1);
    expect(full.airports[0].target_ids).toHaveLength(2);
  });
  it("creates airports only for supported external ingestion, with metastore-scoped identity", () => {
    const tables = inventory(2, 1);
    const first = ingestion("a", tables[0].id);
    const unknown = {
      ...ingestion("unknown", tables[1].id),
      route: { ...first.route, evidence: "unknown" as const },
    };
    const internal = {
      ...ingestion("internal", tables[1].id),
      kind: "buoy" as const,
    };
    expect(
      buildLakeLayout(tables, [first, first, unknown, internal]).airports,
    ).toHaveLength(1);
    const eu = { ...tables[1], metastore_id: "eu" };
    expect(
      buildLakeLayout([tables[0], eu], [first, ingestion("eu", eu.id)])
        .airports,
    ).toHaveLength(2);
  });
  it("launches a plane at its source runway and retains constant arc-length speed", () => {
    const tables = inventory(6);
    const a = ingestion("flight", tables[0].id);
    const layout = buildLakeLayout(tables, [a]);
    const path = makePath(a, layout.objects, layout.airports, layout.piers);
    expect(path.from.toArray()).toEqual(layout.airports[0].departure);
    expect(positionAt(a, path, 1000).position.toArray()).toEqual(
      layout.airports[0].departure,
    );
    const nominal = path.length / 90;
    for (let t = 1000; t < 89000; t += 1000) {
      const distance = positionAt(a, path, t).position.distanceTo(
        positionAt(a, path, t + 1000).position,
      );
      expect(Math.abs(distance - nominal) / nominal).toBeLessThan(0.05);
    }
    expect(positionAt(a, path, 250000).holding).toBe(true);
    const before = positionAt(a, path, 90999).position;
    const after = positionAt(a, path, 91001).position;
    expect(before.distanceTo(after)).toBeLessThan(0.002);
    expect(Math.abs(path.curve.getTangentAt(1).y)).toBeLessThan(0.001);
  });
  it("places south-bank table identities at the matching rotated berth", () => {
    const layout = buildLakeLayout(inventory(6));
    const dock = layout.piers.find((d) => d.direction === -1)!;
    const first = layout.objects.find((o) => o.id === dock.objects[0].id)!;
    expect(first.position[0]).toBeGreaterThan(dock.center[0]);
    expect(first.position[2]).toBeLessThan(dock.center[2]);
    const a = {
      ...ingestion("ship", dock.objects[1].id),
      kind: "ship" as const,
      route: {
        ...ingestion("ship", dock.objects[1].id).route,
        external_source: null,
        source_ids: [dock.objects[0].id],
      },
    };
    const path = makePath(a, layout.objects, [], layout.piers);
    expect(path.curve.getTangentAt(0).z).toBeLessThan(0);
    expect(path.end.z).toBeLessThan(path.to.z);
    expect(path.curve.getTangentAt(1).z).toBeGreaterThan(0);
  });
  it("adds shoreline space for multiple airports without overlapping aprons", () => {
    const tables = inventory(1, 1);
    const flights = Array.from({ length: 12 }, (_, i) =>
      ingestion(`flight_${i}`, tables[0].id, `Source ${i}`),
    );
    const layout = buildLakeLayout(tables, flights);
    expect(layout.airports).toHaveLength(12);
    expect(layout.water.halfDepth).toBeGreaterThan(
      buildLakeLayout(tables).water.halfDepth,
    );
    for (const airport of layout.airports) {
      expect(Math.abs(airport.center[2]) + 3.5).toBeLessThan(
        layout.water.halfDepth,
      );
      for (const other of layout.airports.filter(
        (p) => p.id !== airport.id && p.side === airport.side,
      ))
        expect(Math.abs(airport.center[2] - other.center[2])).toBeGreaterThan(
          6.5,
        );
    }
  });
});
