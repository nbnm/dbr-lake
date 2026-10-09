import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, Database, Plane, Waves } from "lucide-react";
import type { Snapshot } from "./types";
import { StatusBadge } from "./Inspector";
import {
  duration,
  elapsed,
  isSimulated,
  replayLabel,
  timestamp,
} from "./state";
import { lakeAttemptLink, resolveJobRun } from "./runLinks";
import { flightTableIds, isExport, selectedDestination } from "./vessels";

export default function JobRunPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [scene, setScene] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    const requested = Number(params.get("at"));
    const query =
      params.has("at") && Number.isSafeInteger(requested)
        ? `?at=${requested}`
        : "";
    const captureQuery = params.get("capture")
      ? `${query ? "&" : "?"}capture=${encodeURIComponent(params.get("capture")!)}`
      : "";
    fetch(`/api/scene${query}${captureQuery}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok)
          throw new Error(
            r.status === 422
              ? "This time is outside the selected capture."
              : "The SimLake API is unavailable.",
          );
        return r.json() as Promise<Snapshot>;
      })
      .then(setScene)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [params, retry]);
  const { attempts, selected: a } = scene
    ? resolveJobRun(scene, params)
    : { attempts: [], selected: undefined };
  const destination = a
    ? selectedDestination(a, {
        type: "attempt",
        id: a.id,
        destination_id: params.get("destination") ?? undefined,
      })
    : undefined;
  const workspace = scene?.workspaces.find((w) => w.id === a?.workspace_id);
  const back =
    a && scene
      ? lakeAttemptLink(a, scene.server_time, destination, scene.capture_id)
      : "/";

  return (
    <div className="job-run-page">
      <header className="run-topbar">
        <a className="run-brand" href="/" aria-label="SimLake">
          <Waves size={23} />
          <strong>
            Sim<span>Lake</span>
          </strong>
        </a>
        <span className="demo-label">
          {scene ? replayLabel(scene) : "Loading replay"}
        </span>
      </header>
      <main className="run-content">
        <a className="run-back" href={back}>
          <ArrowLeft size={16} />
          Back to SimLake
        </a>
        {error ? (
          <div className="run-empty">
            <h1>Run details unavailable</h1>
            <p>{error}</p>
            <button
              className="primary-button"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        ) : !scene ? (
          <div className="run-empty" role="status">
            Loading run details…
          </div>
        ) : !a ? (
          <div className="run-empty">
            <h1>Job run not found</h1>
            <p>
              This execution is unavailable in the selected workspace or at this
              replay time.
            </p>
          </div>
        ) : (
          <>
            <div className="run-title">
              <div>
                <div className="eyebrow">
                  {isSimulated(a, scene.mode)
                    ? "Simulated job run"
                    : "Historical job run"}
                </div>
                <h1>Run {a.run_id}</h1>
                <p>{a.name}</p>
              </div>
              <div className="run-selected-status">
                <small>Selected task attempt</small>
                <StatusBadge attempt={a} at={scene.server_time} />
              </div>
            </div>
            <p className="run-demo-note">
              {a.provenance === "workspace_simulation"
                ? "Simulated execution · real captured table identities"
                : scene.mode === "demo"
                  ? "Simulated execution"
                  : "Imported execution"}
              {" · "}Snapshot at {timestamp(scene.server_time)} Toronto time
            </p>
            <dl className="run-summary">
              <div>
                <dt>Workspace</dt>
                <dd>
                  {workspace?.name ?? a.workspace_id}
                  <small>{workspace?.region}</small>
                </dd>
              </div>
              <div>
                <dt>Job ID</dt>
                <dd>{a.job_id}</dd>
              </div>
              <div>
                <dt>Task run ID</dt>
                <dd>{a.task_run_id}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{duration(elapsed(a, scene.server_time))}</dd>
              </div>
            </dl>
            <section className="run-section">
              <div className="run-section-heading">
                <h2>Task attempts</h2>
                <span>{attempts.length} in this run</span>
              </div>
              <div className="run-table-scroll">
                <table className="run-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Attempt</th>
                      <th>Observed state</th>
                      <th>Started</th>
                      <th>Ended</th>
                      <th>Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempts.map((task) => (
                      <tr
                        key={task.id}
                        className={task.id === a.id ? "selected" : ""}
                      >
                        <td>
                          <strong>{task.name}</strong>
                          <small>
                            {task.task_key} · Task run {task.task_run_id}
                          </small>
                        </td>
                        <td>
                          {task.attempt_number + 1}
                          {task.attempt_number ? " · retry" : ""}
                        </td>
                        <td>
                          <StatusBadge attempt={task} at={scene.server_time} />
                          <small>{task.raw_state}</small>
                        </td>
                        <td>
                          {task.started_at === null
                            ? "Not started"
                            : timestamp(task.started_at)}
                        </td>
                        <td>
                          {task.ended_at === null
                            ? "—"
                            : timestamp(task.ended_at)}
                        </td>
                        <td>
                          <a
                            className="run-inspect"
                            href={lakeAttemptLink(
                              task,
                              scene.server_time,
                              task.id === a.id ? destination : undefined,
                              scene.capture_id,
                            )}
                            aria-label={`Inspect ${task.name} in lake`}
                          >
                            <ArrowUpRight size={18} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="run-section">
              <div className="run-section-heading">
                <h2>
                  {isExport(a)
                    ? "Export source tables"
                    : "Landing destinations"}
                </h2>
                <span>{a.route.evidence} route</span>
              </div>
              {a.route.external_source && (
                <p className="run-source">
                  <Plane size={17} />
                  From {a.route.external_source}
                </p>
              )}
              {a.route.external_target && (
                <p className="run-source">
                  <Plane size={17} />
                  To {a.route.external_target}
                </p>
              )}
              <div className="run-landings">
                {flightTableIds(a).map((id) => {
                  const o = scene.objects.find((o) => o.id === id);
                  return (
                    <a
                      key={id}
                      className={destination === id ? "selected" : ""}
                      href={lakeAttemptLink(
                        a,
                        scene.server_time,
                        id,
                        scene.capture_id,
                      )}
                    >
                      <Database size={18} />
                      <span>
                        <strong>
                          {o ? `${o.catalog}.${o.schema_name}.${o.name}` : id}
                        </strong>
                        <small>{o?.metastore_id ?? "Unresolved object"}</small>
                      </span>
                      {destination === id && (
                        <small className="landing-tag">Selected landing</small>
                      )}
                      <ArrowUpRight size={16} />
                    </a>
                  );
                })}
              </div>
              {!a.route.target_ids.length && (
                <p className="evidence-note">
                  No supported destination evidence.
                </p>
              )}
              {a.kind === "plane" && (
                <p className="evidence-note">
                  Each destination has a plane in the lake. Execution state is
                  reported for the task attempt; individual write completion is
                  not available.
                </p>
              )}
            </section>
            <section className="run-section run-timing">
              <h2>Execution timing</h2>
              <dl>
                <dt>Launch estimate</dt>
                <dd>{duration(a.estimate.predicted_duration_ms)}</dd>
                <dt>Last observation</dt>
                <dd>{timestamp(a.observed_at)}</dd>
                <dt>Route version</dt>
                <dd>{a.route.version}</dd>
                <dt>Estimate version</dt>
                <dd>{a.estimate.version}</dd>
              </dl>
            </section>
            <footer className="run-footer">
              {isSimulated(a, scene.mode) ? "Simulated" : "Historical"} run
              details · Databricks runs open the URL supplied by source
              metadata.
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
