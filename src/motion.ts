import {
  CubicBezierCurve3,
  CurvePath,
  LineCurve3,
  QuadraticBezierCurve3,
  Vector3,
  type Curve,
} from "three";
import type { Attempt, LakeObject } from "./types";
import {
  schemaId,
  type AirportLayout,
  type LakeLayout,
  type PierLayout,
} from "./layout";
import { cruiseHeight, PORT_ROW_SPACING, vesselKey } from "./navigation";
import { BUOY_SHORE_INSET, SHIP_SHORE_INSET } from "./wildlife";

function roundedPath(points: Vector3[]) {
  const curve = new CurvePath<Vector3>();
  let previous = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i],
      next = points[i + 1];
    const before = previous.distanceTo(corner),
      after = corner.distanceTo(next);
    if (before < 0.01 || after < 0.01) continue;
    const radius = Math.min(1.2, before * 0.35, after * 0.35);
    const enter = corner.clone().lerp(previous, radius / before);
    const exit = corner.clone().lerp(next, radius / after);
    curve.add(new LineCurve3(previous.clone(), enter));
    curve.add(new QuadraticBezierCurve3(enter, corner.clone(), exit));
    previous = exit;
  }
  curve.add(new LineCurve3(previous.clone(), points.at(-1)!.clone()));
  curve.arcLengthDivisions = 1600;
  curve.updateArcLengths();
  return curve;
}

export function makePath(
  a: Attempt,
  objects: LakeObject[],
  airports: AirportLayout[] = [],
  docks: PierLayout[] = [],
  destinationId?: string,
  layout?: Pick<LakeLayout, "water" | "navigation">,
) {
  const source = objects.find((o) => o.id === a.route.source_ids[0]);
  const targets = [...new Set(a.route.target_ids)];
  const landingId =
    destinationId && targets.includes(destinationId)
      ? destinationId
      : targets[0];
  const target = objects.find((o) => o.id === landingId);
  const slot = layout?.navigation.slots[vesselKey(a, destinationId)];
  const lane = slot?.lane ?? Math.max(0, targets.indexOf(landingId));
  const height = a.kind === "plane" ? 1.65 : 0.28;
  const sourceDock = source
    ? docks.find((d) => d.id === schemaId(source))
    : undefined;
  const targetDock = target
    ? docks.find((d) => d.id === schemaId(target))
    : undefined;
  const port = (o: LakeObject, pier?: PierLayout) => {
    const p = new Vector3(...o.position).setY(height);
    if (pier)
      p.z +=
        pier.direction * (1.2 + (slot?.ports[o.id] ?? 0) * PORT_ROW_SPACING);
    return p;
  };
  const to = target ? port(target, targetDock) : new Vector3(2, height, 0);
  const airport =
    a.kind === "plane"
      ? airports.find(
          (p) =>
            p.name === a.route.external_source && p.attempt_ids.includes(a.id),
        )
      : undefined;
  const from = airport
    ? new Vector3(...airport.departure)
    : source
      ? port(source, sourceDock)
      : to.clone().add(new Vector3(-3, 0, -6));
  from.y = airport ? airport.departure[1] : height;
  if (airport) {
    const launch = slot?.launch ?? Math.max(0, targets.indexOf(landingId));
    from.z -= (launch % 3) * 1.8;
    const column = Math.floor(launch / 3);
    if (column)
      from.x += airport.side * (column * 1.9 + (airport.side === 1 ? 1.9 : 0));
  }
  // Harbor routes already form a loop for tasks reading and writing one table.
  // The generic fallback offset could otherwise push their launch into shore lanes.
  if (!layout && from.distanceTo(to) < 0.1) from.add(new Vector3(-2, 0, -1));
  const dir = targetDock
    ? new Vector3(0, 0, -targetDock.direction)
    : to.clone().sub(from).setY(0).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const end = to.clone().addScaledVector(dir, -1.6);
  const approach = end.clone().addScaledVector(dir, -1.6);
  const takeoff = from
    .clone()
    .addScaledVector(dir, 2)
    .addScaledVector(side, 1.5);
  let curve: Curve<Vector3>;
  if (a.kind === "buoy" && layout) {
    const columns = Math.max(
      1,
      Math.floor((layout.water.halfWidth * 2 - BUOY_SHORE_INSET * 2) / 2.6),
    );
    from.set(
      ((lane % columns) -
        (Math.min(columns, layout.navigation.lanes.buoy) - 1) / 2) *
        2.6,
      height,
      (Math.floor(lane / columns) -
        (Math.ceil(layout.navigation.lanes.buoy / columns) - 1) / 2) *
        2.6,
    );
    to.copy(from);
    end.copy(from);
    curve = new LineCurve3(from, from.clone().add(new Vector3(0.01, 0, 0)));
  } else if (airport && layout) {
    // Take off over the runway, then cross open water above ships and docks.
    // Flights use spaced cruise levels and independently reserved apron slots.
    const cruise = cruiseHeight(lane);
    end.y = 2.2;
    approach.y = end.y;
    const inland = from.clone().add(new Vector3(0, cruise - from.y, 1.2));
    const entry = new Vector3(
      airport.side * (layout.water.halfWidth - 3.2),
      cruise,
      Math.max(
        -layout.water.halfDepth + 5,
        Math.min(layout.water.halfDepth - 5, from.z),
      ),
    );
    const descent = approach.clone().addScaledVector(dir, -3).setY(cruise);
    curve = roundedPath([from, inland, entry, descent, approach, end]);
  } else if (sourceDock && targetDock && layout && a.kind === "ship") {
    // Every ship clears the fingers before turning onto its reserved water lane.
    const laneZ = (lane - (layout.navigation.lanes.ship - 1) / 2) * 1.8;
    const exit = from
      .clone()
      .add(new Vector3(0, 0, sourceDock.direction * 1.6));
    const sx = from.x,
      tx = to.x;
    const turnX =
      Math.abs(sx - tx) < 1
        ? Math.max(
            -layout.water.halfWidth + SHIP_SHORE_INSET,
            Math.min(layout.water.halfWidth - SHIP_SHORE_INSET, sx + 2.6),
          )
        : sx;
    curve = roundedPath([
      from,
      exit,
      new Vector3(turnX, height, laneZ),
      new Vector3(tx, height, laneZ),
      approach,
      end,
    ]);
  } else {
    if (sourceDock && a.kind !== "plane")
      takeoff.copy(from).add(new Vector3(0, 0, sourceDock.direction * 2.2));
    if (airport) {
      end.y = 2.2;
      takeoff.y = cruiseHeight(lane);
      approach.y = end.y;
      takeoff.x += (lane - (targets.length - 1) / 2) * 0.7;
    }
    curve = new CubicBezierCurve3(from, takeoff, approach, end);
    curve.arcLengthDivisions = 1000;
  }
  const unknownCenter = from.clone();
  if (airport) unknownCenter.y = cruiseHeight(lane);
  const launchTangent = curve.getTangentAt(0);
  return {
    curve,
    from,
    to,
    end,
    dir,
    side,
    unknownCenter,
    launchHeading: Math.atan2(launchTangent.x, launchTangent.z),
    length: curve.getLength(),
    radius: 0.75,
  };
}

