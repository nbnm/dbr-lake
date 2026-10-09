# T1A Databricks Lake Replay

A local, read-only lake visualization for replaying the previous 24 hours of Databricks job history. Catalogs are docks, schemas are piers, and tables are berths. External ingestion uses one paper plane per mapped destination; table transformations use paper ships. Unresolved task routes remain processing buoys.

**There is no real-time collection.** Import a fixed capture manually, then play, pause, seek, or jump between task events without further workspace requests. A visibly labeled simulated 24-hour capture is available before connecting a workspace.

![Animated preview of T1A Lake with replaying paper vessels, catalog docks, a pale lighthouse, swimming PondPilot ducks and an 8FDE octopus](docs/assets/lake-replay.gif)

_Recorded from the running app with simulated metadata at 20× replay speed._

## What the lake shows

- **Catalog docks → schema piers → table berths.** The lake grows with the inventory, and shared tables retain a single identity across workspaces.
- **Paper planes** bring data from external-source airports. A task writing to several tables has one plane for each destination; clicking a plane reveals its task and job-run link.
- **Paper ships** show mapped table transformations. Tasks with unresolved or multi-input routes remain processing buoys.
- **A 24-hour replay** supports play, pause, seeking, speed controls, and previous/next task events. Workspace and region filters preserve the harbor layout.
- **A task inspector and activity list** expose execution state, elapsed time, launch estimates, route evidence, retries, and source details.
- **A pale LakeSentry-inspired lighthouse, PondPilot-inspired ducks, and an 8FDE-inspired octopus** link to their respective sites. The ducks and octopus swim continuously throughout replay.
- **A connected landscape** places catalog docks directly on the shore, with schema piers extending into the water. Forest groves, crop fields, and country roads surround the lake; external-source airports sit farther inland.

The frontend uses React, TypeScript, Three.js, and React Three Fiber. A Python FastAPI backend imports historical Jobs and Unity Catalog metadata and stores fixed replay captures in local SQLite. The included simulated capture makes the app runnable without a Databricks connection.

## Run locally

