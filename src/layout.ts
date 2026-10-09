import type { Attempt, LakeObject, Replay, InventoryEntry } from "./types";
import {
  BERTH_SPACING,
  AIR_LEVELS,
  cruiseHeight,
  buildNavigation,
  PORT_ROW_SPACING,
  SCHEMA_PORTS,
  vesselKey,
  type NavigationLayout,
} from "./navigation";
import { canadianFlagBounds, zeppelinBounds } from "./landmarks";
import { externalAirportName, isExport } from "./vessels";
import { dockShoreInset, shoreFrame, shoreRadius } from "./shoreline";
import { PLANE_APRON_COLUMN_SPACING } from "./vesselSize";

export type Point = [number, number, number];
export const CAMERA_OFFSET: Point = [16, 26, 44];
export const PORTRAIT_CAMERA_OFFSET: Point = [48, 35, 6];
export const MIN_PIER_DEPTH = 7.2;
export const SHIP_BERTH_SPACING = 2.4;
const LAKE_SIZE_FACTOR = 0.9;
const PIER_GAP = 5.4;
export type Shore = "north" | "south" | "west" | "east";
export function harborPoint(
  harbor: { center: Point; rotation: number },
  x: number,
  z: number,
  y = 0,
): Point {
  const c = Math.cos(harbor.rotation),
    s = Math.sin(harbor.rotation);
  return [
    harbor.center[0] + c * x + s * z,
    y,
    harbor.center[2] - s * x + c * z,
  ];
}
export interface PierLayout {
  catalog_id: string;
  id: string;
  catalog: string;
  schema: string;
  metastore: string;
  center: Point;
  shoreAnchor: Point;
  rotation: number;
  bank: Shore;
  branching: boolean;
  width: number;
  depth: number;
  outerSide: -1 | 1;
  objects: LakeObject[];
  slots: number;
}
export function shipBerth(pier: PierLayout, berth: number, y = 0.28): Point {
  const side = pier.branching ? pier.outerSide : berth % 2 ? 1 : -1;
  const row = pier.branching ? berth : Math.floor(berth / 2);
  return harborPoint(
    pier,
    side * (pier.width / 2 + 1.2),
    2 + row * SHIP_BERTH_SPACING,
    y,
  );
}
export interface DockLayout {
  id: string;
  catalog: string;
  metastore: string;
  center: Point;
  rotation: number;
  bank: Shore;
  depth: number;
  branching: boolean;
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
  source_ids: string[];
  role: "ingestion" | "export";
}
export interface LakeLayout {
  objects: LakeObject[];
  docks: DockLayout[];
  piers: PierLayout[];
  airports: AirportLayout[];
  water: {
    halfWidth: number;
    halfDepth: number;
    harborDepth?: Record<Shore, number>;
  };
  ground: { halfWidth: number; halfDepth: number };
  navigation: NavigationLayout;
  bounds: { min: Point; max: Point };
}

export function inHarbor(point: Point, dock: DockLayout, padding = 0) {
  const dx = point[0] - dock.center[0],
    dz = point[2] - dock.center[2];
  const x = dx * Math.cos(dock.rotation) - dz * Math.sin(dock.rotation);
  const z = dx * Math.sin(dock.rotation) + dz * Math.cos(dock.rotation);
  return (
    Math.abs(x) < dock.width / 2 + padding &&
    z > -1.8 - padding &&
    z < dock.depth + padding
  );
}

export function lighthousePoint(layout: Pick<LakeLayout, "water">): Point {
  const { halfWidth: w, halfDepth: d } = layout.water;
  const radius = shoreRadius(w, d);
  const reach = (radius + 1.1) / Math.sqrt(2);
  return [-w + radius - reach, 0.1, d - radius + reach];
}

