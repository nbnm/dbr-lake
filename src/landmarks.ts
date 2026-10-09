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

export function t1aBackdrop(water: LakeLayout["water"]) {
  const width = Math.max(5.2, Math.min(13, water.halfWidth * 0.3));
  const logoWidth = width - 0.75;
  const height = (logoWidth * 350) / 911 + 0.6;
  return {
    point: [0, 0.08, -water.halfDepth - 4.6] as Point,
    width,
    height,
    logoWidth,
    centerY: 3.2 + height / 2,
  };
}

export function t1aBackdropBounds(water: LakeLayout["water"]) {
  const { point, width, height, centerY } = t1aBackdrop(water);
  // The raised panel faces the camera, so include its full yaw sweep.
  return {
    min: [-width / 2, 0, point[2] - width / 2] as Point,
    max: [
      width / 2,
      point[1] + centerY + height / 2,
      point[2] + width / 2,
    ] as Point,
  };
}
