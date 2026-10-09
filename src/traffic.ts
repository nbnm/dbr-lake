import { Vector3 } from "three";
import type { LakeLayout } from "./layout";
import type { Attempt } from "./types";
import {
  SHIP_SHORE_INSET,
  swimPose,
  SWIM_RADIUS,
  SURFACE_INSET_X,
  SURFACE_INSET_Z,
  openWater,
} from "./wildlife";
import { sailboatPose, SAILBOAT_RADIUS } from "./landmarks";

export interface TrafficPosition {
  key: string;
  kind: Attempt["kind"];
  position: Vector3;
  fixed: boolean;
  radius?: number;
  surfaceHeight?: number;
  insetX?: number;
  insetZ?: number;
}

export function ambientTraffic(
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced: boolean,
  mascots: boolean,
): TrafficPosition[] {
  return (
    ["sailboat", ...(mascots ? (["ducks", "octopus"] as const) : [])] as const
  ).map((kind) => ({
    key: `ambient:${kind}`,
    kind: "ship",
    position: new Vector3(
      ...(kind === "sailboat"
        ? sailboatPose(water, elapsedMs, reduced)
        : swimPose(kind, water, elapsedMs, reduced)
      ).point,
    ),
    fixed: false,
    radius: kind === "sailboat" ? SAILBOAT_RADIUS : SWIM_RADIUS,
    surfaceHeight: kind === "sailboat" ? 4.3 : 1.4,
    insetX: SURFACE_INSET_X,
    insetZ: SURFACE_INSET_Z,
  }));
}

// A local visual safety margin supplements the fixed corridors at crossings.
// This is a pure calculation from the replay and ambient clocks: no frame history, random steering,
// execution delays, or fabricated task state are introduced by yielding.
export function separateTraffic(
  items: TrafficPosition[],
  water: LakeLayout["water"],
) {
  const ordered = [...items].sort((a, b) => a.key.localeCompare(b.key));
  const positions = ordered.map((item) => item.position.clone());
  const constrain = (i: number) => {
    if (ordered[i].kind === "plane" || ordered[i].fixed) return;
    const p = positions[i];
    const insetX = ordered[i].insetX ?? SHIP_SHORE_INSET;
    const insetZ = ordered[i].insetZ ?? 4.1;
    const bounds = openWater(water, insetX, insetZ);
    p.x = Math.max(bounds.minX, Math.min(bounds.maxX, p.x));
    p.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, p.z));
  };
  // At a bank, a radial push can be clipped before it clears the other hull.
  // Slide to the nearest feasible circle/shore-boundary intersection instead.
  const clearFixed = (
    i: number,
    other: Vector3,
    clearance: number,
    desired: Vector3,
  ) => {
    const p = positions[i];
    if (Math.hypot(p.x - other.x, p.z - other.z) >= clearance) return;
    const ix = ordered[i].insetX ?? SHIP_SHORE_INSET;
    const iz = ordered[i].insetZ ?? 4.1;
    const { minX, maxX, minZ, maxZ } = openWater(water, ix, iz);
    const radius = clearance + 0.001;
    const candidates: Vector3[] = [];
    for (const x of [minX, maxX]) {
      const square = radius ** 2 - (x - other.x) ** 2;
      if (square >= 0)
        for (const side of [-1, 1])
          candidates.push(
            new Vector3(x, p.y, other.z + side * Math.sqrt(square)),
          );
    }
    for (const z of [minZ, maxZ]) {
      const square = radius ** 2 - (z - other.z) ** 2;
      if (square >= 0)
        for (const side of [-1, 1])
          candidates.push(
            new Vector3(other.x + side * Math.sqrt(square), p.y, z),
          );
    }
    const feasible = candidates
      .filter((q) => q.x >= minX && q.x <= maxX && q.z >= minZ && q.z <= maxZ)
      .sort(
        (a, b) => a.distanceToSquared(desired) - b.distanceToSquared(desired),
      );
    if (feasible[0]) p.copy(feasible[0]);
  };
  for (let pass = 0; pass < 16; pass++) {
    const cells = new Map<string, number[]>();
    positions.forEach((p, i) => {
      const key = `${Math.floor(p.x / 2.5)}:${Math.floor(p.z / 2.5)}`;
      const bucket = cells.get(key) ?? [];
      bucket.push(i);
      cells.set(key, bucket);
    });
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i],
        p = positions[i];
      const cx = Math.floor(p.x / 2.5),
        cz = Math.floor(p.z / 2.5);
      for (let x = cx - 2; x <= cx + 2; x++)
        for (let z = cz - 2; z <= cz + 2; z++) {
          for (const j of cells.get(`${x}:${z}`) ?? []) {
            if (j <= i) continue;
            const b = ordered[j],
              q = positions[j];
            if (a.fixed && b.fixed) continue;
            const aircraft = a.kind === "plane" || b.kind === "plane";
            const gap =
              a.kind === "plane" && b.kind === "plane"
                ? 0.7
                : Math.max(1.15, a.surfaceHeight ?? 0, b.surfaceHeight ?? 0);
            if (aircraft && Math.abs(p.y - q.y) >= gap) continue;
            const radius = (item: TrafficPosition) =>
              item.radius ?? (item.kind === "plane" ? 1 : 0.82);
            const clearance = radius(a) + radius(b) + 0.18;
            const dx = p.x - q.x,
              dz = p.z - q.z;
            const distance = Math.hypot(dx, dz);
            const flyer =
              a.kind === "plane" && !a.fixed && p.y > 1.2
                ? i
                : b.kind === "plane" && !b.fixed && q.y > 1.2
                  ? j
                  : -1;
            if (flyer >= 0) {
              const horizon = clearance + 1.2;
              if (distance >= horizon) continue;
              const other = flyer === i ? j : i;
              const target =
                positions[other].y +
                gap * Math.sqrt(1 - (distance / horizon) ** 2);
              positions[flyer].y = Math.max(positions[flyer].y, target);
              continue;
            }
            if (distance >= clearance) continue;
            const nx = distance > 0.001 ? dx / distance : i % 2 ? 1 : -1;
            const nz = distance > 0.001 ? dz / distance : 0;
            const amount = clearance - distance + 0.001;
            const shareA = a.fixed ? 0 : b.fixed ? 1 : 0.5;
            const shareB = b.fixed ? 0 : a.fixed ? 1 : 0.5;
            const desiredA = p.clone(),
              desiredB = q.clone();
            p.x += nx * amount * shareA;
            p.z += nz * amount * shareA;
            q.x -= nx * amount * shareB;
            q.z -= nz * amount * shareB;
            constrain(i);
            constrain(j);
            if (b.fixed && !a.fixed) clearFixed(i, q, clearance, desiredA);
            if (a.fixed && !b.fixed) clearFixed(j, p, clearance, desiredB);
          }
        }
    }
  }
  return new Map(ordered.map((item, i) => [item.key, positions[i]]));
}
