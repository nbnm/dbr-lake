import type { LakeLayout, Point } from "./layout";

export const SAILBOAT_RADIUS = 1.8;

// A shore mooring outside the ship corridors and the mascots' swimming lanes.
export function sailboatPose(
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
) {
  const phase = reduced ? 0 : elapsedMs / 5500;
  return {
    point: [
      water.halfWidth - 2.15,
      0.13 + (reduced ? 0 : Math.sin(phase) * 0.018),
      -water.halfDepth + 2.9,
    ] as Point,
    heading: -Math.PI / 3 + (reduced ? 0 : Math.sin(phase * 0.6) * 0.025),
    roll: reduced ? 0 : Math.sin(phase * 0.9) * 0.025,
  };
}

export function inSailboatMooring(point: Point, water: LakeLayout["water"]) {
  const center = sailboatPose(water, 0).point;
  return (
    Math.hypot(point[0] - center[0], point[2] - center[2]) <
    SAILBOAT_RADIUS + 0.4
  );
}
