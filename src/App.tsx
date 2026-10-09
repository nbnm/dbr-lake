import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Compass,
  Database,
  Globe2,
  Layers3,
  List,
  Maximize2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  Ship,
  Waves,
  Minus,
  CircleAlert,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { Replay, Selection, StatusFilter } from "./types";
import type { CameraAction } from "./LakeScene";
import { duration, elapsed, isOverdue, reconstruct, timestamp } from "./state";
import Inspector, { StatusBadge } from "./Inspector";
import {
  buildLakeLayout,
  captureAttempts,
  catalogId,
  schemaId,
} from "./layout";
import Configuration from "./Configuration";
import { selectedDestination } from "./vessels";

const LakeScene = lazy(() => import("./LakeScene"));

export default function App() {
  const initialParams = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [at, setAt] = useState(0);
  const clock = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [configuration, setConfiguration] = useState(false);
  const [query, setQuery] = useState("");
  const [workspace, setWorkspace] = useState("all");
  const [region, setRegion] = useState("all");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Selection>({
    type: "attempt",
    id: initialParams.get("attempt") ?? "refine-orders",
    ...(initialParams.get("destination")
      ? { destination_id: initialParams.get("destination")! }
      : {}),
  });
  const [view, setView] = useState<"lake" | "list">("lake");
  const [eggs, setEggs] = useState(true);
  const [reduced, setReduced] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [action, setAction] = useState<CameraAction | null>(null);
  const [options, setOptions] = useState(false);
  const actionSequence = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch(
      `/api/replay${initialParams.get("capture") ? `?capture=${encodeURIComponent(initialParams.get("capture")!)}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<Replay>;
      })
      .then((data) => {
        setReplay(data);
        const requested = Number(initialParams.get("at"));
        clock.current =
          initialParams.has("at") && Number.isSafeInteger(requested)
            ? Math.max(
                data.checkpoint.range.start,
                Math.min(data.checkpoint.range.end, requested),
              )
            : data.checkpoint.mode === "demo"
              ? data.checkpoint.range.start + 600_000
              : data.checkpoint.range.end - 900_000;
        setAt(clock.current);
        if (!initialParams.has("attempt") && data.mode === "replay") {
          const candidate =
            reconstruct(data, clock.current)
              .attempts.slice()
              .reverse()
              .find((a) => a.phase === "running") ??
            reconstruct(data, clock.current).attempts.at(-1);
          setSelected(
            candidate
              ? { type: "attempt", id: candidate.id }
              : { type: "coverage" },
          );
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError")
          setError(
            "The lake API is unavailable. Start the FastAPI service, then retry.",
          );
      });
    return () => controller.abort();
  }, [retry]);

  useEffect(() => {
    if (!replay || !playing) return;
    let frame = 0,
      last = performance.now(),
      lastUi = last;
    function tick(now: number) {
      const delta = document.hidden ? 0 : Math.min(now - last, 250);
      last = now;
      clock.current = Math.min(
        replay!.checkpoint.range.end,
        clock.current + delta * speed,
      );
      if (now - lastUi >= 200) {
        setAt(clock.current);
        lastUi = now;
      }
      if (clock.current >= replay!.checkpoint.range.end) {
        setAt(clock.current);
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [replay, playing, speed]);

  const scene = useMemo(
    () => (replay ? reconstruct(replay, at) : null),
    [replay, at],
  );
  const layout = useMemo(
    () =>
      replay
        ? buildLakeLayout(
            replay.checkpoint.objects,
            captureAttempts(replay),
            replay.checkpoint.inventory,
          )
        : null,
    [replay],
  );
  const scoped = useMemo(
    () =>
      scene?.attempts.filter(
        (a) =>
          (workspace === "all" || a.workspace_id === workspace) &&
          (region === "all" ||
            scene.workspaces.find((w) => w.id === a.workspace_id)?.region ===
              region),
      ) ?? [],
    [scene, workspace, region],
  );
  const counts = {
    running: scoped.filter((a) => a.phase === "running").length,
    failed: scoped.filter((a) => a.phase === "failed").length,
    overdue: scoped.filter((a) => isOverdue(a, at)).length,
  };
  const filtered = scoped.filter((a) => {
    const q = query.trim().toLowerCase();
    const searchable = [
      a.name,
      a.task_key,
      a.run_id,
      a.route.external_source,
      ...a.route.source_ids,
      ...a.route.target_ids,
    ]
      .join(" ")
      .toLowerCase();
    return (
      (!q || searchable.includes(q)) &&
      (filter === "all" || filter === "overdue"
        ? filter !== "overdue" || isOverdue(a, at)
        : a.phase === filter)
    );
  });

  function camera(
    kind: CameraAction["kind"],
    target?: [number, number, number],
  ) {
    setAction({ kind, target, sequence: ++actionSequence.current });
  }
  function seek(time: number) {
    if (!scene) return;
    clock.current = Math.max(
      scene.range.start,
      Math.min(scene.range.end, time),
    );
    setAt(clock.current);
  }
  async function focus() {
    if (!scene || !layout) return;
    setView("lake");
    if (selected.type === "attempt") {
      const { makePath, positionAt } = await import("./motion");
      const a = scene.attempts.find((a) => a.id === selected.id);
      if (a)
        camera(
          "focus",
          positionAt(
            a,
            makePath(
              a,
              layout.objects,
              layout.airports,
              layout.piers,
              selectedDestination(a, selected),
            ),
            clock.current,
          ).position.toArray() as [number, number, number],
        );
    } else if (
      selected.type === "table" ||
      selected.type === "schema" ||
      selected.type === "catalog"
    ) {
      const o = layout.objects.find((o) =>
        selected.type === "table"
          ? o.id === selected.id
          : selected.type === "catalog"
            ? catalogId(o) === selected.id
            : schemaId(o) === selected.id,
      );
      if (o) camera("focus", o.position);
      else {
        const place =
          selected.type === "catalog"
            ? layout.docks.find((d) => d.id === selected.id)
            : layout.piers.find((d) => d.id === selected.id);
        if (place) camera("focus", place.center);
      }
    } else if (selected.type === "airport") {
      const airport = layout.airports.find((p) => p.id === selected.id);
      if (airport) camera("focus", airport.center);
    }
  }

  function loadCapture(data: Replay) {
    setReplay(data);
    setPlaying(false);
    setQuery("");
    setFilter("all");
    setWorkspace("all");
    setRegion("all");
    clock.current =
      data.checkpoint.mode === "demo"
        ? data.checkpoint.range.start + 600_000
        : data.checkpoint.range.end - 900_000;
    setAt(clock.current);
    const candidates = reconstruct(data, clock.current).attempts;
    const chosen =
      candidates
        .slice()
        .reverse()
        .find((a) => a.phase === "running" && a.kind === "plane") ??
      candidates.at(-1);
    setSelected(
      chosen ? { type: "attempt", id: chosen.id } : { type: "coverage" },
    );
    if (data.checkpoint.capture_id)
      window.history.replaceState(
        null,
        "",
        `/?capture=${encodeURIComponent(data.checkpoint.capture_id)}`,
      );
  }
  const visible = filtered
    .filter(
      (a) =>
        a.phase === "running" ||
        a.phase === "queued" ||
        (a.ended_at !== null && a.ended_at >= at - 900_000) ||
        (selected.type === "attempt" && selected.id === a.id),
    )
    .sort(
      (a, b) =>
        Number(b.phase === "running") - Number(a.phase === "running") ||
        (b.started_at ?? 0) - (a.started_at ?? 0),
    );
  const taskTimes = useMemo(
    () =>
      [
        ...new Set(
          replay?.events
            .filter((e) => e.type === "attempt.upsert")
            .map((e) => e.event_time) ?? [],
        ),
      ].sort((a, b) => a - b),
    [replay],
  );
  const previousTaskTime = taskTimes
    .slice()
    .reverse()
    .find((time) => time < at);
  const nextTaskTime = taskTimes.find((time) => time > at);
  const tickLabel = (time: number) =>
    `${new Date(time).toLocaleDateString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric" })} ${timestamp(time).slice(0, 5)}`;
  return (
    <div className="app-shell">
      <nav className="rail" aria-label="Main navigation">
        <div className="rail-brand" title="T1A Lake">
          <Waves size={25} />
        </div>
        <button
          className={view === "lake" ? "active" : ""}
          title="Lake view"
          aria-label="Lake view"
          onClick={() => setView("lake")}
        >
          <Layers3 size={20} />
        </button>
        <button
          className={view === "list" ? "active" : ""}
          title="Activity list"
          aria-label="Activity list"
          onClick={() => setView("list")}
        >
          <List size={21} />
        </button>
        <button
          title="Workspace coverage"
          aria-label="Workspace coverage"
          onClick={() => setSelected({ type: "coverage" })}
        >
          <Globe2 size={20} />
        </button>
        <div className="rail-spacer" />
        <button
          aria-label="Replay configuration"
          title="Replay configuration"
          onClick={() => setConfiguration(true)}
        >
          <Settings2 size={20} />
        </button>
        <span className="rail-account" title="T1A Operations">
          T1A
        </span>
      </nav>
      <div className="app-body">
        <header className="topbar">
          <a href="/" className="wordmark">
            lake<span>by T1A</span>
          </a>
          <div className="topbar-divider" />
          <div className="account-context">
            <span>Operations</span>
            <small>
              {scene?.mode === "replay"
                ? "Databricks history"
                : "Sample capture"}
            </small>
          </div>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search tasks or tables"
              placeholder="Search tasks or tables…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span>/</span>
          </label>
          <div className="header-right">
            <span className="demo-pill">
              <i />
              {scene?.mode === "replay"
                ? "Historical replay"
                : "Simulated replay"}
            </span>
            <div className="avatar">OP</div>
          </div>
        </header>
        {!scene ? (
          <main className="loading-state">
            {error ? (
              <>
                <CircleAlert size={30} />
                <h1>Waiting for the lake API</h1>
                <p role="alert">{error}</p>
                <button
                  className="primary-button"
                  onClick={() => setRetry(retry + 1)}
                >
                  Retry connection
                </button>
              </>
            ) : (
              <>
                <Waves size={36} />
                <h1>Preparing your lake</h1>
                <p>Loading the 24-hour replay capture.</p>
              </>
            )}
          </main>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">T1A / PLATFORM OPERATIONS</div>
                <h1>
                  Lake overview<span>Account activity, at a glance.</span>
                </h1>
              </div>
              <button
                className="coverage-button"
                onClick={() => setSelected({ type: "coverage" })}
              >
                <Globe2 size={15} />
                {
                  scene.workspaces.filter((w) => w.status === "connected")
                    .length
                }{" "}
                of {scene.workspaces.length} workspaces connected
                <ArrowUpRight size={14} />
              </button>
            </div>
            <div className="filterbar">
              <div className="scope-filters">
                <label>
                  <Layers3 size={14} />
                  <select
                    aria-label="Workspace filter"
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value)}
                  >
                    <option value="all">All workspaces</option>
                    {scene.workspaces.map((w) => (
                      <option value={w.id} key={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <Globe2 size={14} />
                  <select
                    aria-label="Region filter"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                  >
                    <option value="all">All regions</option>
                    {[...new Set(scene.workspaces.map((w) => w.region))].map(
                      (r) => (
                        <option key={r}>{r}</option>
                      ),
                    )}
                  </select>
                </label>
                <button
                  className="freshness"
                  onClick={() => setSelected({ type: "coverage" })}
                >
                  <i className="amber-dot" />
                  {scene.workspaces.filter((w) => w.status === "stale").length
                    ? `${scene.workspaces.filter((w) => w.status === "stale").length} source stale`
                    : "Capture loaded"}
                  <span>24-hour history</span>
                </button>
              </div>
              <div className="replay-status">
                <RotateCcw size={14} />
                <span>24-hour replay</span>
                <button
                  className="text-button"
                  onClick={() => setConfiguration(true)}
                >
                  <Settings2 size={14} />
                  Configure
                </button>
              </div>
            </div>
            {scene.warnings?.length ? (
              <div className="capture-notice" role="status">
                <CircleAlert size={15} />
                <details>
                  <summary>{scene.warnings.length} import notes</summary>
                  {scene.warnings.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </details>
              </div>
            ) : null}
            {scene.mode === "replay" && (
              <p className="capture-history-note">{scene.history_note}</p>
            )}
            <main className="workspace">
              <div className="main-workspace">
                {view === "lake" && (
                  <section
                    className="lake-stage"
                    aria-label="Interactive lake scene"
                  >
                    <div className="summary-strip">
                      {(["running", "failed", "overdue"] as const).map(
                        (key) => (
                          <button
                            key={key}
                            className={`summary ${key} ${filter === key ? "chosen" : ""}`}
                            aria-pressed={filter === key}
                            onClick={() =>
                              setFilter(filter === key ? "all" : key)
                            }
                          >
                            <span>
                              <i />
                              {key === "running"
                                ? "Running tasks"
                                : key === "failed"
                                  ? "Failed attempts"
                                  : "Beyond estimate"}
                            </span>
                            <strong>
                              {counts[key]}
                              <small>
                                {key === "running"
                                  ? "in motion"
                                  : key === "failed"
                                    ? "needs attention"
                                    : "holding route"}
                              </small>
                            </strong>
                          </button>
                        ),
                      )}
                    </div>
                    <Suspense
                      fallback={
                        <div className="scene-fallback">
                          Preparing the 3D scene…
                        </div>
                      }
                    >
                      {layout && (
                        <LakeScene
                          layout={layout}
                          attempts={visible}
                          selected={selected}
                          onSelect={setSelected}
                          clock={clock}
                          reduced={reduced}
                          eggs={eggs}
                          action={action}
                        />
                      )}
                    </Suspense>
                    <div className="scene-topnote">
                      <span title="Lake size follows the complete inventory. Filters preserve positions.">
                        {layout?.docks.length ?? 0} catalogs ·{" "}
                        {layout?.piers.length ?? 0} schemas ·{" "}
                        {layout?.objects.length ?? 0} tables ·{" "}
                        {layout?.airports.length ?? 0} airports
                      </span>
                      <small>Drag to orbit · right-drag to pan</small>
                    </div>
                    <div className="scene-legend">
                      <span>
                        <i className="solid" />
                        Observed
                      </span>
                      <span>
                        <i className="dotted" />
                        Historical
                      </span>
                      <span>
                        <i className="dashed" />
                        Configured
                      </span>
                    </div>
                    <div className="camera-controls">
                      <button
                        aria-label="Zoom in"
                        onClick={() => camera("zoom-in")}
                      >
                        <Plus size={17} />
                      </button>
                      <button
                        aria-label="Zoom out"
                        onClick={() => camera("zoom-out")}
                      >
                        <Minus size={17} />
                      </button>
                      <div />
                      <button
                        aria-label="Rotate lake"
                        onClick={() => camera("rotate")}
                      >
                        <Compass size={17} />
                      </button>
                      <button
                        aria-label="Reset camera"
                        onClick={() => camera("reset")}
                      >
                        <Maximize2 size={16} />
                      </button>
                    </div>
                  </section>
                )}
                <section
                  className={`activity-section ${view === "list" ? "expanded" : ""}`}
                  aria-label="Task activity"
                >
                  <div className="activity-heading">
                    <h2>
                      <Activity size={16} />
                      Activity<span>{filtered.length}</span>
                    </h2>
                    <div>
                      {filter !== "all" && (
                        <button
                          className="clear-filter"
                          onClick={() => setFilter("all")}
                        >
                          Clear {filter} filter ×
                        </button>
                      )}
                      <button
                        className="text-button"
                        onClick={() =>
                          setView(view === "lake" ? "list" : "lake")
                        }
                      >
                        {view === "lake" ? "Expand list" : "Back to lake"}
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="activity-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Task / route</th>
                          <th>Workspace</th>
                          <th>Status</th>
                          <th>Elapsed / estimate</th>
                          <th>Evidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered
                          .sort(
                            (a, b) =>
                              Number(b.phase === "failed") -
                                Number(a.phase === "failed") ||
                              Number(isOverdue(b, at)) -
                                Number(isOverdue(a, at)),
                          )
                          .map((a) => (
                            <tr
                              key={a.id}
                              className={
                                selected.type === "attempt" &&
                                selected.id === a.id
                                  ? "selected"
                                  : ""
                              }
                            >
                              <td>
                                <button
                                  className="task-button"
                                  onClick={() =>
                                    setSelected({ type: "attempt", id: a.id })
                                  }
                                >
                                  <span className={`task-type ${a.kind}`}>
                                    {a.kind === "plane" ? (
                                      <ArrowDownLeft size={17} />
                                    ) : a.kind === "ship" ? (
                                      <Ship size={17} />
                                    ) : (
                                      <Database size={16} />
                                    )}
                                  </span>
                                  <span>
                                    <strong>{a.name}</strong>
                                    <small>
                                      {a.route.target_ids[0]
                                        ?.split(":")
                                        .pop() ?? "Route unknown"}
                                    </small>
                                  </span>
                                </button>
                              </td>
                              <td>
                                {scene.workspaces
                                  .find((w) => w.id === a.workspace_id)
                                  ?.name.replace("Production ", "Prod. ")}
                              </td>
                              <td>
                                <StatusBadge attempt={a} at={at} />
                              </td>
                              <td className="tabular">
                                {duration(elapsed(a, at))}
                                <span className="muted">
                                  {" "}
                                  / {duration(a.estimate.predicted_duration_ms)}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={`evidence ${a.route.evidence}`}
                                >
                                  {a.route.evidence}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <div className="empty-list">
                        <Search size={21} />
                        <strong>No matching activity</strong>
                        <p>
                          Try another workspace, region, status, or search term.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuery("");
                            setWorkspace("all");
                            setRegion("all");
                            setFilter("all");
                          }}
                        >
                          Clear filters
                        </button>
                      </div>
                    )}
                  </div>
                </section>
                <section
                  className="playback"
                  aria-label="24-hour replay controls"
                >
                  <div className="playback-head">
                    <div>
                      <span className="capture-label">
                        <i />
                        {scene.mode === "demo"
                          ? "SIMULATED REPLAY"
                          : "HISTORICAL REPLAY"}
                      </span>
                      <span>
                        {new Date(scene.range.start).toLocaleDateString(
                          "en-CA",
                          { timeZone: "America/Toronto" },
                        )}{" "}
                        →{" "}
                        {new Date(scene.range.end).toLocaleDateString("en-CA", {
                          timeZone: "America/Toronto",
                        })}{" "}
                        · 24 hours
                      </span>
                    </div>
                    <div className="options-wrap">
                      <button
                        className={`icon-button ${options ? "selected" : ""}`}
                        aria-label="View options"
                        aria-expanded={options}
                        onClick={() => setOptions(!options)}
                      >
                        <Settings2 size={17} />
                      </button>
                      {options && (
                        <div className="options-panel">
                          <strong>View options</strong>
                          <label>
                            <input
                              type="checkbox"
                              checked={eggs}
                              onChange={(e) => setEggs(e.target.checked)}
                            />
                            Lake mascots
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={reduced}
                              onChange={(e) => setReduced(e.target.checked)}
                            />
                            Reduce motion
                          </label>
                          <p>The activity list contains every task.</p>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="timeline-row">
                    <button
                      className="icon-button"
                      aria-label="Previous task event"
                      disabled={previousTaskTime === undefined}
                      onClick={() => {
                        setPlaying(false);
                        if (previousTaskTime !== undefined)
                          seek(previousTaskTime);
                      }}
                    >
                      <SkipBack size={15} />
                    </button>
                    <button
                      className="play-button"
                      aria-label={playing ? "Pause playback" : "Play playback"}
                      onClick={() => {
                        if (at >= scene.range.end) seek(scene.range.start);
                        setPlaying(!playing);
                      }}
                    >
                      {playing ? <Pause size={16} /> : <Play size={16} />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Next task event"
                      disabled={nextTaskTime === undefined}
                      onClick={() => {
                        setPlaying(false);
                        if (nextTaskTime !== undefined) seek(nextTaskTime);
                      }}
                    >
                      <SkipForward size={15} />
                    </button>
                    <label className="speed-control">
                      <select
                        aria-label="Playback speed"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                      >
                        <option value={1}>1×</option>
                        <option value={5}>5×</option>
                        <option value={20}>20×</option>
                        <option value={60}>60×</option>
                        <option value={300}>300×</option>
                        <option value={1000}>1000×</option>
                        <option value={3600}>3600×</option>
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <span className="current-time">{timestamp(at)}</span>
                    <div className="timeline-track">
                      {scene.gaps.map((g, i) => (
                        <span
                          key={i}
                          className="gap-marker"
                          title={`${g.reason} ${timestamp(g.start)}–${timestamp(g.end)}`}
                          style={{
                            left: `${((g.start - scene.range.start) / (scene.range.end - scene.range.start)) * 100}%`,
                            width: `${((g.end - g.start) / (scene.range.end - scene.range.start)) * 100}%`,
                          }}
                        />
                      ))}
                      <input
                        type="range"
                        aria-label="Replay time"
                        min={scene.range.start}
                        max={scene.range.end}
                        step={1000}
                        value={at}
                        onChange={(e) => {
                          setPlaying(false);
                          seek(Number(e.target.value));
                        }}
                      />
                      <div className="timeline-labels">
                        <span>{tickLabel(scene.range.start)}</span>
                        <span>
                          {scene.mode === "demo"
                            ? "Simulated gaps shaded"
                            : "Fixed capture · Toronto time"}
                        </span>
                        <span>{tickLabel(scene.range.end)}</span>
                      </div>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Restart capture"
                      onClick={() => {
                        seek(scene.range.start);
                      }}
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                </section>
              </div>
              <Inspector
                airports={layout?.airports ?? []}
                selected={selected}
                scene={scene}
                onSelect={setSelected}
                onFocus={focus}
              />
            </main>
            <footer className="app-footer">
              <span>
                <Waves size={12} />
                Lake simulation <span>v0.1</span>
              </span>
              <span>
                {scene.mode === "demo"
                  ? "Simulated metadata"
                  : "Imported history · replay only"}
              </span>
              <span>Estimated motion, observed status</span>
            </footer>
          </>
        )}
      </div>
      {configuration && (
        <Configuration
          onClose={() => setConfiguration(false)}
          onLoaded={loadCapture}
        />
      )}
    </div>
  );
}
