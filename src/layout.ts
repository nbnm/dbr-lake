import type { Attempt, LakeObject, Replay, InventoryEntry } from "./types";
import {
  BERTH_SPACING,
  AIR_LEVELS,
  cruiseHeight,
  buildNavigation,
  PORT_ROW_SPACING,
  type NavigationLayout,
} from "./navigation";

export type Point = [number, number, number];
export const CAMERA_OFFSET: Point = [16, 26, 44];
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
  apronExtra: number;
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
  ground: { halfWidth: number; halfDepth: number };
  navigation: NavigationLayout;
  bounds: { min: Point; max: Point };
}

export function lighthousePoint(layout: Pick<LakeLayout, "water">): Point {
  return [-layout.water.halfWidth + 1.4, 0.1, layout.water.halfDepth + 0.65];
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
  const navigation = buildNavigation(attempts, [...byId.values()]);
  const specs = entries.map(([id, catalog]) => {
    const groups = [...catalog.schemas.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const pierWidths = groups.map(([, g]) =>
      Math.max(3.8, Math.min(g.objects.length, 6) * BERTH_SPACING + 1.4),
    );
    const width = Math.max(
      4.5,
      pierWidths.reduce((sum, w) => sum + w, 0) +
        Math.max(0, groups.length - 1) * 1.2,
    );
    return { id, catalog, groups, pierWidths, width };
  });
  const banks: (typeof specs)[] = [[], []];
  const bankWidths = [0, 0];
  for (const spec of specs) {
    const bank = bankWidths[0] <= bankWidths[1] ? 0 : 1;
    if (banks[bank].length) bankWidths[bank] += 3;
    banks[bank].push(spec);
    bankWidths[bank] += spec.width;
  }
  const halfWidth = Math.max(
    entries.length ? 7.2 : 6,
    Math.max(...bankWidths) / 2 + 3.2,
    Math.ceil(Math.sqrt(navigation.lanes.buoy)) * 1.3 + 4,
  );
  let halfDepth = Math.max(
    8.5,
    5.5 + Math.sqrt(entries.length) * 2,
    Math.ceil(
      navigation.lanes.buoy / Math.ceil(Math.sqrt(navigation.lanes.buoy)),
    ) *
      1.3 +
      5,
    7.8 +
      (navigation.portRows - 1) * PORT_ROW_SPACING +
      (navigation.lanes.ship - 1) * 0.9,
  );
  const docks: DockLayout[] = [];
  // Catalog promenades straddle the shoreline. All schema piers extend inward
  // from that continuous bank, rather than sitting on isolated inland islands.
  banks.forEach((bank, index) => {
    const direction = index === 0 ? (1 as const) : (-1 as const);
    let x = -bankWidths[index] / 2;
    bank.forEach(({ id, catalog, groups, pierWidths, width }) => {
      const center: Point = [x + width / 2, 0, 0];
      let px = -width / 2;
      const piers = groups.map(([pid, g], i) => {
        const pw = pierWidths[i];
        const pier: PierLayout = {
          id: pid,
          catalog_id: id,
          catalog: catalog.catalog,
          schema: g.name,
          metastore: catalog.metastore,
          center: [center[0] + direction * (px + pw / 2), 0, direction * 0.5],
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
  });
  const piers = docks.flatMap((d) => d.piers);
  const sources = new Map<
    string,
    Omit<AirportLayout, "center" | "departure" | "side" | "apronExtra">
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
  for (const dock of docks) {
    dock.center[2] = dock.direction * (-halfDepth + 0.55);
    for (const pier of dock.piers) pier.center[2] += dock.center[2];
  }
  const objects = piers.flatMap((pier) =>
    pier.objects.map((o, i) => ({
      ...o,
      position: [
        pier.center[0] +
          pier.direction *
            ((i % pier.slots) - (pier.slots - 1) / 2) *
            BERTH_SPACING,
        0.24,
        pier.center[2] + pier.direction * 2.1,
      ] as Point,
    })),
  );
  const airports = [...sources.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((source, i) => {
      const side = (i % 2 === 0 ? -1 : 1) as 1 | -1;
      const z =
        airportRows === 1
          ? -halfDepth * 0.5
          : (Math.floor(i / 2) - (airportRows - 1) / 2) * 8;
      const center: Point = [side * (halfWidth + 7.5), 0, z];
      const launches = Object.entries(navigation.slots)
        .filter(([key]) => source.attempt_ids.includes(JSON.parse(key)[0]))
        .map(([, slot]) => slot.launch);
      const columns = Math.floor(Math.max(0, ...launches) / 3);
      const apronExtra = columns * 1.9 + (side === 1 && columns > 0 ? 1.9 : 0);
      return {
        ...source,
        center,
        side,
        apronExtra,
        departure: [center[0] - 0.55, 0.45, z + 1.8] as Point,
      };
    });
  const ground = { halfWidth: halfWidth + 11, halfDepth: halfDepth + 6 };
  for (const airport of airports)
    ground.halfWidth = Math.max(
      ground.halfWidth,
      Math.abs(airport.center[0]) + 3.5 + airport.apronExtra,
    );
  const min: Point = [-ground.halfWidth, -0.8, -ground.halfDepth];
  const max: Point = [
    ground.halfWidth,
    Math.max(
      5.1,
      cruiseHeight(Math.min(AIR_LEVELS - 1, navigation.lanes.plane - 1)) + 0.4,
    ),
    ground.halfDepth,
  ];
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
    ground,
    navigation,
    bounds: { min, max },
  };
}

// Projection of the entire diorama at the default orthographic camera angle.
// Padding reserves room for labels and the operational overlays.
export function cameraFit(layout: LakeLayout, width: number, height: number) {
  const forward = CAMERA_OFFSET;
  const length = Math.hypot(...forward);
  const f = forward.map((v) => v / length);
  const rightLength = Math.hypot(f[0], f[2]);
  const r = [f[2] / rightLength, 0, -f[0] / rightLength];
  const u = [f[1] * r[2], f[2] * r[0] - f[0] * r[2], -f[1] * r[0]];
  const projected: [number, number][] = [];
  const boxes = [
    {
      min: [-layout.ground.halfWidth, -0.8, -layout.ground.halfDepth],
      max: [layout.ground.halfWidth, 2.4, layout.ground.halfDepth],
    },
    {
      min: [-layout.water.halfWidth, 0, -layout.water.halfDepth],
      max: [
        layout.water.halfWidth,
        layout.bounds.max[1],
        layout.water.halfDepth,
      ],
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
      min: [
        a.center[0] - 2.3 - (a.side === -1 ? a.apronExtra : 0),
        -0.5,
        a.center[2] - 3.5,
      ],
      max: [
        a.center[0] + 2.3 + (a.side === 1 ? a.apronExtra : 0),
        2,
        a.center[2] + 3.5,
      ],
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
