import { Shape } from "three";

export function lakeOutline(width: number, depth: number) {
  const shape = new Shape();
  const r = 2.7;
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
