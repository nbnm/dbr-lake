import type { Attempt, Snapshot } from "./types";

export interface RunLink {
  href: string;
  label: string;
  external: boolean;
}

export function jobRunLink(
  a: Attempt,
  mode: string,
  at: number,
  destinationId?: string,
  captureId?: string,
): RunLink | null {
  if (a.native_url) {
    try {
      if (new URL(a.native_url).protocol === "https:")
        return {
          href: a.native_url,
          label: "Open Databricks run",
          external: true,
        };
    } catch {
      /* Missing or invalid source URL: use the explicit demo view below. */
    }
  }
  if (mode !== "demo") return null;
  const params = new URLSearchParams({
    "job-run": a.run_id,
    job: a.job_id,
    workspace: a.workspace_id,
    account: a.account_id,
    attempt: a.id,
    at: String(Math.floor(at)),
  });
  if (captureId) params.set("capture", captureId);
  if (destinationId && a.route.target_ids.includes(destinationId))
    params.set("destination", destinationId);
  return { href: `/?${params}`, label: "Open demo job run", external: false };
}

export function lakeAttemptLink(
  a: Attempt,
  at: number,
  destinationId?: string,
  captureId?: string,
) {
  const params = new URLSearchParams({
    attempt: a.id,
    at: String(Math.floor(at)),
  });
  if (captureId) params.set("capture", captureId);
  if (destinationId && a.route.target_ids.includes(destinationId))
    params.set("destination", destinationId);
  return `/?${params}`;
}

export function resolveJobRun(scene: Snapshot, params: URLSearchParams) {
  const attempts = scene.attempts.filter(
    (a) =>
      a.account_id === (params.get("account") ?? scene.account_id) &&
      a.workspace_id === params.get("workspace") &&
      a.job_id === params.get("job") &&
      a.run_id === params.get("job-run"),
  );
  const selected = params.has("attempt")
    ? attempts.find((a) => a.id === params.get("attempt"))
    : attempts.at(-1);
  return { attempts, selected };
}