export function antaresPoint(layout: Pick<LakeLayout, "water">): Point {
  return [layout.water.halfWidth + 4.4, 0.1, layout.water.halfDepth + 1.3];
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

// Use the complete capture, never the current time or filtered activity list.
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

export function buildReplayLakeLayout(replay: Replay): LakeLayout {
  const attempts = captureAttempts(replay);
  const referenced = new Set<string>();
  const include = (a: Attempt) => {
    if (a.route.evidence !== "unknown")
      [...a.route.source_ids, ...a.route.target_ids].forEach((id) =>
        referenced.add(id),
      );
  };
  replay.checkpoint.attempts.forEach(include);
  for (const e of replay.events)
    if (e.type === "attempt.upsert") include(e.payload as unknown as Attempt);
  const usedSchemas = new Set(
    replay.checkpoint.objects
      .filter(
        (o) =>
          referenced.has(o.id) ||
          o.provenance === "system.access.table_lineage",
      )
      .map(schemaId),
  );
  // Lineage also records reads and ad hoc activity without a job-run route.
  // Keep each used schema's full table inventory, while omitting unused piers
  // and catalog-only entries. The stored capture remains complete.
  return buildLakeLayout(
    replay.checkpoint.objects.filter((o) => usedSchemas.has(schemaId(o))),
    attempts,
  );
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
  const landingRows = new Map<string, number>();
  const shipBerths = new Map<string, number>();
  const kinds = new Map(attempts.map((a) => [a.id, a.kind]));
  for (const [key, slot] of Object.entries(navigation.slots)) {
    if (kinds.get(JSON.parse(key)[0]) !== "plane") continue;
    for (const [id, row] of Object.entries(slot.ports))
      landingRows.set(id, Math.max(landingRows.get(id) ?? 0, row));
  }
  for (const a of attempts) {
    if (a.kind !== "ship") continue;
    for (const [id, berth] of Object.entries(
      navigation.slots[vesselKey(a)]?.ports ?? {},
    ))
      shipBerths.set(id, Math.max(shipBerths.get(id) ?? 0, berth));
  }
  const specs = entries.map(([id, catalog]) => {
    const groups = [...catalog.schemas.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );
    // Table density never widens a pier. Concurrent ships can extend its
    // length to reserve enough moorings directly along the sides.
    const branching = groups.length > 3;
    const pierWidths = groups.map(() => 1.6);
    const pierDepths = groups.map(([, group]) => {
      let berth = 0;
      for (const object of group.objects)
        berth = Math.max(berth, shipBerths.get(object.id) ?? 0);
      const row = branching ? berth : Math.floor(berth / 2);
      return Math.max(MIN_PIER_DEPTH, 3.6 + row * SHIP_BERTH_SPACING);
    });
    let maxPortRow = 0;
    for (const [, group] of groups)
      for (const object of group.objects)
        maxPortRow = Math.max(maxPortRow, landingRows.get(object.id) ?? 0);
    const pierDepth = Math.max(MIN_PIER_DEPTH, ...pierDepths);
    const rowSpacing = pierDepth + 3.4;
    const pierSpan =
      pierWidths.reduce((sum, w) => sum + w, 0) +
      Math.max(0, groups.length - 1) * PIER_GAP;
    const width = Math.max(4.5, branching ? 13 : pierSpan);
    return {
      id,
      catalog,
      groups,
      pierWidths,
      pierDepths,
      pierSpan,
      width,
      branching,
      rowSpacing,
      depth: branching
        ? 3 +
          pierDepth +
          (Math.ceil(groups.length / 2) - 1) * rowSpacing +
          3.4 +
          maxPortRow * PORT_ROW_SPACING
        : pierDepth + 3.4 + maxPortRow * PORT_ROW_SPACING,
    };
  });
  const shores: Shore[] = ["north", "south", "west", "east"];
  const banks: (typeof specs)[] = [[], [], [], []];
  const bankWidths = [0, 0, 0, 0];
  for (const spec of [...specs].sort(
    (a, b) =>
      Number(b.branching) - Number(a.branching) ||
      b.width - a.width ||
      a.id.localeCompare(b.id),
  )) {
    const bank = bankWidths.indexOf(Math.min(...bankWidths));
    if (banks[bank].length) bankWidths[bank] += PIER_GAP;
    banks[bank].push(spec);
    bankWidths[bank] += spec.width;
  }
  const depths = banks.map((bank) =>
    Math.max(0, ...bank.map((spec) => spec.depth)),
  );
  let halfWidth = Math.max(
    entries.length ? 10 : 9.5,
    Math.max(bankWidths[0], bankWidths[1]) / 2 + 5,
    Math.max(depths[2], depths[3]) > 3.4
      ? Math.max(depths[2], depths[3]) + 12
      : 0,
    Math.ceil(Math.sqrt(navigation.lanes.buoy)) * 1.3 + 4,
    7.8 +
      (navigation.portRows - 1) * PORT_ROW_SPACING +
      (navigation.lanes.ship - 1) * 0.9,
  );
  let halfDepth = Math.max(
    9,
    halfWidth * 0.7,
    Math.max(bankWidths[2], bankWidths[3]) / 2 + 5,
    Math.max(depths[0], depths[1]) > 3.4
      ? Math.max(depths[0], depths[1]) + 12
      : 0,
    10 + Math.sqrt(entries.length) * 2,
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
  const sources = new Map<
    string,
    Omit<AirportLayout, "center" | "departure" | "side" | "apronExtra">
  >();
  for (const a of attempts) {
    const external = externalAirportName(a);
    const exporting = isExport(a);
    if (a.kind !== "plane" || !external || a.route.evidence === "unknown")
      continue;
    const target = byId.get(
      (exporting ? a.route.source_ids : a.route.target_ids)[0],
    );
    const scope = target?.metastore_id ?? a.workspace_id;
    const id = [
      exporting ? "external-export" : "external",
      a.account_id,
      scope,
      external,
    ]
      .map(encodeURIComponent)
      .join("/");
    const source = sources.get(id) ?? {
      id,
      name: external,
      scope,
      role: exporting ? ("export" as const) : ("ingestion" as const),
      attempt_ids: [],
      workspace_ids: [],
      target_ids: [],
      source_ids: [],
    };
    source.attempt_ids = [...new Set([...source.attempt_ids, a.id])];
    source.workspace_ids = [
      ...new Set([...source.workspace_ids, a.workspace_id]),
    ];
    source.target_ids = [
      ...new Set([...source.target_ids, ...a.route.target_ids]),
    ];
    source.source_ids = [
      ...new Set([...source.source_ids, ...a.route.source_ids]),
    ];
    sources.set(id, source);
  }
  const airportRows = Math.ceil(sources.size / 2);
  halfDepth = Math.max(halfDepth, (airportRows - 1) * 4 + 4.5);
  halfWidth = Math.max(halfWidth, halfDepth * 0.7);
  halfWidth *= LAKE_SIZE_FACTOR;
  halfDepth *= LAKE_SIZE_FACTOR;
  // Reserve the broad corners before packing docks, and keep enough open
  // water for the complete set of vessel lanes and processing moorings.
  for (let pass = 0; pass < 24; pass++) {
    const radius = shoreRadius(halfWidth, halfDepth);
    const inset = radius * (1 - Math.SQRT1_2) + 2.1;
    const nextWidth = Math.max(
      halfWidth,
      Math.max(bankWidths[0], bankWidths[1]) / 2 + radius + 1.1,
      Math.ceil(Math.sqrt(navigation.lanes.buoy)) * 1.3 + inset + 1,
      3 + inset + (navigation.lanes.ship - 1) * 0.9,
    );
    const nextDepth = Math.max(
      halfDepth,
      Math.max(bankWidths[2], bankWidths[3]) / 2 + radius + 1.1,
      Math.ceil(
        navigation.lanes.buoy / Math.ceil(Math.sqrt(navigation.lanes.buoy)),
      ) *
        1.3 +
        inset +
        1,
      3 + inset + (navigation.lanes.ship - 1) * 0.9,
    );
    if (nextWidth - halfWidth < 0.001 && nextDepth - halfDepth < 0.001) break;
    halfWidth = nextWidth;
    halfDepth = nextDepth;
  }
  const harborDepth = [...depths];
  const rotations = [0, Math.PI, Math.PI / 2, -Math.PI / 2];
  banks.forEach((bank, index) => {
    const rotation = rotations[index];
    let along = -bankWidths[index] / 2;
    for (const spec of bank) {
      const offset = dockShoreInset(
        shores[index],
        (index === 1 || index === 2 ? -1 : 1) * (along + spec.width / 2),
        spec.width + 0.6,
        { halfWidth, halfDepth },
      );
      const origin: Point =
        index < 2
          ? [0, 0, (index === 0 ? -1 : 1) * (halfDepth - offset - 0.55)]
          : [(index === 2 ? -1 : 1) * (halfWidth - offset - 0.55), 0, 0];
      harborDepth[index] = Math.max(
        harborDepth[index],
        spec.depth + offset + 0.55,
      );
      const center = harborPoint(
        { center: origin, rotation },
        along + spec.width / 2,
        0,
      );
      const dock: DockLayout = {
        id: spec.id,
        catalog: spec.catalog.catalog,
        metastore: spec.catalog.metastore,
        center,
        rotation,
        bank: shores[index],
        width: spec.width,
        depth: spec.depth,
        branching: spec.branching,
        piers: [],
        objects: [],
      };
      let px = -spec.pierSpan / 2;
      dock.piers = spec.groups.map(([id, group], i) => {
        const side = i % 2 ? 1 : -1;
        const width = spec.pierWidths[i];
        const origin = harborPoint(
          dock,
          spec.branching ? side * 3.8 : px + width / 2,
          0,
        );
        const shoreAlong = origin[index < 2 ? 0 : 2];
        const frame = shoreFrame(
          { halfWidth, halfDepth },
          shores[index],
          shoreAlong,
        );
        const center = spec.branching
          ? harborPoint(
              dock,
              side * 3.8,
              3 + Math.floor(i / 2) * spec.rowSpacing,
            )
          : harborPoint(
              { center: frame.point, rotation: frame.rotation },
              0,
              0.6,
            );
        const pier: PierLayout = {
          id,
          catalog_id: dock.id,
          catalog: dock.catalog,
          schema: group.name,
          metastore: dock.metastore,
          bank: dock.bank,
          branching: dock.branching,
          center,
          shoreAnchor: frame.point,
          rotation: frame.rotation,
          width,
          depth: spec.pierDepths[i],
          outerSide: side as -1 | 1,
          slots: Math.min(group.objects.length, SCHEMA_PORTS),
          objects: [...group.objects].sort((a, b) => a.id.localeCompare(b.id)),
        };
        px += width + PIER_GAP;
        return pier;
      });
      dock.objects = dock.piers.flatMap((pier) => pier.objects);
      docks.push(dock);
      along += spec.width + PIER_GAP;
    }
  });
  const piers = docks.flatMap((dock) => dock.piers);
  const objects = piers.flatMap((pier) =>
    pier.objects.map((o, i) => ({
      ...o,
      position: harborPoint(
        pier,
        ((i % pier.slots) - (pier.slots - 1) / 2) * BERTH_SPACING,
        pier.depth - 0.2,
        0.24,
      ),
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
      const apronExtra =
        columns * PLANE_APRON_COLUMN_SPACING +
        (side === 1 && columns > 0 ? PLANE_APRON_COLUMN_SPACING : 0);
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
      zeppelinBounds({ halfWidth, halfDepth }).max[1],
      canadianFlagBounds({ halfWidth, halfDepth }).max[1],
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
    water: {
      halfWidth,
      halfDepth,
      harborDepth: Object.fromEntries(
        shores.map((shore, i) => [shore, harborDepth[i]]),
      ) as Record<Shore, number>,
    },
    ground,
    navigation,
    bounds: { min, max },
  };
}

// Projection of the entire diorama at the default orthographic camera angle.
// Padding reserves room for labels and the operational overlays.
export function cameraFit(
  layout: LakeLayout,
  width: number,
  height: number,
  offset: Point = CAMERA_OFFSET,
) {
  const forward = offset;
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
        Math.max(
          5.1,
          cruiseHeight(
            Math.min(AIR_LEVELS - 1, layout.navigation.lanes.plane - 1),
          ) + 0.4,
        ),
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
    {
      min: [antaresPoint(layout)[0] - 1.5, -0.1, antaresPoint(layout)[2] - 1.2],
      max: [antaresPoint(layout)[0] + 1.5, 8.2, antaresPoint(layout)[2] + 1.2],
    },
    zeppelinBounds(layout.water),
    canadianFlagBounds(layout.water),
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
  // Match CameraRig's target, including asymmetric landmarks above the shore.
  // Fitting the distance from this target keeps both edges within the viewport.
  const target = [
    (layout.bounds.min[0] + layout.bounds.max[0]) / 2,
    2,
    (layout.bounds.min[2] + layout.bounds.max[2]) / 2,
  ];
  const center = [
    target[0] * r[0] + target[2] * r[2],
    target[0] * u[0] + target[1] * u[1] + target[2] * u[2],
  ];
  const span = (axis: number) =>
    2 * Math.max(...projected.map((p) => Math.abs(p[axis] - center[axis])));
  return Math.max(
    0.25,
    Math.min(
      (width - (width < 600 ? 50 : 65)) / span(0),
      (height - 85) / span(1),
    ),
  );
}
