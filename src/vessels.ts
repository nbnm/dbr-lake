import type { Attempt, Selection } from "./types";

export interface VesselInstance {
  key: string;
  attempt: Attempt;
  destinationId?: string;
}

export function landingDestinations(a: Attempt): string[] {
  return [...new Set(a.route.target_ids)];
}

// Flights are projections of a task's landing routes, not extra executions.
export function expandVessels(attempts: Attempt[]): VesselInstance[] {
  return attempts.flatMap((attempt) => {
    const targets = landingDestinations(attempt);
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
  const targets = landingDestinations(a);
  return selection.type === "attempt" &&
    selection.id === a.id &&
    selection.destination_id &&
    targets.includes(selection.destination_id)
    ? selection.destination_id
    : targets[0];
}
