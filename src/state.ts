import type { Attempt, Replay, Snapshot } from "./types";

export function reconstruct(replay: Replay, at: number): Snapshot {
  const checkpoint = replay.checkpoint;
  const attempts = new Map(checkpoint.attempts.map((a) => [a.id, a]));
  const workspaces = new Map(checkpoint.workspaces.map((w) => [w.id, w]));
  const gaps = [...checkpoint.gaps];
  let cursor = checkpoint.cursor;
  for (const e of replay.events) {
    if (e.event_time > at) continue;
    cursor = Math.max(cursor, e.sequence);
    if (e.type === "attempt.upsert") {
      const incoming = e.payload as unknown as Attempt;
      const previous = attempts.get(e.execution_attempt_id!);
      if (!previous || incoming.observed_at >= previous.observed_at)
        attempts.set(e.execution_attempt_id!, incoming);
    }
    if (e.type === "coverage.update")
      workspaces.set(e.workspace_id, {
        ...workspaces.get(e.workspace_id)!,
        ...e.payload,
      });
    if (e.type === "collection.gap")
      gaps.push({
        ...e.payload,
        workspace_id: e.workspace_id,
      } as unknown as Snapshot["gaps"][number]);
  }
  return {
    ...checkpoint,
    attempts: [...attempts.values()],
    workspaces: [...workspaces.values()],
    gaps,
    server_time: at,
    cursor,
  };
}

export function elapsed(a: Attempt, at: number): number {
  return a.started_at === null
    ? 0
    : Math.max(0, (a.ended_at ?? at) - a.started_at);
}

export function isOverdue(a: Attempt, at: number): boolean {
  return (
    a.phase === "running" &&
    a.collection_stale_at === null &&
    a.estimate.predicted_duration_ms !== null &&
    elapsed(a, at) > a.estimate.predicted_duration_ms
  );
}

export function status(a: Attempt, at: number): string {
  if (a.collection_stale_at !== null && a.phase === "running")
    return "Collection stale";
  if (isOverdue(a, at)) return "Overdue";
  return {
    running: "Running",
    queued: "Queued",
    succeeded: "Succeeded",
    failed: "Failed",
    cancelled: "Cancelled",
    unknown: "Unknown",
  }[a.phase];
}

export function duration(ms: number | null): string {
  if (ms === null) return "Unknown";
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function timestamp(
  ms: number,
  precision: "second" | "minute" = "second",
): string {
  return new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    ...(precision === "second" ? { second: "2-digit" as const } : {}),
    hour12: false,
    timeZone: "America/Toronto",
  }).format(ms);
}
