import { Shape } from "three";
import type { LakeLayout, Point, Shore } from "./layout";

type WaterSize = Pick<LakeLayout["water"], "halfWidth" | "halfDepth">;

export function shoreRadius(width: number, depth: number) {
  return Math.min(18, Math.min(width, depth) * 0.52);
}

// Low, smooth bays vary by bank, with a flat tangent at each rounded corner.
export function bankInset(bank: Shore, along: number, water: WaterSize) {
  const horizontal = bank === "north" || bank === "south";
  const radius = shoreRadius(water.halfWidth, water.halfDepth);
  const limit = (horizontal ? water.halfWidth : water.halfDepth) - radius;
  const u = Math.min(1, Math.abs(along / limit));
  if (u === 1) return 0;
  const phase = { north: 0.4, south: 2.1, west: 4.2, east: 5.7 }[bank];
  const t = along / limit;
  const amplitude = Math.min(
    0.75,
    Math.min(water.halfWidth, water.halfDepth) * 0.035,
  );
  return (
    amplitude *
    (1 - u * u) ** 2 *
    (0.5 +
      0.35 * Math.sin(t * Math.PI + phase) +
      0.15 * Math.sin(t * Math.PI * 2 + phase * 0.7))
  );
}

export function shorePoint(
  water: WaterSize,
  bank: Shore,
  along: number,
): Point {
  const horizontal = bank === "north" || bank === "south";
  const axis = horizontal ? water.halfWidth : water.halfDepth;
  const cross = horizontal ? water.halfDepth : water.halfWidth;
  const radius = shoreRadius(water.halfWidth, water.halfDepth);
  const corner = Math.max(
    0,
    Math.min(radius, Math.abs(along) - (axis - radius)),
  );
  const edge =
    cross -
    radius +
    Math.sqrt(radius ** 2 - corner ** 2) -
    bankInset(bank, along, water);
  const sign = bank === "north" || bank === "west" ? -1 : 1;
  return horizontal ? [along, 0, sign * edge] : [sign * edge, 0, along];
}

// Use the same polygon as the rendered water, so the inward axis is exactly
// perpendicular to the local shore segment rather than a compass direction.
export function shoreFrame(water: WaterSize, bank: Shore, along: number) {
  const target = shorePoint(water, bank, along);
  const points = shorelinePoints(water.halfWidth, water.halfDepth);
  let distance = Infinity;
  let point: Point = target;
  let rotation = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length];
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const length = Math.hypot(dx, dz);
    const t = Math.max(
      0,
      Math.min(
        1,
        ((target[0] - a[0]) * dx + (target[2] - a[2]) * dz) / length ** 2,
      ),
    );
    const candidate: Point = [a[0] + t * dx, 0, a[2] + t * dz];
    const gap = Math.hypot(candidate[0] - target[0], candidate[2] - target[2]);
    if (gap < distance) {
      distance = gap;
      point = candidate;
      rotation = Math.atan2(-dz / length, dx / length);
    }
  });
  return { point, rotation };
}

// Seat the catalog's bank-aligned promenade across the whole shoreline.
export function dockShoreInset(
  bank: Shore,
  along: number,
  width: number,
  water: WaterSize,
) {
  return Math.max(
    ...Array.from({ length: 33 }, (_, i) =>
      bankInset(bank, along - width / 2 + (width * i) / 32, water),
    ),
  );
}

export function shorelinePoints(width: number, depth: number) {
  const radius = shoreRadius(width, depth);
  const water = { halfWidth: width, halfDepth: depth };
  const points: Point[] = [];
  const side = (bank: Shore, from: number, to: number) => {
    for (let i = 0; i < 48; i++)
      points.push(shorePoint(water, bank, from + ((to - from) * i) / 48));
  };
  const corner = (x: number, z: number, angle: number) => {
    for (let i = 0; i < 20; i++) {
      const a = angle + ((Math.PI / 2) * i) / 20;
      points.push([x + Math.cos(a) * radius, 0, z + Math.sin(a) * radius]);
    }
  };
  side("north", -width + radius, width - radius);
  corner(width - radius, -depth + radius, -Math.PI / 2);
  side("east", -depth + radius, depth - radius);
  corner(width - radius, depth - radius, 0);
  side("south", width - radius, -width + radius);
  corner(-width + radius, depth - radius, Math.PI / 2);
  side("west", depth - radius, -depth + radius);
  corner(-width + radius, -depth + radius, Math.PI);
  return points;
}

export function lakeOutline(width: number, depth: number) {
  const points = shorelinePoints(width, depth);
  const shape = new Shape();
  shape.moveTo(points[0][0], -points[0][2]);
  for (const [x, , z] of points.slice(1)) shape.lineTo(x, -z);
  shape.closePath();
  return shape;
}

export function insideWater(
  x: number,
  z: number,
  water: WaterSize,
  margin = 0,
) {
  const size = {
    halfWidth: water.halfWidth - margin,
    halfDepth: water.halfDepth - margin,
  };
  if (Math.abs(x) >= size.halfWidth || Math.abs(z) >= size.halfDepth)
    return false;
  const north = shorePoint(size, "north", x)[2];
  const south = shorePoint(size, "south", x)[2];
  const west = shorePoint(size, "west", z)[0];
  const east = shorePoint(size, "east", z)[0];
  return z > north && z < south && x > west && x < east;
}

// The outer terrain has its own outline, keeping airport aprons on solid land.
export function terrainOutline(width: number, depth: number) {
  const shape = new Shape();
  const r = Math.min(6, Math.min(width, depth) * 0.35);
  // Small, deterministic shoreline variations preserve the usable harbor area.
  shape.moveTo(-width + r, -depth);
  shape.bezierCurveTo(
    -width / 2,
    -depth - 0.22,
    width / 2,
    -depth + 0.18,
    width - r,
    -depth,
  );
  shape.quadraticCurveTo(width, -depth, width, -depth + r);
  shape.bezierCurveTo(
    width + 0.22,
    -depth / 2,
    width - 0.12,
    depth / 2,
    width,
    depth - r,
  );
  shape.quadraticCurveTo(width, depth, width - r, depth);
  shape.bezierCurveTo(
    width / 2,
    depth + 0.24,
    -width / 2,
    depth - 0.18,
    -width + r,
    depth,
  );
  shape.quadraticCurveTo(-width, depth, -width, depth - r);
  shape.bezierCurveTo(
    -width - 0.18,
    depth / 2,
    -width + 0.16,
    -depth / 2,
    -width,
    -depth + r,
  );
  shape.quadraticCurveTo(-width, -depth, -width + r, -depth);
  return shape;
}
