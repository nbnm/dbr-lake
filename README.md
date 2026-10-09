# SimLake

SimLake by T1A is a local lake visualization for replaying the previous 24 hours of Databricks job history. Catalogs are docks and schemas are piers. Table identities drive vessel routes and remain available in the inspector; individual tables are not drawn or captioned on the lake. Paper planes carry external ingestion to schema piers and exports to external airports; paper ships follow table transformations between piers. Unresolved or multi-input routes appear as neutral paper ships holding their positions.

The lake is the main view. Playback starts at **60×: one minute of history per second of animation**. Navigation, activity, the timeline, and ordinary captions are hidden initially. Use **Replay** to reveal the minute-level timeline and **View options → Show captions** for labels. Click a vessel or dock to open its details. LakeSentry, 8FDE, PondPilot, Antares, and SecondStack keep matching linked plaques visible, with placement that avoids overlapping names. Official logos appear on the Antares plaque, SecondStack sails, a flying Alchemist zeppelin, and a low T1A sign on the foreground shore. Alchemist uses only a small symbol on each side of its hull.

![Animated preview of SimLake: paper vessels, shore docks, forest, fields, LakeSentry lighthouse, swimming PondPilot ducks and 8FDE octopus, Antares skyscraper and SecondStack sailboat](docs/assets/lake-replay.gif)

_Recorded from the running app with explicitly simulated metadata and 60× playback. The swimming mascots use an independent ambient clock._

## What the lake shows

