import {
  ArrowDown,
  ArrowUpRight,
  Check,
  CircleHelp,
  Database,
  Layers,
  MapPin,
  Plane,
  Radio,
  Ship,
  Timer,
  X,
} from "lucide-react";
import type { Attempt, Selection, Snapshot } from "./types";
import { duration, elapsed, status, timestamp } from "./state";
import { catalogId, schemaId, type AirportLayout } from "./layout";
import {
  flightSelection,
  landingDestinations,
  selectedDestination,
} from "./vessels";
import { JobRunAction } from "./JobRunAction";

export function StatusBadge({ attempt, at }: { attempt: Attempt; at: number }) {
  const label = status(attempt, at);
  return (
    <span
      className={`status-badge ${label.toLowerCase().replaceAll(" ", "-")}`}
    >
      <i />
      {label}
    </span>
  );
}

function TableName({
  id,
  scene,
  onSelect,
}: {
  id: string;
  scene: Snapshot;
  onSelect: (s: Selection) => void;
}) {
  const o = scene.objects.find((o) => o.id === id);
  return (
    <button
      className="route-object"
      onClick={() => onSelect({ type: "table", id })}
    >
      <Database size={15} />
      <span>
        <small>
          {o ? `${o.catalog}.${o.schema_name}` : "Unresolved object"}
        </small>
        <strong>{o?.name ?? id}</strong>
      </span>
      <ArrowUpRight size={14} />
    </button>
  );
}