Requires Node.js 22.12+ and Python 3.11+.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci
npm run build
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Open [the lake](http://127.0.0.1:8001/). For frontend development, run `npm run dev` and open port 5173; Vite proxies the API to port 8001.

## Configure a replay

1. Open **Configure**, or the settings button at the bottom of the navigation rail.
2. Enter a workspace name, HTTPS Databricks workspace URL, access token, and optional region.
3. Save the connection. **Test saved connection** checks read access to historical job runs.
4. Optionally add task route mappings to connect known tasks to table berths and external-source airports.
5. Click **Import last 24 hours**. The server reads visible historical runs and Unity Catalog metadata once, then saves a fixed capture. Multiple saved workspaces can be imported together; each needs a token.
6. Use the timeline, previous/next task event buttons, and playback speeds up to 3600×. Timeline labels include the day so a window crossing midnight remains clear.

Tokens remain in server memory until restart. They are never returned by the API, stored in browser storage, or written to the settings database. Workspace details, mappings, and imported metadata persist locally in `.data/`; tokens must be re-entered after restarting the server. Changing the workspace URL clears the existing token. The configuration and replay APIs accept only local-machine, same-origin requests; this is a single-user local tool, not a deployed multi-user service.

Example optional route mapping:

```json
[
  {
    "job_id": "123",
    "task_key": "ingest",
    "source_tables": [],
    "target_tables": ["sales.raw.orders", "operations.events.clickstream"],
    "external_source": "Event Hubs"
  }
]
```

Mappings use tables found in the token's authorized inventory. A missing table produces an import note. Mapping evidence stays labeled **configured**; it does not claim that lineage was observed. A multi-input task remains a buoy rather than fabricating input/output pairs. Automatic lineage ingestion is not implemented.

## Historical import behavior

The importer follows [Jobs API 2.2 pagination](https://docs.databricks.com/aws/en/reference/jobs-api-2-2-updates), including task arrays and repair task run IDs. It scans visible retained runs and filters interval overlap, retaining long runs that began before the 24-hour window and ended inside it or remained active at capture time. The captured window ends when the import starts; unfinished attempts stay unfinished at that boundary.

Historical running/terminal transitions are reconstructed from reported start and end timestamps. Intermediate lifecycle polls were not collected. Duration estimates use only prior comparable successful attempts present in the imported history and never use the current attempt's eventual duration. Sparse cohorts retain unknown ETA. Jobs API start time can include setup; that timing basis is preserved in the inspector.

Catalog/schema/table discovery uses the authorized [Unity Catalog APIs](https://docs.databricks.com/api/uc-catalogs/v1/catalog). Empty catalogs and schemas retain their place in the hierarchy. Permission-limited inventory produces visible notes; job replay can still work without catalog access. Topology represents inventory at import time, not historical schema changes.

Databricks run links use the exact HTTPS `run_page_url` returned by the source. Simulated runs open a local run-details page. Capture-aware return links preserve selected destinations and replay time. Replay captures survive server restart; a failed import preserves the previous capture.

The importer sends metadata GET requests only. It does not start jobs, alter workspace settings, query SQL warehouses, or poll running tasks. A capture is activated only after all configured workspaces' job history imports complete. Page safety limits fail explicitly rather than silently truncating job history.

## Implementation

| Area                                                 | Location                                      |
| ---------------------------------------------------- | --------------------------------------------- |
| Memory-only credentials and persistent captures      | `backend/connections.py`                      |
| One-shot historical Jobs and catalog import          | `backend/replay_import.py`                    |
| Local-only configuration and replay endpoints        | `backend/app.py`                              |
| Catalog docks, schema piers, and stable table layout | `src/layout.ts`, `src/scene/HarborModels.tsx` |
| Replay configuration menu                            | `src/Configuration.tsx`                       |
| Playback, filters, and inspection                    | `src/App.tsx`, `src/Inspector.tsx`            |
| Arc-length flight/ship motion                        | `src/motion.ts`, `src/vessels.ts`             |
| Run navigation                                       | `src/runLinks.ts`, `src/JobRunPage.tsx`       |

Schema piers use up to six visual table modules while retaining every table in the inspector. The scene prioritizes running, queued, selected, and recently completed attempts, rendering up to 200 task attempts plus their destination planes. The full imported activity list remains searchable. Layout stays stable during filtering and replay.

Navigation reserves water corridors, apron positions, and mooring space from the complete capture. Ships leave the timber fingers before turning; planes cross open water at separate cruise heights. Local visual yielding reduces overlaps at crossings without changing task timestamps or status. Repeated seeks produce the same positions, and stale or failed vessels retain their frozen position. These routes illustrate estimated elapsed time, not measured data transfer or a physical traffic simulation.

The spiral-striped lighthouse draws on the [LakeSentry logo](https://lakesentry.io/) with pale coral, slate blue, and soft glass colours. The green-headed duck flock draws on [PondPilot's Polly logo](https://pondpilot.io/); the lavender octopus adapts [8FDE's mascot](https://8fde.ai/) with eight curled arms, round teal glasses, and a smile. Clicking a model or its keyboard-accessible label opens the respective homepage in a new tab. The ducks and octopus stay visible throughout the full 24-hour replay, including when tasks are selected or filtered. They swim in separate shoreline lanes kept clear of ship turns, buoys, piers, and vegetation. Swimming follows replay time, pauses with playback, and reproduces the same positions after seeking. Reduced motion keeps both mascots visible in fixed positions. View options → Lake mascots can hide them explicitly.

## Validate

```sh
.venv/bin/python -m pytest -q
npm test
npm run build
```

Tests cover duration cohorts, route evidence, retries, event-time reconstruction, 24-hour import boundaries, pagination, overlap runs, secret redaction, persistence, origin restrictions, import failure recovery, constant-speed motion, holding loops, landing-plane identity, catalog/schema hierarchy, empty inventory, shared tables, and airport layout. Real workspace access requires your credentials and has not been exercised in this development session.

See [implementation status](docs/implementation.md) for remaining limitations.
