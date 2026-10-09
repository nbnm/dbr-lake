import type { Attempt, LakeObject, Replay, InventoryEntry } from "./types";

export type Point = [number, number, number];
export interface PierLayout {
  catalog_id: string;
  id: string;
  catalog: string;
  schema: string;
  metastore: string;
  center: Point;
  direction: 1 | -1;
  width: number;
  objects: LakeObject[];
  slots: number;
}
export interface DockLayout {
  id: string;
  catalog: string;
  metastore: string;
  center: Point;
  direction: 1 | -1;
  width: number;
  piers: PierLayout[];
  objects: LakeObject[];
}
export interface AirportLayout {
  id: string;
  name: string;
  scope: string;
  center: Point;
  departure: Point;
  side: 1 | -1;
  attempt_ids: string[];
  workspace_ids: string[];
  target_ids: string[];
}
export interface LakeLayout {
  objects: LakeObject[];
  docks: DockLayout[];
  piers: PierLayout[];
  airports: AirportLayout[];
  water: { halfWidth: number; halfDepth: number };
  bounds: { min: Point; max: Point };
}

export function lighthousePoint(layout: Pick<LakeLayout, "water">): Point {
  return [-layout.water.halfWidth + 0.9, 0.1, layout.water.halfDepth - 1.4];
}

export function catalogId(
  o: Pick<LakeObject, "metastore_id" | "catalog">,
): string {
  return [o.metastore_id, o.catalog].map(encodeURIComponent).join("/");
}

export function schemaId(
  o: Pick<LakeObject, "metastore_id" | "catalog" | "schema_name">,
): string {
  return [o.metastore_id, o.catalog, o.schema_name]
    .map(encodeURIComponent)
    .join("/");
}

// Use the capture's inventory, never a filtered or time-dependent activity list.
// Airports and berths therefore stay in place when seeking or filtering.
export function captureAttempts(replay: Replay): Attempt[] {
  const attempts = new Map<string, Attempt>();
  const add = (a: Attempt) =>
    attempts.set(JSON.stringify([a.id, a.route.version]), a);
  replay.checkpoint.attempts.forEach(add);
  for (const event of replay.events)
    if (event.type === "attempt.upsert")
      add(event.payload as unknown as Attempt);
  return [...attempts.values()];
}