- **Catalog docks → schema piers.** The lake renders only schemas referenced by lineage or supported routes in the selected 24-hour capture, and their parent catalogs. Unused and empty catalogs/schemas are omitted. Every schema has one pier, regardless of table count. Tables appear only in details, with the complete inventory retained. Lake size follows this visible topology; positions stay stable during filtering and seeking.
- **One plane per landing destination.** A job writing to several tables can have several planes. Each opens the same job-run status and its destination details without inflating execution counts.
- **Outbound exports.** Pale gold paper planes depart from source schema piers and land at external destination airports. Clicking an export reveals its source table, destination, status, and job-run link. Imported exports require a single observed table source and one external path destination; mixed or ambiguous routes stay as stationary processing paper ships.
- **Paper ships.** A single observed table source can drive a transformation route. Missing or ambiguous lineage remains visibly unresolved, with a neutral paper ship holding its position rather than an invented journey.
- **Fixed 24-hour replay.** Minute-level seeking, event navigation, playback speeds, workspace filters, an accessible activity list, and contextual inspection use a saved capture. No live collection runs in the background.
- **A natural landscape.** Docks attach to shore; inland airports, forests, crop fields, country roads, reeds, and ripples surround the lake. Reserved corridors and deterministic yielding reduce vessel overlaps.
- **Linked landmarks.** A pale [LakeSentry](https://lakesentry.io/) lighthouse, [PondPilot](https://pondpilot.io/) ducks, [8FDE](https://8fde.ai/) octopus, [Antares](https://getantares.io/) skyscraper, [SecondStack](https://secondstack.ai/) sailboat, [Alchemist](https://getalchemist.io/) zeppelin, and foreground [T1A](https://t1a.com/) shore sign open their homepages. SecondStack's official logo is printed on both sides of the sails; Alchemist's small official symbol appears on both hull sides, without lettering or a floating plaque. The zeppelin circles in a separate sky lane above aircraft and buildings, independently of paused or completed replay. T1A's low sign sits on the near shore at the bottom of the lake view and faces the camera; compact views pin its logo at the bottom center. Brand links are keyboard accessible. The SecondStack sailboat, PondPilot flock, and 8FDE octopus continuously travel across both halves of the lake, including while replay is paused or completed. They share collision clearance with paper ships; planes pass above the sailboat mast. Reduced motion keeps these models visible and stationary.

React, TypeScript, Three.js, and React Three Fiber render the scene. A Python FastAPI backend reads Databricks system tables through SQL Statement Execution and saves fixed captures in local SQLite. A visibly labeled simulated capture makes the app usable before a workspace is connected.

A tall Canadian flagpole stands on the shore beside the lighthouse. Its locally bundled [official flag artwork](https://www.canada.ca/en/canadian-heritage/services/flag-canada-description.html) faces the camera and flutters gently, including during paused replay. The flag remains visible with captions and lake mascots hidden; reduced motion keeps it unfurled and still.

Choose **Configure replay → Add 84 simulated runs** after importing a workspace. This preserves every real job run, schema, table identity, lineage record and Databricks link, then adds 28 API landings, 28 table transformations and 28 exports spread across the captured day. Simulated names follow the actual imported job definitions; routes use actual captured table IDs in workspaces that can see them. Simulated routes, times and results are explicitly invented, and their links open local simulation details. The mixed capture is saved separately from its source and becomes the active replay. Repeating the action returns the same capture without duplicating runs, including after restart. Playback needs no additional remote queries.

**Standalone simulated sample · 80 runs** remains available without a connection at [the sample lake](http://127.0.0.1:8001/?capture=demo-v5). It uses invented execution data and workspace-style names, separate from the real workspace overlay. The default 60× speed plays a full day in 24 minutes.

## Run locally

Requires Node.js 22.12+ and Python 3.11+.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
npm ci
npm run build
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001
```

Open [SimLake](http://127.0.0.1:8001/). For frontend development, run `npm run dev` and open port 5173; Vite proxies the API to port 8001.

## Configure one integration workspace

1. Open the settings button in the header, **Configure replay**.
2. Enter the workspace name and HTTPS workspace URL. Choose **Databricks CLI · OAuth** and enter an existing CLI profile name, or choose **Access token** to paste a token. The region label is optional.
3. Enter a SQL warehouse ID, or leave it blank to use an accessible running warehouse. An explicitly selected stopped warehouse may start when Databricks executes the metadata queries.
4. Save the connection. **Test saved connection** checks access to job, task, and lineage system tables.
5. Select the integration workspace and click **Import last 24 hours**. No manual route mappings or separate tokens for each observed workspace are required.
6. Open **Replay** to reveal controls. The slider advances in one-minute steps; timestamps show hours and minutes in Toronto time. The default speed is 60×.

The token needs warehouse usage and appropriate `USE`/`SELECT` grants on the relevant system catalog schemas. Required history tables are `system.lakeflow.jobs`, `system.lakeflow.job_run_timeline`, `system.lakeflow.job_task_run_timeline`, and `system.access.table_lineage`. Workspace directory and inventory queries are optional; missing permission becomes an import note. See [Databricks system-table access](https://docs.databricks.com/aws/en/admin/system-tables/) and [SQL Statement Execution](https://docs.databricks.com/api/statement-execution/v1/statement-execution).

**One connection covers regional job history, not every cloud region.** Databricks job system tables contain account workspaces in the integration workspace's region. Records typically arrive within about an hour of a timeline slice ending; new workspaces may take longer. [Databricks job-history coverage and availability](https://docs.databricks.com/aws/en/admin/system-tables/jobs).

For CLI authentication, sign in on the machine running the backend:

```sh
databricks auth login --host https://YOUR-WORKSPACE.azuredatabricks.net --profile lake-replay
```

Enter `lake-replay` in **CLI profile name**. The backend checks that the profile matches the workspace URL and asks the CLI for a current OAuth token before each test or import. The CLI owns token storage and refresh; the app saves only the profile name. See [Databricks CLI OAuth authentication](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/oauth-u2m).

Pasted tokens stay in server memory until restart. Authentication tokens are omitted from API responses, browser storage, validation errors, and the settings database. Connection details and imported metadata persist locally in `.data/`; pasted tokens must be re-entered after restart, while CLI profiles can be reused. Changing a workspace URL or authentication method clears its old pasted token. The API accepts only local-machine, same-origin requests. This is a local single-user tool.

## How the capture is reconstructed

| Source                                  | Use                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `system.lakeflow.job_run_timeline`      | Job-run start/end periods, result states, and separate repair executions  |
| `system.lakeflow.job_task_run_timeline` | Task-run details within the parent job run                                |
| `system.lakeflow.jobs`                  | The job definition observed before each run started                       |
| `system.access.table_lineage`           | Observed source/target tables and external paths associated with job runs |
| `system.access.workspaces_latest`       | Workspace names, regions, and native run-link hosts                       |
| `system.information_schema`             | Privilege-filtered catalogs, schemas, tables, and metastore identity      |

Hourly timeline slices are joined before animation. Runs that started before the 24-hour window are retained if they overlap it. Repaired runs keep separate execution identities. Running/terminal transitions follow reported timestamps; intermediate queue and retry-wait states are not fabricated.

Vessels represent **job runs**, with task runs shown in the inspector. Lineage's parent job-run identifiers support this association; task-level source/target attribution is not guessed. A single external source path plus destination tables creates inbound planes. A single observed table source plus one external target path creates an outbound export plane. Target-only writes are insufficient to invent an airport, and an arbitrary API call is not inferred from a job name. Table identifiers retain metastore identity. Lineage contributes observed historical objects, while information-schema inventory reflects the current metastore's authorized capture-time topology. The saved inventory remains complete; the lake displays only schemas used by a captured source/target route or a captured lineage record, including reads and ad hoc activity without a matching job run. This selection uses the entire capture, not the current replay minute or workspace/status filter. Missing lineage does not establish inactivity. Historical renames and complete inventories across other metastores are not reconstructed. [Lineage coverage and schema](https://docs.databricks.com/aws/en/admin/system-tables/lineage).

Completed historical runs use **recorded duration** to interpolate vessel motion smoothly. This illustrates elapsed time, not measured row or byte progress. Duration forecasts remain separate, use only prior comparable successes, and stay unknown for sparse cohorts. Unfinished runs retain unknown completion time; motion freezes at their last reported slice when observations are stale. Status changes only at the recorded event time.

Run links use the actual workspace host from the system directory. If that directory is unavailable, the importer leaves native links unresolved. Simulated runs open a local run-details page. Captures survive restart, and failed imports preserve the previous capture. Older captures and legacy Jobs API connections remain readable; saving a connection in the current menu selects the system-table importer.

Imports submit application-owned metadata `SELECT` queries to a SQL warehouse. Pending statement checks and result-chunk pagination happen only during import; playback makes no remote requests. Truncated or incomplete results fail explicitly. Queries are bounded to 200,000 rows and 24 MiB per statement. Very large histories require a later partitioned importer.

## Implementation

| Area                                             | Location                                                    |
| ------------------------------------------------ | ----------------------------------------------------------- |
| Memory-only credentials and persistent captures  | `backend/connections.py`                                    |
| CLI OAuth profile validation and token refresh   | `backend/cli_auth.py`                                       |
| Regional system-table and lineage import         | `backend/system_import.py`                                  |
| Capture assembly and legacy import compatibility | `backend/replay_import.py`                                  |
| Local-only configuration and replay endpoints    | `backend/app.py`                                            |
| Real-history overlay with 84 simulated runs       | `backend/simulation.py`                                     |
| Stable harbor layout and navigation              | `src/layout.ts`, `src/navigation.ts`, `src/traffic.ts`      |
| Configuration, playback, and inspection          | `src/Configuration.tsx`, `src/App.tsx`, `src/Inspector.tsx` |
| Paper vessels, landmarks, and ambient swimming   | `src/scene/`, `src/motion.ts`, `src/wildlife.ts`            |

Schema piers contain shared traffic ports and no table models or table captions. Table count does not affect a pier's width. Every table remains available in the inspector and route metadata. The scene prioritizes active, selected, and recently completed executions, rendering up to 200 execution attempts plus destination planes. The full imported activity list stays searchable; mixed captures label real and simulated runs individually.

## Validate

```sh
.venv/bin/python -m pytest -q
npm test
npm run build
```

Tests cover SQL submission and pagination, truncation and failure recovery, single-connection imports, cross-workspace run links, lineage association, long runs, repairs, stale observations, secret handling, CLI profile matching and refresh, persisted captures, replay reconstruction, recorded-duration motion, navigation clearance, hierarchy, and continuous mascot swimming. Browser checks cover the hidden default menus and captions, minute-level timeline, 60× playback, configuration, inspection, linked landmarks, and responsive layout. A real Azure Databricks import has verified CLI OAuth, warehouse usage, job/task history, lineage, inventory, workspace directory, and native run links. Private captures remain local and are excluded from Git; the README animation uses simulated metadata.

See [implementation status](docs/implementation.md) for remaining limitations.
