import type { Attempt, Selection } from "./types";

export interface VesselInstance {
  key: string;
  attempt: Attempt;
  destinationId?: string;
}

export function landingDestinations(a: Attempt): string[] {
  return [...new Set(a.route.target_ids)];
}

export const isExport = (a: Attempt) => !!a.route.external_target;
export const externalAirportName = (a: Attempt) =>
  a.route.external_target ?? a.route.external_source;

export function flightTableIds(a: Attempt): string[] {
  return [...new Set(isExport(a) ? a.route.source_ids : a.route.target_ids)];
}

// Inbound and outbound flight branches share their parent execution's identity.
export function expandVessels(attempts: Attempt[]): VesselInstance[] {
  return attempts.flatMap((attempt) => {
    const targets = flightTableIds(attempt);
    return attempt.kind === "plane" && targets.length
      ? targets.map((destinationId) => ({
          key: JSON.stringify([attempt.id, destinationId]),
          attempt,
          destinationId,
        }))
      : [{ key: JSON.stringify([attempt.id, null]), attempt }];
  });
}

export function flightSelection(a: Attempt, destinationId?: string): Selection {
  return {
    type: "attempt",
    id: a.id,
    ...(destinationId ? { destination_id: destinationId } : {}),
  };
}

export function selectedDestination(a: Attempt, selection: Selection) {
  const targets = flightTableIds(a);
  return selection.type === "attempt" &&
    selection.id === a.id &&
    selection.destination_id &&
    targets.includes(selection.destination_id)
    ? selection.destination_id
    : targets[0];
}
