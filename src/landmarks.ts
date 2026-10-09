import type { LakeLayout, Point } from "./layout";
import { surfacePose, openWater } from "./wildlife";
import { SAILBOAT_SIZE_MULTIPLIER } from "./landmarkSize";

export const SAILBOAT_RADIUS = 1.8 * SAILBOAT_SIZE_MULTIPLIER;

export function canadianFlag(water: LakeLayout["water"]) {
  const width = Math.max(4.8, Math.min(14, water.halfWidth * 0.17)) * 0.7;
  return {
    point: [water.halfWidth + 2.4, 0.1, -water.halfDepth - 2.8] as Point,
    width,
    height: width / 2,
    poleHeight: Math.max(12, width * 1.6 + 1),
  };
}

export function canadianFlagBounds(water: LakeLayout["water"]) {
  const { point, width, poleHeight } = canadianFlag(water);
  // Allow the unfurled cloth to face every camera yaw and ripple in the breeze.
  const reach = width * 1.1;
  return {
    min: [point[0] - reach, 0, point[2] - reach] as Point,
    max: [
      point[0] + reach,
      point[1] + poleHeight + 0.3,
      point[2] + reach,
    ] as Point,
  };
}

export function sailboatPose(
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
) {
  const pose = surfacePose("sailboat", water, elapsedMs, reduced);
  const phase = reduced ? 0 : elapsedMs / 5500;
  return {
    point: [
      pose.point[0],
      pose.point[1] +
        0.08 * (SAILBOAT_SIZE_MULTIPLIER - 1) +
        (reduced ? 0 : Math.sin(phase) * 0.018),
      pose.point[2],
    ] as Point,
    heading: pose.heading,
    roll: reduced ? 0 : Math.sin(phase * 0.9) * 0.025,
  };
}

export function inSailingArea(point: Point, water: LakeLayout["water"]) {
  const bounds = openWater(water);
  return (
    point[0] > bounds.minX - SAILBOAT_RADIUS - 0.4 &&
    point[0] < bounds.maxX + SAILBOAT_RADIUS + 0.4 &&
    point[2] > bounds.minZ - SAILBOAT_RADIUS - 0.4 &&
    point[2] < bounds.maxZ + SAILBOAT_RADIUS + 0.4
  );
}

export const ZEPPELIN_LOOP_MS = 150_000;

export function zeppelinDimensions(water: LakeLayout["water"]) {
  const length = Math.max(8, Math.min(16, water.halfWidth * 0.3));
  return { length, radius: length * 0.115, gondolaDrop: length * 0.11 };
}

// A separate sky lane: the entire airship stays above the highest plane lane.
// Absolute ambient time makes the loop continuous across replay seeks/pauses.
export function zeppelinPose(
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
) {
  const phase = reduced ? 0.55 : (elapsedMs / ZEPPELIN_LOOP_MS) * Math.PI * 2;
  const rx = water.halfWidth * 0.46;
  const rz = water.halfDepth * 0.25;
  const { radius, gondolaDrop } = zeppelinDimensions(water);
  return {
    point: [
      Math.sin(phase) * rx,
      10.5 + radius + gondolaDrop + Math.sin(phase * 2) * 0.18,
      -water.halfDepth * 0.16 + Math.cos(phase) * rz,
    ] as Point,
    heading: Math.atan2(Math.sin(phase) * rz, Math.cos(phase) * rx),
    roll: Math.sin(phase) * 0.018,
  };
}

export function zeppelinBounds(water: LakeLayout["water"]) {
  const { length, radius, gondolaDrop } = zeppelinDimensions(water);
  // The radius encloses the hull and fins at every heading, including banking.
  const reach = length * 0.56;
  return {
    min: [
      -water.halfWidth * 0.46 - reach,
      10,
      -water.halfDepth * 0.41 - reach,
    ] as Point,
    max: [
      water.halfWidth * 0.46 + reach,
      10.5 + radius * 2.4 + gondolaDrop + 0.35,
      water.halfDepth * 0.09 + reach,
    ] as Point,
  };
}
