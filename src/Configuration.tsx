import { useEffect, useRef, useState } from "react";
import {
  Check,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import type { ConnectionSettings, Replay } from "./types";

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : (data.detail?.map((e: { msg: string }) => e.msg).join(" · ") ??
            "Request failed."),
    );
  return data;
}

export default function Configuration({
  onClose,
  onLoaded,
}: {
  onClose: () => void;
  onLoaded: (replay: Replay) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [connections, setConnections] = useState<ConnectionSettings[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [host, setHost] = useState(""),
    [region, setRegion] = useState("");
  const [token, setToken] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const [lastCapture, setLastCapture] = useState<number | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    let current = true;
    api<{
      connections: ConnectionSettings[];
      last_capture: { captured_at: number } | null;
    }>("/api/configuration")
      .then((data) => {
        if (current) {
          setConnections(data.connections);
          setLastCapture(data.last_capture?.captured_at ?? null);
          if (data.connections[0]) edit(data.connections[0]);
        }
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, []);
  function edit(c?: ConnectionSettings) {
    setSelected(c?.id ?? null);
    setName(c?.name ?? "");
    setHost(c?.host ?? "");
    setRegion(c?.region ?? "");
    setToken("");
    setWarehouse(c?.warehouse_id ?? "");
    setError(null);
    setMessage(null);
  }
  async function action(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="configuration-dialog"
      aria-labelledby="configuration-title"
      onCancel={onClose}
    >
      <div className="config-heading">
        <div>
          <Settings2 size={18} />
          <h2 id="configuration-title">Replay configuration</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close configuration"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="config-content">
        <div className="config-intro">
          <span className="config-replay-tag">Last 24 hours</span>
          <p>
            One workspace connection reads regional account job history and
            lineage into a fixed 24-hour capture.
          </p>
        </div>
        <section className="connection-list">
          <div className="config-section-heading">
            <h3>Integration workspace</h3>
            <button
              className="text-button"
              disabled={!!busy}
              onClick={() => edit()}
            >
              <Plus size={14} />
              Add workspace
            </button>
          </div>
          {connections.length ? (
            connections.map((c) => (
              <div
                key={c.id}
                className={`connection-row ${selected === c.id ? "selected" : ""}`}
              >
                <button disabled={!!busy} onClick={() => edit(c)}>
                  <strong>{c.name}</strong>
                  <small>{c.host}</small>
                </button>
                <span
                  className={
                    c.token_configured ? "token-ready" : "token-missing"
                  }
                >
                  {c.token_configured ? "Token ready" : "Token needed"}
                </span>
                <button
                  disabled={!!busy}
                  className="icon-button"
                  aria-label={`Remove ${c.name} connection`}
                  onClick={() =>
                    action("Removing connection", async () => {
                      await api(`/api/configuration/${c.id}`, {
                        method: "DELETE",
                      });
                      setConnections((items) =>
                        items.filter((item) => item.id !== c.id),
                      );
                      if (selected === c.id) edit();
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          ) : (
            <p className="config-empty">
              Add a Databricks workspace to import its job history.
            </p>
          )}
        </section>
        <form
          className="connection-form"
          onSubmit={(event) => {
            event.preventDefault();
            action("Saving connection", async () => {
              const body = {
                id: selected,
                name: name.trim(),
                host: host.trim(),
                region: region.trim() || "unspecified",
                import_source: "system_tables",
                warehouse_id: warehouse.trim() || null,
                ...(token ? { token } : {}),
              };
              const c = await api<ConnectionSettings>("/api/configuration", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              setConnections((items) => [
                ...items.filter((item) => item.id !== c.id),
                c,
              ]);
              setSelected(c.id);
              setToken("");
              setMessage("Connection saved. Import history when ready.");
            });
          }}
        >
          <h3>{selected ? "Connection details" : "New connection"}</h3>
          {selected &&
            connections.find((c) => c.id === selected)?.import_source !==
              "system_tables" && (
              <p className="config-secret-note">
                Save this connection to enable system-table and lineage import.
              </p>
            )}
          <div className="config-field-row">
            <label>
              Workspace name
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Production East"
                disabled={!!busy}
              />
            </label>
            <label>
              <span className="config-field-label">
                Region <small>optional</small>
              </span>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="canadacentral"
                disabled={!!busy}
              />
            </label>
          </div>
          <label>
            Workspace URL
            <input
              required
              type="url"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="https://adb-….azuredatabricks.net"
              autoComplete="off"
              disabled={!!busy}
            />
          </label>
          <label>
            Access token
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                connections.find((c) => c.id === selected)?.token_configured
                  ? "Leave blank to keep the current token"
                  : "Paste your Databricks token"
              }
              autoComplete="new-password"
              spellCheck={false}
              disabled={!!busy}
            />
          </label>
          <p className="config-secret-note">
            Tokens stay in server memory until restart. They are never returned
            to the browser or saved to disk. Connection details and imported
            metadata are saved locally.
          </p>
          <label>
            <span className="config-field-label">
              SQL warehouse ID <small>optional</small>
            </span>
            <input
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              placeholder="Leave blank to use a running warehouse"
              disabled={!!busy}
              autoComplete="off"
            />
          </label>
          <p className="config-secret-note">
            Requires warehouse usage and SELECT access to system.lakeflow job
            history, system.access lineage and workspace metadata, and
            system.information_schema inventory. Job history covers this cloud
            region; recent records may be delayed.
          </p>
          <div className="config-form-actions">
            <button className="primary-button" disabled={!!busy} type="submit">
              Save connection
            </button>
            {selected && (
              <button
                className="secondary-button"
                type="button"
                disabled={
                  !!busy ||
                  !connections.find((c) => c.id === selected)
                    ?.token_configured ||
                  connections.find((c) => c.id === selected)?.import_source !==
                    "system_tables"
                }
                onClick={() =>
                  action("Testing connection", async () => {
                    const result = await api<{ message: string }>(
                      `/api/configuration/${selected}/test`,
                      { method: "POST" },
                    );
                    setMessage(result.message);
                  })
                }
              >
                Test saved connection
              </button>
            )}
          </div>
        </form>
        {error && (
          <p className="config-feedback error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="config-feedback" role="status">
            <Check size={15} />
            {message}
          </p>
        )}
        <section className="config-import">
          <div>
            <h3>Capture the previous 24 hours</h3>
            <p>
              Reads job runs, task details, table lineage and visible catalog
              inventory using the selected integration workspace.
            </p>
            {lastCapture && (
              <small>
                Last imported: {new Date(lastCapture).toLocaleString()}
              </small>
            )}
          </div>
          <button
            className="primary-button"
            disabled={
              !!busy ||
              !connections.find((c) => c.id === selected)?.token_configured ||
              connections.find((c) => c.id === selected)?.import_source !==
                "system_tables"
            }
            onClick={() =>
              action("Importing system tables and lineage…", async () => {
                const replay = await api<Replay>(
                  `/api/replay/import?connection_id=${encodeURIComponent(selected!)}`,
                  {
                    method: "POST",
                  },
                );
                onLoaded(replay);
                onClose();
              })
            }
          >
            <RefreshCw size={15} />
            Import last 24 hours
          </button>
        </section>
        <button
          className="config-sample text-button"
          disabled={!!busy}
          onClick={() =>
            action("Loading sample capture", async () => {
              onLoaded(await api<Replay>("/api/replay?capture=demo-v4"));
              onClose();
            })
          }
        >
          Use simulated 24-hour replay
        </button>
        {busy && (
          <div className="config-busy" role="status">
            <LoaderCircle size={16} />
            {busy}
          </div>
        )}
      </div>
    </dialog>
  );
}