export type MotionPath = ReturnType<typeof makePath>;

export function positionAt(
  a: Attempt,
  path: MotionPath,
  at: number,
): { position: Vector3; heading: number; holding: boolean } {
  const clock =
    a.collection_stale_at === null ? at : Math.min(at, a.collection_stale_at);
  const effective = Math.min(clock, a.ended_at ?? Infinity);
  const elapsed = Math.max(0, effective - (a.started_at ?? effective));
  const recorded = a.replay_duration_ms;
  const predicted = recorded ?? a.estimate.predicted_duration_ms;
  if (a.kind === "buoy")
    return {
      position: path.from.clone(),
      heading: 0,
      holding: a.started_at !== null,
    };
  if (a.phase === "succeeded")
    return {
      position: path.to.clone(),
      heading: Math.atan2(path.dir.x, path.dir.z),
      holding: false,
    };
  if (a.started_at === null)
    return {
      position: path.from.clone(),
      heading: path.launchHeading,
      holding: false,
    };
  if (predicted === null) {
    const theta = elapsed / 10_000;
    const radius = a.kind === "plane" ? 0.4 : 0.3;
    return {
      position: path.unknownCenter
        .clone()
        .add(
          new Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius),
        ),
      heading: -theta,
      holding: true,
    };
  }
  // Completed historical runs use their recorded duration for replay interpolation.
  // This is elapsed-time illustration, not measured row/byte progress or an ETA.
  if (recorded) {
    const progress = Math.min(1, elapsed / recorded);
    const tangent = path.curve.getTangentAt(progress);
    return {
      position: path.curve.getPointAt(progress),
      heading: Math.atan2(tangent.x, tangent.z),
      holding: false,
    };
  }
  const travelMs = predicted * 0.9;
  if (elapsed < travelMs) {
    const progress = elapsed / travelMs;
    const tangent = path.curve.getTangentAt(progress);
    return {
      position: path.curve.getPointAt(progress),
      heading: Math.atan2(tangent.x, tangent.z),
      holding: false,
    };
  }
  const theta = (((elapsed - travelMs) / travelMs) * path.length) / path.radius;
  const position = path.end
    .clone()
    .addScaledVector(path.side, path.radius * (1 - Math.cos(theta)))
    .addScaledVector(path.dir, path.radius * Math.sin(theta));
  const tangent = path.side
    .clone()
    .multiplyScalar(Math.sin(theta))
    .addScaledVector(path.dir, Math.cos(theta));
  return { position, heading: Math.atan2(tangent.x, tangent.z), holding: true };
}
