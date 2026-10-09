import type { LakeLayout, Point } from "./layout";

export type LakeMascot = "ducks" | "octopus";
export const SWIM_RADIUS = 1.35;
export const SHIP_SHORE_INSET = 4.8;
export const BUOY_SHORE_INSET = 4.7;
const SHORE_INSET = 2.1;
const LOOP_WIDTH = 0.28;

// Opposite shoreline lanes stay clear of piers, central buoys and ship routes.
// Ambient animation time keeps swimming independent of replay controls.
export function swimPose(
  mascot: LakeMascot,
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
): { point: Point; heading: number; phase: number } {
  const side = mascot === "ducks" ? 1 : -1;
  const period = mascot === "ducks" ? 28_000 : 34_000;
  const phase =
    (reduced ? 0 : (((elapsedMs % period) + period) % period) / period) *
      Math.PI *
      2 +
    (mascot === "ducks" ? 0.8 : 2.2);
  const length = Math.min(2.1, water.halfDepth - 5.1);
  return {
    point: [
      side * (water.halfWidth - SHORE_INSET) + Math.sin(phase) * LOOP_WIDTH,
      0.22 + (reduced ? 0 : Math.sin(phase * 2) * 0.016),
      Math.cos(phase) * length,
    ],
    heading: Math.atan2(
      Math.cos(phase) * LOOP_WIDTH,
      -Math.sin(phase) * length,
    ),
    phase,
  };
}

export function inSwimmingArea(point: Point, water: LakeLayout["water"]) {
  return (
    Math.abs(point[0]) >
      water.halfWidth - SHORE_INSET - LOOP_WIDTH - SWIM_RADIUS - 0.25 &&
    Math.abs(point[2]) <
      Math.min(2.1, water.halfDepth - 5.1) + SWIM_RADIUS + 0.25
  );
}
