import { CubicBezierCurve3, Vector3 } from "three";
import type { Attempt, LakeObject } from "./types";
import { schemaId, type AirportLayout, type PierLayout } from "./layout";

export function makePath(
  a: Attempt,
  objects: LakeObject[],
  airports: AirportLayout[] = [],
  docks: PierLayout[] = [],
  destinationId?: string,
) {
  const source = objects.find((o) => o.id === a.route.source_ids[0]);
  const targets = [...new Set(a.route.target_ids)];
  const landingId =
    destinationId && targets.includes(destinationId)
      ? destinationId
      : targets[0];
  const target = objects.find((o) => o.id === landingId);
  const lane = Math.max(0, targets.indexOf(landingId));
  const height = a.kind === "plane" ? 1.5 : 0.28;
  const to = target ? new Vector3(...target.position) : new Vector3(2, 0.2, 0);
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
      ? new Vector3(...source.position)
      : to.clone().add(new Vector3(-3, 0, -6));
  from.y = airport ? airport.departure[1] : height;
  if (airport && targets.length > 1)
    from.z -= (lane / (targets.length - 1)) * 3.6;
  to.y = a.kind === "plane" && airport ? 0.45 : height;
  if (from.distanceTo(to) < 0.1) from.add(new Vector3(-2, 0, -1));
  const sourceDock = source
    ? docks.find((d) => d.id === schemaId(source))
    : undefined;
  const targetDock = target
    ? docks.find((d) => d.id === schemaId(target))
    : undefined;
  const dir = targetDock
    ? new Vector3(0, 0, -targetDock.direction)
    : to.clone().sub(from).setY(0).normalize();
  const side = new Vector3(-dir.z, 0, dir.x);
  const end = to.clone().addScaledVector(dir, -1.6);
  const takeoff = from
    .clone()
    .addScaledVector(dir, 2)
    .addScaledVector(side, 1.5);
  const approach = end.clone().addScaledVector(dir, -2);
  if (sourceDock && a.kind !== "plane")
    takeoff.copy(from).add(new Vector3(0, 0, sourceDock.direction * 2.2));
  if (airport) {
    end.y = 1.9;
    takeoff.y = 3.5;
    approach.y = end.y;
    if (targets.length > 1)
      takeoff.x += (lane - (targets.length - 1) / 2) * 0.7;
  }
  const curve = new CubicBezierCurve3(from, takeoff, approach, end);
  return {
    curve,
    from,
    to,
    end,
    dir,
    side,
    length: curve.getLength(),
    radius: 0.65,
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
  const predicted = a.estimate.predicted_duration_ms;
  if (a.phase === "succeeded")
    return {
      position: path.to.clone(),
      heading: Math.atan2(path.dir.x, path.dir.z),
      holding: false,
    };
  if (a.started_at === null)
    return {
      position: path.from.clone(),
      heading: Math.atan2(path.dir.x, path.dir.z),
      holding: false,
    };
  if (predicted === null) {
    const theta = elapsed / 10_000;
    return {
      position: path.from
        .clone()
        .add(new Vector3(Math.cos(theta) * 0.7, 0, Math.sin(theta) * 0.7)),
      heading: -theta,
      holding: true,
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
