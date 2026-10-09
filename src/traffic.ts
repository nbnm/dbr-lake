import { Vector3 } from "three";
import type { LakeLayout } from "./layout";
import type { Attempt } from "./types";

export interface TrafficPosition {
  key: string;
  kind: Attempt["kind"];
  position: Vector3;
  fixed: boolean;
}

// A local visual safety margin supplements the fixed corridors at crossings.
// This is a pure event-time calculation: no frame history, random steering,
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
    p.x = Math.max(-water.halfWidth + 3, Math.min(water.halfWidth - 3, p.x));
    p.z = Math.max(
      -water.halfDepth + 4.1,
      Math.min(water.halfDepth - 4.1, p.z),
    );
  };
  for (let pass = 0; pass < 8; pass++) {
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
            const gap = a.kind === "plane" && b.kind === "plane" ? 0.7 : 1.15;
            if (aircraft && Math.abs(p.y - q.y) >= gap) continue;
            const radius = (kind: Attempt["kind"]) =>
              kind === "plane" ? 1 : kind === "ship" ? 0.82 : 0.35;
            const clearance = radius(a.kind) + radius(b.kind) + 0.18;
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
            p.x += nx * amount * shareA;
            p.z += nz * amount * shareA;
            q.x -= nx * amount * shareB;
            q.z -= nz * amount * shareB;
            constrain(i);
            constrain(j);
          }
        }
    }
  }
  return new Map(ordered.map((item, i) => [item.key, positions[i]]));
}
