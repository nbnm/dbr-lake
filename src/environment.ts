import { lighthousePoint, type LakeLayout, type Point } from "./layout";

export interface FieldPatch {
  center: Point;
  width: number;
  depth: number;
  crop: "wheat" | "meadow" | "tilled";
}
export interface ForestTree {
  point: Point;
  scale: number;
  shade: number;
}
export interface CountryRoad {
  from: Point;
  to: Point;
}

export function buildSurroundings(layout: LakeLayout) {
  const { halfWidth: w, halfDepth: d } = layout.water;
  const roads: CountryRoad[] = [];
  const corners: Point[] = [
    [-w - 2, 0.085, -d - 2],
    [w + 2, 0.085, -d - 2],
    [w + 2, 0.085, d + 2],
    [-w - 2, 0.085, d + 2],
  ];
  corners.forEach((from, i) => roads.push({ from, to: corners[(i + 1) % 4] }));
  for (const airport of layout.airports) {
    roads.push({
      from: [airport.side * (w + 2), 0.085, airport.center[2] + 0.8],
      to: [
        airport.center[0] - airport.side * 2.1,
        0.085,
        airport.center[2] + 0.8,
      ],
    });
  }
  const fields: FieldPatch[] = [-1, 1].flatMap((side) =>
    [-0.65, 0.04, 0.7].map((fraction, i) => ({
      center: [fraction * w, 0.1, side * (d + 4.1)] as Point,
      width: Math.min(7.5, w * 0.43),
      depth: 2.65,
      crop: (["meadow", "tilled", "wheat"] as const)[
        (i + (side === 1 ? 1 : 0)) % 3
      ],
    })),
  );
  const trees: ForestTree[] = [];
  const tower = lighthousePoint(layout);
  const nearRoad = (x: number, z: number) =>
    roads.some(({ from, to }) => {
      const dx = to[0] - from[0],
        dz = to[2] - from[2];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((x - from[0]) * dx + (z - from[2]) * dz) / (dx * dx + dz * dz),
        ),
      );
      return Math.hypot(x - from[0] - t * dx, z - from[2] - t * dz) < 0.9;
    });
  // Deterministic groves with clearings, rather than a uniform ring of trees.
  const step = Math.max(
    1.35,
    Math.sqrt((layout.ground.halfWidth * layout.ground.halfDepth) / 130),
  );
  for (
    let x = -layout.ground.halfWidth + 1.1, col = 0;
    x < layout.ground.halfWidth - 1;
    x += step, col++
  ) {
    for (
      let z = -layout.ground.halfDepth + 1.1, row = 0;
      z < layout.ground.halfDepth - 1;
      z += step, row++
    ) {
      const seed = col * 13.7 + row * 4.1;
      const px = x + Math.sin(seed) * 0.32,
        pz = z + Math.cos(seed * 1.3) * 0.3;
      if (Math.abs(px) < w + 1.5 && Math.abs(pz) < d + 2.7) continue;
      if (Math.sin(px * 0.42 + pz * 0.18) + Math.cos(pz * 0.37) < -0.3)
        continue;
      if (
        fields.some(
          (f) =>
            Math.abs(px - f.center[0]) < f.width / 2 + 0.65 &&
            Math.abs(pz - f.center[2]) < f.depth / 2 + 0.65,
        )
      )
        continue;
      if (
        layout.airports.some(
          (a) =>
            Math.abs(px - a.center[0] - (a.side * a.apronExtra) / 2) <
              3.2 + a.apronExtra / 2 && Math.abs(pz - a.center[2]) < 4.1,
        )
      )
        continue;
      if (Math.hypot(px - tower[0], pz - tower[2]) < 2 || nearRoad(px, pz))
        continue;
      // Keep the rounded outer corners clear as well.
      if (
        Math.abs(px) > layout.ground.halfWidth - 3 &&
        Math.abs(pz) > layout.ground.halfDepth - 3
      )
        continue;
      trees.push({
        point: [px, 0.075, pz],
        scale: 0.7 + (Math.sin(seed * 2) + 1) * 0.25,
        shade: (col + row) % 3,
      });
    }
  }
  return { fields, trees, roads };
}