export default function Inspector({
  selected,
  scene,
  onSelect,
  onFocus,
  airports,
}: {
  selected: Selection;
  scene: Snapshot;
  onSelect: (s: Selection) => void;
  onFocus: () => void;
  airports: AirportLayout[];
}) {
  const a =
    selected.type === "attempt"
      ? scene.attempts.find((a) => a.id === selected.id)
      : undefined;
  const table =
    selected.type === "table"
      ? scene.objects.find((o) => o.id === selected.id)
      : undefined;
  const tables =
    selected.type === "schema" || selected.type === "catalog"
      ? scene.objects.filter(
          (o) =>
            (selected.type === "catalog" ? catalogId(o) : schemaId(o)) ===
            selected.id,
        )
      : [];
  const entry = [...(scene.inventory ?? []), ...scene.objects].find((o) =>
    selected.type === "catalog"
      ? catalogId(o) === selected.id
      : selected.type === "schema" &&
        o.schema_name !== null &&
        schemaId({ ...o, schema_name: o.schema_name }) === selected.id,
  );
  const airport =
    selected.type === "airport"
      ? airports.find((p) => p.id === selected.id)
      : undefined;
  const ws = a
    ? scene.workspaces.find((w) => w.id === a.workspace_id)
    : undefined;
  const destination = a ? selectedDestination(a, selected) : undefined;
  return (
    <aside className="inspector" aria-label="Selection details">
      <div className="panel-heading">
        <span>
          {selected.type === "coverage"
            ? "Workspace coverage"
            : selected.type === "airport"
              ? "External source"
              : selected.type === "attempt"
                ? a?.scope === "job_run"
                  ? "Job run inspector"
                  : "Task inspector"
                : "Catalog explorer"}
        </span>
        <button
          className="icon-button"
          aria-label="Show workspace coverage"
          onClick={() => onSelect({ type: "coverage" })}
        >
          <Layers size={16} />
        </button>
      </div>
      {selected.type === "coverage" ? (
        <>
          <div className="inspector-title">
            <div className="object-icon">
              <Radio size={21} />
            </div>
            <h2>Collection coverage</h2>
            <p>
              Every known workspace, including missing access and exclusions.
            </p>
          </div>
          <div className="coverage-summary">
            <strong>
              {scene.workspaces.filter((w) => w.status === "connected").length}
              <span> / {scene.workspaces.length}</span>
            </strong>
            <span>connected workspaces</span>
          </div>
          <div className="workspace-list">
            {scene.workspaces.map((w) => (
              <div className="workspace-entry" key={w.id}>
                <div>
                  <strong>{w.name}</strong>
                  <span className={`coverage-state ${w.status}`}>
                    {w.status}
                  </span>
                </div>
                <p>{w.region}</p>
                {w.reason && <small>{w.reason}</small>}
                <dl>
                  <dt>
                    {scene.mode === "demo"
                      ? "Fixture observation"
                      : "Imported at"}
                  </dt>
                  <dd>
                    {w.last_successful_poll
                      ? timestamp(w.last_successful_poll)
                      : "Not collected"}
                  </dd>
                  <dt>Latest captured lineage</dt>
                  <dd>
                    {w.lineage_observed_at
                      ? timestamp(w.lineage_observed_at, "minute")
                      : "Unknown"}
                  </dd>
                </dl>
              </div>
            ))}
          </div>
          <div className="note">
            <CircleHelp size={15} />
            <p>
              Historical job replay only. Playback uses a fixed capture;
              workspace APIs are read again only when you import.
            </p>
          </div>
        </>
      ) : airport ? (
        <>
          <div className="inspector-title">
            <div className="object-icon plane">
              <Plane size={22} />
            </div>
            <div className="eyebrow">Source airport</div>
            <h2>{airport.name}</h2>
            <p>
              External ingestion departs here for its destination table berths.
            </p>
          </div>
          <section className="inspector-section">
            <h3>Source mapping</h3>
            <dl>
              <dt>Metastore scope</dt>
              <dd>{airport.scope}</dd>
              <dt>Workspaces</dt>
              <dd>{airport.workspace_ids.length}</dd>
              <dt>Known ingestion tasks</dt>
              <dd>{airport.attempt_ids.length}</dd>
            </dl>
            <p className="evidence-note">
              Airports come from explicit external-source route evidence in this
              capture.
            </p>
          </section>
          <section className="inspector-section">
            <h3>Destination berths · {airport.target_ids.length}</h3>
            {airport.target_ids.map((id) => (
              <TableName key={id} id={id} scene={scene} onSelect={onSelect} />
            ))}
          </section>
          <section className="inspector-section">
            <h3>Ingestion attempts at this time</h3>
            {scene.attempts
              .filter((a) => airport.attempt_ids.includes(a.id))
              .map((a) => (
                <button
                  className="related-attempt"
                  key={a.id}
                  onClick={() => onSelect({ type: "attempt", id: a.id })}
                >
                  <span>{a.name}</span>
                  <StatusBadge attempt={a} at={scene.server_time} />
                </button>
              ))}
            {!scene.attempts.some((a) =>
              airport.attempt_ids.includes(a.id),
            ) && (
              <p className="evidence-note">
                No ingestion attempts at the selected replay time.
              </p>
            )}
          </section>
          <div className="inspector-actions">
            <button className="primary-button" onClick={onFocus}>
              <MapPin size={15} />
              Focus airport
            </button>
          </div>
        </>
      ) : a ? (
        <>
          <div className="inspector-title">
            <div className={`object-icon ${a.kind}`}>
              {a.kind === "plane" ? <Plane size={22} /> : <Ship size={22} />}
            </div>
            <div className="eyebrow">
              {a.kind === "plane"
                ? "External ingestion"
                : a.kind === "ship"
                  ? "Table transformation"
                  : "Processing task"}
            </div>
            <h2>{a.name}</h2>
            <StatusBadge attempt={a} at={scene.server_time} />
          </div>
          <div className="workspace-caption">
            <MapPin size={14} />
            <span>
              {ws?.name}
              <small>{ws?.region}</small>
            </span>
          </div>
          <div className="run-action">
            <JobRunAction
              captureId={scene.capture_id}
              attempt={a}
              mode={scene.mode}
              at={scene.server_time}
              destinationId={destination}
            />
            <small>
              Job {a.job_id} · Run {a.run_id}
            </small>
          </div>
          {a.kind === "plane" && (
            <section className="inspector-section landing-section">
              <h3>Landing planes · {landingDestinations(a).length}</h3>
              {landingDestinations(a).map((id) => {
                const o = scene.objects.find((o) => o.id === id);
                return (
                  <button
                    key={id}
                    className={`landing-choice ${destination === id ? "selected" : ""}`}
                    aria-pressed={destination === id}
                    onClick={() => onSelect(flightSelection(a, id))}
                  >
                    <Plane size={16} />
                    <span>
                      <small>
                        {o
                          ? `${o.catalog}.${o.schema_name}`
                          : "Unresolved object"}
                      </small>
                      <strong>{o?.name ?? id}</strong>
                    </span>
                    {destination === id && <Check size={15} />}
                  </button>
                );
              })}
              <p className="evidence-note">
                One plane per destination. All planes share this execution’s
                status and timing.
              </p>
            </section>
          )}
          <section className="inspector-section">
            <div className="section-caption">
              <h3>Route</h3>
              <span className={`evidence ${a.route.evidence}`}>
                {a.route.evidence}
              </span>
            </div>
            <div className="route-stack">
              {a.route.external_source && (
                <button
                  className="external-source"
                  onClick={() => {
                    const p = airports.find(
                      (p) =>
                        p.name === a.route.external_source &&
                        p.attempt_ids.includes(a.id),
                    );
                    if (p) onSelect({ type: "airport", id: p.id });
                  }}
                >
                  <Plane size={15} />
                  <span>
                    <small>External source airport</small>
                    <strong>{a.route.external_source}</strong>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              )}
              {a.route.source_ids.map((id) => (
                <TableName key={id} id={id} scene={scene} onSelect={onSelect} />
              ))}
              {(a.route.source_ids.length > 0 || a.route.external_source) && (
                <ArrowDown size={16} className="route-arrow" />
              )}
              {a.route.target_ids.map((id) => (
                <TableName key={id} id={id} scene={scene} onSelect={onSelect} />
              ))}
              {a.route.evidence === "unknown" && (
                <p className="unknown-route">
                  No supported source or destination evidence. This task remains
                  a neutral buoy.
                </p>
              )}
            </div>
            <p className="evidence-note">
              {a.route.evidence === "observed"
                ? scene.mode === "demo"
                  ? "This fixture associates the route with this execution."
                  : "Source evidence associates this route with this execution."
                : a.route.evidence === "historical"
                  ? a.scope === "job_run"
                    ? "Observed lineage for this job run in the fixed capture. Missing lineage may leave routes unresolved; task-level attribution is not inferred."
                    : "A prior comparable execution used this route. Current-run lineage is unconfirmed."
                  : a.route.evidence === "configured"
                    ? scene.mode === "demo"
                      ? "An explicit demo mapping supplies this route."
                      : "A saved task mapping supplies this route; current-run lineage was not collected."
                    : "No tables have been inferred."}
            </p>
          </section>
          <section className="inspector-section">
            <h3>Execution timing</h3>
            <div className="timing-pair">
              <div>
                <small>Elapsed</small>
                <strong>{duration(elapsed(a, scene.server_time))}</strong>
              </div>
              <div>
                <small>Launch estimate</small>
                <strong>{duration(a.estimate.predicted_duration_ms)}</strong>
              </div>
            </div>
            {a.estimate.predicted_duration_ms !== null &&
              a.started_at !== null && (
                <dl>
                  <dt>Estimated arrival</dt>
                  <dd>
                    {timestamp(a.started_at + a.estimate.predicted_duration_ms)}
                    {elapsed(a, scene.server_time) >
                      a.estimate.predicted_duration_ms && a.phase === "running"
                      ? " · expired"
                      : ""}
                  </dd>
                </dl>
              )}
            <div className="estimate-note">
              <Timer size={14} />
              <span>
                {a.estimate.sample_count >= 5
                  ? `${a.estimate.sample_count} prior comparable successful attempts`
                  : "No valid duration cohort"}
                <small>
                  {a.estimate.q1_ms !== null
                    ? `Historical range ${duration(a.estimate.q1_ms)}–${duration(a.estimate.q3_ms)}`
                    : "ETA remains unknown"}
                </small>
              </span>
            </div>
            {a.collection_stale_at !== null && (
              <p className="warning-note">
                Motion frozen at {timestamp(a.collection_stale_at)}. Last task
                observation: {timestamp(a.observed_at)}.
              </p>
            )}
            <p className="evidence-note">
              {a.replay_duration_ms
                ? "Vessel position follows the recorded run duration in this fixed replay. It does not measure data progress."
                : "Vessel position represents estimated elapsed time."}
            </p>
          </section>
          {a.scope === "job_run" && (
            <section className="inspector-section">
              <h3>Task runs at this time</h3>
              {(a.run_tasks ?? [])
                .filter((t) => t.started_at <= scene.server_time)
                .map((t) => (
                  <div
                    className="task-history-row"
                    key={`${t.task_run_id}:${t.started_at}`}
                  >
                    <span>
                      <strong>{t.task_key}</strong>
                      <small>
                        Task run {t.task_run_id} ·{" "}
                        {timestamp(t.started_at, "minute")}
                      </small>
                    </span>
                    <small>
                      {t.ended_at !== null && t.ended_at <= scene.server_time
                        ? t.raw_state
                        : "Last reported running"}
                    </small>
                  </div>
                ))}
              {!(a.run_tasks ?? []).some(
                (t) => t.started_at <= scene.server_time,
              ) && (
                <p className="evidence-note">
                  No task start observed by this replay time.
                </p>
              )}
            </section>
          )}
          <section className="inspector-section">
            <h3>Source details</h3>
            <dl>
              <dt>Job / run</dt>
              <dd>
                {a.job_id} / {a.run_id}
              </dd>
              <dt>{a.scope === "job_run" ? "Execution scope" : "Task run"}</dt>
              <dd>{a.scope === "job_run" ? "Job run" : a.task_run_id}</dd>
              <dt>Attempt</dt>
              <dd>
                {a.attempt_number + 1}
                {a.attempt_number > 0 ? " · retry" : ""}
              </dd>
              <dt>Observed state</dt>
              <dd>{a.raw_state}</dd>
              <dt>Last observation</dt>
              <dd>{timestamp(a.observed_at)}</dd>
              <dt>Estimate version</dt>
              <dd>{a.estimate.version}</dd>
            </dl>
            <details className="source-evidence">
              <summary>Evidence identifiers</summary>
              <p>{a.source_id}</p>
              {a.route.source_record_ids.map((id) => (
                <p key={id}>{id}</p>
              ))}
              <p>Timing basis: {a.estimate.timing_basis}</p>
            </details>
          </section>
          <div className="inspector-actions">
            <button className="primary-button" onClick={onFocus}>
              <MapPin size={15} />
              Focus in lake
            </button>
          </div>
        </>
      ) : table || tables.length || entry ? (
        <>
          <div className="inspector-title">
            <div className="object-icon">
              <Database size={22} />
            </div>
            <div className="eyebrow">
              {table
                ? "Table berth"
                : selected.type === "catalog"
                  ? "Catalog dock"
                  : "Schema pier"}
            </div>
            <h2>
              {table?.name ??
                (selected.type === "catalog"
                  ? entry?.catalog
                  : entry?.schema_name)}
            </h2>
            <p>
              {table
                ? `${table.catalog}.${table.schema_name}`
                : entry
                  ? selected.type === "catalog"
                    ? entry.metastore_id
                    : `${entry.catalog}.${entry.schema_name}`
                  : ""}
            </p>
          </div>
          {table ? (
            <section className="inspector-section">
              <h3>Object identity</h3>
              <dl>
                <dt>Type</dt>
                <dd>{table.type}</dd>
                <dt>Metastore</dt>
                <dd>{table.metastore_id}</dd>
                <dt>Workspace visibility</dt>
                <dd>{table.workspace_ids.length} workspaces</dd>
              </dl>
              <p className="identity">{table.id}</p>
            </section>
          ) : selected.type === "catalog" ? (
            <section className="inspector-section">
              <h3>Schema piers</h3>
              {[
                ...new Set([
                  ...(scene.inventory ?? [])
                    .filter(
                      (o) =>
                        catalogId(o) === selected.id && o.schema_name !== null,
                    )
                    .map((o) => o.schema_name!),
                  ...tables.map((o) => o.schema_name),
                ]),
              ]
                .sort()
                .map((name) => (
                  <button
                    key={name}
                    className="route-object"
                    onClick={() =>
                      onSelect({
                        type: "schema",
                        id: schemaId({
                          metastore_id: entry!.metastore_id,
                          catalog: entry!.catalog,
                          schema_name: name,
                        }),
                      })
                    }
                  >
                    <Layers size={16} />
                    <span>
                      <strong>{name}</strong>
                      <small>
                        {tables.filter((o) => o.schema_name === name).length}{" "}
                        tables
                      </small>
                    </span>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
            </section>
          ) : (
            <section className="inspector-section">
              <h3>Table berths · {tables.length}</h3>
              {tables.map((o) => (
                <TableName
                  key={o.id}
                  id={o.id}
                  scene={scene}
                  onSelect={onSelect}
                />
              ))}
            </section>
          )}
          <section className="inspector-section">
            <h3>Related attempts</h3>
            {scene.attempts
              .filter((a) =>
                [...a.route.source_ids, ...a.route.target_ids].some((id) =>
                  table ? id === table.id : tables.some((o) => o.id === id),
                ),
              )
              .map((a) => (
                <button
                  className="related-attempt"
                  key={a.id}
                  onClick={() => onSelect({ type: "attempt", id: a.id })}
                >
                  <span>{a.name}</span>
                  <StatusBadge attempt={a} at={scene.server_time} />
                </button>
              ))}
          </section>
          <div className="inspector-actions">
            <button className="primary-button" onClick={onFocus}>
              <MapPin size={15} />
              Focus in lake
            </button>
          </div>
          <div className="note">
            <Check size={15} />
            <p>
              This metastore object appears once, even when several workspaces
              use it.
            </p>
          </div>
        </>
      ) : (
        <div className="empty-inspector">
          <X size={20} />
          <h2>No task at this time</h2>
          <p>Choose an activity row or seek forward to inspect this attempt.</p>
        </div>
      )}
      <div className="panel-footer">
        <i />
        {scene.mode === "demo"
          ? "Simulated metadata"
          : "Imported historical metadata"}{" "}
        · read-only replay
      </div>
    </aside>
  );
}
