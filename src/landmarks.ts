import type { LakeLayout, Point } from "./layout";
import { surfacePose, SURFACE_INSET_X, SURFACE_INSET_Z } from "./wildlife";

export const SAILBOAT_RADIUS = 1.8;

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
      pose.point[1] + (reduced ? 0 : Math.sin(phase) * 0.018),
      pose.point[2],
    ] as Point,
    heading: pose.heading,
    roll: reduced ? 0 : Math.sin(phase * 0.9) * 0.025,
  };
}

export function inSailingArea(point: Point, water: LakeLayout["water"]) {
  return (
    Math.abs(point[0]) <
      water.halfWidth - SURFACE_INSET_X + SAILBOAT_RADIUS + 0.4 &&
    Math.abs(point[2]) <
      water.halfDepth - SURFACE_INSET_Z + SAILBOAT_RADIUS + 0.4
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

export function t1aShoreSign(water: LakeLayout["water"]) {
  const width = Math.max(5.2, Math.min(13, water.halfWidth * 0.3));
  const logoWidth = width - 0.75;
  const height = (logoWidth * 350) / 911 + 0.6;
  return {
    point: [0, 0.08, water.halfDepth + 4.1] as Point,
    width,
    height,
    logoWidth,
    centerY: 0.35 + height / 2,
  };
}

export function t1aShoreSignBounds(water: LakeLayout["water"]) {
  const { point, width, height, centerY } = t1aShoreSign(water);
  // The panel faces the camera, so include its full yaw sweep.
  return {
    min: [-width / 2, 0, point[2] - width / 2] as Point,
    max: [
      width / 2,
      point[1] + centerY + height / 2,
      point[2] + width / 2,
    ] as Point,
  };
}
