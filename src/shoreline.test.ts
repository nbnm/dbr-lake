import { describe, expect, it } from "vitest";
import type { Shape } from "three";
import {
  insideWater,
  lakeOutline,
  shoreRadius,
  terrainOutline,
} from "./shoreline";
import { openWater } from "./wildlife";

function polygonContains(shape: Shape, x: number, z: number) {
  const points = shape.getPoints(64);
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i],
      b = points[j];
    if (
      -a.y > z !== -b.y > z &&
      x < ((b.x - a.x) * (z + a.y)) / (-b.y + a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

const sizes = [
  [9.5, 9],
  [37.9, 46],
  [120, 90],
];

describe("rounded natural shoreline", () => {
  it("cuts back all four corners while preserving the central lake across inventory sizes", () => {
    for (const [w, d] of sizes) {
      const water = lakeOutline(w, d);
      const radius = shoreRadius(w, d);
      expect(polygonContains(water, 0, 0)).toBe(true);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          expect(
            polygonContains(
              water,
              sx * (w - radius * 0.14),
              sz * (d - radius * 0.14),
            ),
          ).toBe(false);
          expect(polygonContains(water, sx * (w - 1), 0)).toBe(true);
          expect(polygonContains(water, 0, sz * (d - 1))).toBe(true);
        }
      expect(water.getPoints()).toEqual(lakeOutline(w, d).getPoints());
    }
  });

  it("keeps boundary checks aligned with rendered water and nests the shoreline ring on solid terrain", () => {
    for (const [w, d] of sizes) {
      const size = { halfWidth: w, halfDepth: d };
      const water = lakeOutline(w, d);
      const shore = lakeOutline(w + 0.65, d + 0.65);
      const ground = terrainOutline(w + 11, d + 6);
      for (const p of water.getPoints()) {
        expect(polygonContains(shore, p.x, -p.y)).toBe(true);
        expect(polygonContains(ground, p.x, -p.y)).toBe(true);
      }
      for (let i = -20; i <= 20; i++)
        for (let j = -20; j <= 20; j++) {
          const x = (w * i) / 20,
            z = (d * j) / 20;
          if (insideWater(x, z, size, 0.06))
            expect(polygonContains(water, x, z)).toBe(true);
          if (!insideWater(x, z, size, -0.06))
            expect(polygonContains(water, x, z)).toBe(false);
        }
    }
  });

  it("keeps even the corners of the cruising area inside water with room for a full sailboat hull", () => {
    for (const [w, d] of sizes) {
      const size = { halfWidth: w, halfDepth: d };
      const water = lakeOutline(w, d);
      const bounds = openWater(size);
      for (const x of [bounds.minX, bounds.maxX])
        for (const z of [bounds.minZ, bounds.maxZ]) {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 8)
            expect(
              polygonContains(
                water,
                x + Math.cos(a) * 1.8,
                z + Math.sin(a) * 1.8,
              ),
            ).toBe(true);
        }
    }
  });
});
