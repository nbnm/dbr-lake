import type { Attempt, LakeObject } from "./types";
import { expandVessels } from "./vessels";

export const BERTH_SPACING = 1.8;
export const PORT_ROW_SPACING = 1.9;
export const AIR_LEVELS = 6;
export const cruiseHeight = (lane: number) => 3.8 + (lane % AIR_LEVELS) * 0.85;

export function vesselKey(a: Attempt, destinationId?: string) {
  return JSON.stringify([a.id, destinationId ?? null]);
}

export interface NavigationSlot {
  lane: number;
  ports: Record<string, number>;
  launch: number;
}
export interface NavigationLayout {
  slots: Record<string, NavigationSlot>;
  lanes: Record<Attempt["kind"], number>;
  portRows: number;
}

// Reserve space from the complete capture, including the 15-minute terminal
// display window. Seeking and filtering never reassign a vessel's lane or berth.
export function buildNavigation(
  attempts: Attempt[],
  objects: LakeObject[] = [],
): NavigationLayout {
  const groups = new Map<string, LakeObject[]>();
  for (const object of objects) {
    const group = JSON.stringify([
      object.metastore_id,
      object.catalog,
      object.schema_name,
    ]);
    const tables = groups.get(group) ?? [];
    tables.push(object);
    groups.set(group, tables);
  }
  const physicalPorts = new Map<string, string>();
  for (const [group, tables] of groups) {
    tables
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((o, i) =>
        physicalPorts.set(o.id, `${group}/${i % Math.min(6, tables.length)}`),
      );
  }
  const unique = new Map(attempts.map((a) => [a.id, a]));
  const vessels = expandVessels([...unique.values()]).sort(
    (a, b) =>
      (a.attempt.started_at ?? a.attempt.observed_at) -
        (b.attempt.started_at ?? b.attempt.observed_at) ||
      a.key.localeCompare(b.key),
  );
  const pools = new Map<string, number[]>();
  const slots: NavigationLayout["slots"] = {};
  const lanes = { plane: 1, ship: 1, buoy: 1 };
  let portRows = 1;
  function reserve(pool: string, start: number, end: number) {
    const ends = pools.get(pool) ?? [];
    let index = ends.findIndex((t) => t < start);
    if (index < 0) index = ends.length;
    ends[index] = end;
    pools.set(pool, ends);
    return index;
  }
  for (const { attempt: a, destinationId, key } of vessels) {
    const start = a.started_at ?? a.observed_at;
    const end = (a.ended_at ?? Infinity) + 900_000;
    const lane = reserve(`lane:${a.kind}`, start, end);
    const ports: Record<string, number> = {};
    if (a.kind !== "buoy" && a.route.evidence !== "unknown") {
      const ids =
        a.kind === "plane"
          ? [destinationId].filter((id): id is string => !!id)
          : [a.route.source_ids[0], a.route.target_ids[0]].filter(Boolean);
      for (const id of new Set(ids)) {
        ports[id] = reserve(`port:${physicalPorts.get(id) ?? id}`, start, end);
        portRows = Math.max(portRows, ports[id] + 1);
      }
    }
    slots[key] = {
      lane,
      ports,
      launch:
        a.kind === "plane"
          ? reserve(
              `apron:${a.account_id}:${a.route.external_source}`,
              start,
              end,
            )
          : 0,
    };
    lanes[a.kind] = Math.max(lanes[a.kind], lane + 1);
  }
  return { slots, lanes, portRows };
}
