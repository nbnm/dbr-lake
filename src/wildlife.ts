import type { LakeLayout, Point } from "./layout";

export type LakeMascot = "ducks" | "octopus";
export const SWIM_RADIUS = 1.35;
export const SHIP_SHORE_INSET = 4.8;
export const BUOY_SHORE_INSET = 4.7;
export type SurfaceLandmark = LakeMascot | "sailboat";
export const SURFACE_INSET_X = 5.6;
export const SURFACE_INSET_Z = 5.6;

// A connected branching harbor occupies part of its bank's water. Keep the
// shared swimming circuit and cruising corridors beyond those structures.
export function openWater(
  water: LakeLayout["water"],
  insetX = SURFACE_INSET_X,
  insetZ = SURFACE_INSET_Z,
) {
  const d = water.harborDepth;
  return {
    minX: -water.halfWidth + Math.max(insetX, (d?.west ?? 0) + 2.2),
    maxX: water.halfWidth - Math.max(insetX, (d?.east ?? 0) + 2.2),
    minZ: -water.halfDepth + Math.max(insetZ, (d?.north ?? 0) + 2.2),
    maxZ: water.halfDepth - Math.max(insetZ, (d?.south ?? 0) + 2.2),
  };
}

export function surfaceLoopMs(water: LakeLayout["water"]) {
  const bounds = openWater(water);
  return Math.max(
    90_000,
    Math.hypot(
      (bounds.maxX - bounds.minX) / 2,
      (bounds.maxZ - bounds.minZ) / 2,
    ) * 7000,
  );
}

// A wide circuit crosses both halves of the lake. The three swimmers keep
// a third of a lap apart; frame-level clearance lets them pass job vessels.
// These positions depend only on ambient time, never on replay state.
export function surfacePose(
  kind: SurfaceLandmark,
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
) {
  const offset = kind === "ducks" ? 0 : kind === "octopus" ? 1 : 2;
  const period = surfaceLoopMs(water);
  const phase =
    (reduced ? 0 : elapsedMs / period) * Math.PI * 2 +
    0.65 +
    (offset * Math.PI * 2) / 3;
  const bounds = openWater(water);
  const rx = (bounds.maxX - bounds.minX) / 2;
  const rz = (bounds.maxZ - bounds.minZ) / 2;
  return {
    point: [
      (bounds.maxX + bounds.minX) / 2 + Math.sin(phase) * rx,
      kind === "sailboat" ? 0.13 : 0.22,
      (bounds.maxZ + bounds.minZ) / 2 + Math.cos(phase) * rz,
    ] as Point,
    heading: Math.atan2(Math.cos(phase) * rx, -Math.sin(phase) * rz),
    phase,
  };
}

export function swimPose(
  mascot: LakeMascot,
  water: LakeLayout["water"],
  elapsedMs: number,
  reduced = false,
): { point: Point; heading: number; phase: number } {
  const pose = surfacePose(mascot, water, elapsedMs, reduced);
  return {
    ...pose,
    point: [
      pose.point[0],
      pose.point[1] + (reduced ? 0 : Math.sin(pose.phase * 2) * 0.016),
      pose.point[2],
    ],
  };
}

export function inSwimmingArea(point: Point, water: LakeLayout["water"]) {
  return (
    Math.abs(point[0]) <
      water.halfWidth - SURFACE_INSET_X + SWIM_RADIUS + 0.25 &&
    Math.abs(point[2]) < water.halfDepth - SURFACE_INSET_Z + SWIM_RADIUS + 0.25
  );
}