export function buildLakeLayout(
  inventory: LakeObject[],
  attempts: Attempt[] = [],
  hierarchy: InventoryEntry[] = [],
): LakeLayout {
  const byId = new Map(inventory.map((o) => [o.id, o]));
  const catalogs = new Map<
    string,
    {
      catalog: string;
      metastore: string;
      schemas: Map<string, { name: string; objects: LakeObject[] }>;
    }
  >();
  const add = (entry: InventoryEntry) => {
    const id = catalogId(entry);
    if (!catalogs.has(id))
      catalogs.set(id, {
        catalog: entry.catalog,
        metastore: entry.metastore_id,
        schemas: new Map(),
      });
    const catalog = catalogs.get(id)!;
    if (entry.schema_name !== null) {
      const sid = schemaId({ ...entry, schema_name: entry.schema_name });
      if (!catalog.schemas.has(sid))
        catalog.schemas.set(sid, { name: entry.schema_name, objects: [] });
    }
  };
  hierarchy.forEach(add);
  for (const o of byId.values()) {
    add(o);
    catalogs.get(catalogId(o))!.schemas.get(schemaId(o))!.objects.push(o);
  }
  const entries = [...catalogs.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const columns = Math.max(1, Math.ceil(Math.sqrt(entries.length)));
  const rows = Math.max(1, Math.ceil(entries.length / columns));
  const docks: DockLayout[] = [];
  let longestRow = 0;
  for (let row = 0; row < rows; row++) {
    const batch = entries.slice(row * columns, (row + 1) * columns);
    const pierGroups = batch.map(([, catalog]) =>
      [...catalog.schemas.entries()].sort(([a], [b]) => a.localeCompare(b)),
    );
    const pierWidths = pierGroups.map((groups) =>
      groups.map(([, g]) =>
        Math.max(3.6, Math.min(g.objects.length, 6) * 0.9 + 1.3),
      ),
    );
    const widths = pierWidths.map((w) =>
      Math.max(
        4.5,
        w.reduce((sum, n) => sum + n, 0) + Math.max(0, w.length - 1) * 1.2,
      ),
    );
    const rowWidth =
      widths.reduce((sum, w) => sum + w, 0) + Math.max(0, batch.length - 1) * 3;
    longestRow = Math.max(longestRow, rowWidth);
    let x = -rowWidth / 2;
    batch.forEach(([id, catalog], index) => {
      const width = widths[index],
        direction = row % 2 === 0 ? (1 as const) : (-1 as const);
      const center: Point = [
        x + width / 2,
        0,
        rows === 1 ? -3.2 : (row - (rows - 1) / 2) * 10.5,
      ];
      let px = -width / 2;
      const piers = pierGroups[index].map(([pid, g], i) => {
        const pw = pierWidths[index][i];
        const pier: PierLayout = {
          id: pid,
          catalog_id: id,
          catalog: catalog.catalog,
          schema: g.name,
          metastore: catalog.metastore,
          center: [
            center[0] + direction * (px + pw / 2),
            0,
            center[2] + direction * 0.5,
          ],
          direction,
          width: pw,
          slots: Math.min(g.objects.length, 6),
          objects: [...g.objects].sort((a, b) => a.id.localeCompare(b.id)),
        };
        px += pw + 1.2;
        return pier;
      });
      docks.push({
        id,
        catalog: catalog.catalog,
        metastore: catalog.metastore,
        center,
        direction,
        width,
        piers,
        objects: piers.flatMap((p) => p.objects),
      });
      x += width + 3;
    });
  }
  const piers = docks.flatMap((d) => d.piers);
  const halfWidth = Math.max(entries.length ? 7.2 : 6, longestRow / 2 + 3);
  let halfDepth = Math.max(
    entries.length ? 6.5 : 5.5,
    ((rows - 1) * 10.5) / 2 + 4.6,
  );
  const objects = piers.flatMap((pier) =>
    pier.objects.map((o, i) => ({
      ...o,
      position: [
        pier.center[0] +
          pier.direction * ((i % pier.slots) - (pier.slots - 1) / 2) * 0.9,
        0.24,
        pier.center[2] + pier.direction * 2.1,
      ] as Point,
    })),
  );
  const sources = new Map<
    string,
    Omit<AirportLayout, "center" | "departure" | "side">
  >();
  for (const a of attempts) {
    if (
      a.kind !== "plane" ||
      !a.route.external_source ||
      a.route.evidence === "unknown"
    )
      continue;
    const target = byId.get(a.route.target_ids[0]);
    const scope = target?.metastore_id ?? a.workspace_id;
    const id = ["external", a.account_id, scope, a.route.external_source]
      .map(encodeURIComponent)
      .join("/");
    const source = sources.get(id) ?? {
      id,
      name: a.route.external_source,
      scope,
      attempt_ids: [],
      workspace_ids: [],
      target_ids: [],
    };
    source.attempt_ids = [...new Set([...source.attempt_ids, a.id])];
    source.workspace_ids = [
      ...new Set([...source.workspace_ids, a.workspace_id]),
    ];
    source.target_ids = [
      ...new Set([...source.target_ids, ...a.route.target_ids]),
    ];
    sources.set(id, source);
  }
  const airportRows = Math.ceil(sources.size / 2);
  halfDepth = Math.max(halfDepth, (airportRows - 1) * 4 + 4.5);
  const airports = [...sources.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((source, i) => {
      const side = (i % 2 === 0 ? -1 : 1) as 1 | -1;
      const z =
        airportRows === 1
          ? -halfDepth * 0.5
          : (Math.floor(i / 2) - (airportRows - 1) / 2) * 8;
      const center: Point = [side * (halfWidth + 3.2), 0, z];
      return {
        ...source,
        center,
        side,
        departure: [center[0] - 0.55, 0.45, z + 1.8] as Point,
      };
    });
  const min: Point = [-halfWidth - 0.7, -0.8, -halfDepth - 0.7];
  const max: Point = [halfWidth + 0.7, 5.1, halfDepth + 0.7];
  for (const airport of airports) {
    min[0] = Math.min(min[0], airport.center[0] - 2.3);
    min[2] = Math.min(min[2], airport.center[2] - 3.5);
    max[0] = Math.max(max[0], airport.center[0] + 2.3);
    max[2] = Math.max(max[2], airport.center[2] + 3.5);
  }
  return {
    objects,
    docks,
    piers,
    airports,
    water: { halfWidth, halfDepth },
    bounds: { min, max },
  };
}

// Projection of the entire diorama at the default orthographic camera angle.
// Padding reserves room for labels and the operational overlays.
export function cameraFit(layout: LakeLayout, width: number, height: number) {
  const forward = [22, 26, 28];
  const length = Math.hypot(...forward);
  const f = forward.map((v) => v / length);
  const rightLength = Math.hypot(f[0], f[2]);
  const r = [f[2] / rightLength, 0, -f[0] / rightLength];
  const u = [f[1] * r[2], f[2] * r[0] - f[0] * r[2], -f[1] * r[0]];
  const projected: [number, number][] = [];
  const boxes = [
    {
      min: [-layout.water.halfWidth - 0.7, -0.8, -layout.water.halfDepth - 0.7],
      max: [layout.water.halfWidth + 0.7, 2, layout.water.halfDepth + 0.7],
    },
    {
      min: [
        lighthousePoint(layout)[0] - 1.4,
        -0.3,
        lighthousePoint(layout)[2] - 1.4,
      ],
      max: [
        lighthousePoint(layout)[0] + 1.4,
        5.1,
        lighthousePoint(layout)[2] + 1.4,
      ],
    },
    ...layout.airports.map((a) => ({
      min: [a.center[0] - 2.3, -0.5, a.center[2] - 3.5],
      max: [a.center[0] + 2.3, 2, a.center[2] + 3.5],
    })),
  ];
  for (const box of boxes)
    for (const x of [box.min[0], box.max[0]])
      for (const y of [box.min[1], box.max[1]])
        for (const z of [box.min[2], box.max[2]])
          projected.push([x * r[0] + z * r[2], x * u[0] + y * u[1] + z * u[2]]);
  const span = (axis: number) =>
    Math.max(...projected.map((p) => p[axis])) -
    Math.min(...projected.map((p) => p[axis]));
  return Math.max(
    0.25,
    Math.min(
      (width - (width < 600 ? 105 : 65)) / span(0),
      (height - 85) / span(1),
    ),
  );
}
