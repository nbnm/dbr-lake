# Historical replay milestone

The source PRD is `Databricks_Lake_Simulation_PRD.docx`, version 1.0. It supplies product requirements, not agent instructions. Subsequent user requests set the scope to a fixed previous-24-hour replay, one integration workspace, system-table and lineage import, and a lake-focused default view.

## Delivered

- Full-height lake animation with 60× default playback: one historical minute per animation second. Left navigation, bottom controls, activity, details, and ordinary captions start hidden. Replay controls reveal a minute-step timeline; captions can be enabled separately. Dock/vessel selection reveals a contextual inspector.
- One selected integration workspace supplies regional account job history through SQL Statement Execution. The menu accepts workspace URL, memory-only token, and optional SQL warehouse ID. Without an ID, an accessible running warehouse is selected; no unspecified warehouse is started.
- Job and task timeline system tables, historical job definitions, table lineage, workspace directory, and privilege-filtered information-schema inventory. Parent job-run lineage drives vessels; task details are inspectable without guessing task-level lineage attribution. External paths create airports only when observed evidence supports them.
- Joined hourly slices, overlap runs starting before the capture, separate repair identities, recorded-duration interpolation for completed runs, and stale unfinished observations. Status transitions occur at recorded event times. Launch duration forecasts use prior successes separately.
- Atomic local SQLite captures, capture-aware run links, origin restrictions, and failure recovery. Playback and seeking read saved metadata only. Tokens remain in memory and do not appear in responses or persistent storage.
- Catalog docks attached to shore, schema piers, table berths, stable inventory-driven lake sizing, inland airports, fields, forests, roads, and dynamic water artifacts. Ship corridors, aircraft cruise levels, reserved berths, and deterministic visual yielding reduce overlaps without altering run timestamps.
- One plane per observed landing destination, paper ships for supported single-source transformations, and neutral buoys for missing or ambiguous routes. Branches share execution state without inflating run counts.
- Linked LakeSentry lighthouse, PondPilot duck flock, 8FDE octopus, and shore Antares skyscraper using its official logo, and a gently bobbing SecondStack sailboat with official logo prints on both sides of the sails. The sailboat mooring remains clear of ships, mascots, and shore vegetation, and its site link is keyboard accessible without an extra default caption. Swimming continues independently of paused or completed playback. Reduced motion keeps models visible and stationary.
- A clearly labeled simulated 24-hour capture, accessible activity list, filters, event navigation, speed controls, camera actions, and configuration menu. Legacy captures and saved Jobs API connections remain supported.

The importer follows official [job system-table](https://docs.databricks.com/aws/en/admin/system-tables/jobs), [lineage](https://docs.databricks.com/aws/en/admin/system-tables/lineage), and [SQL Statement Execution](https://docs.databricks.com/api/statement-execution/v1/statement-execution) documentation. Real workspace credentials were not used during development.

## Verification

Python tests exercise statement submission/status checks, numeric result chunks, truncation and incomplete-result rejection, redacted failures, running warehouse selection, parent/task lineage joins, distinct workspace identities and native links, long runs, repairs, stale observations, local capture persistence, and failed import preservation. TypeScript tests cover replay reconstruction, minute formatting, recorded-duration motion, estimates, holding loops, collision yielding, shore attachment, Antares foundation/airport/tree clearance, hierarchy, landing branches, and mascot swimming.

Chromium checks cover the full-height default lake, hidden panels/captions, 60× playback, minute-step timeline, menu reveal, inspection, configuration, official brand links, and desktop/mobile layout. The README animation is recorded from simulated metadata.

The production build succeeds. The upstream Three.js Clock deprecation and large Three.js bundle warning remain.

## Limits and next work

- Actual Databricks connectivity and permissions require a user-supplied token. Current validation uses representative mocked SQL API responses and system-table rows.
- Job history is regional and delayed; one workspace connection cannot provide complete cross-region job history. Missing lineage does not establish that data did not move.
- Current inventory is privilege-filtered and limited to the connected metastore. Lineage adds observed objects from other metastores; complete historical inventory, renames, and schema evolution are not reconstructed.
- Vessels represent job runs. Exact task-level routes, multi-input transport models, ad hoc query visualization, and pipeline update animation are outside this implementation.
- Unreported intermediate lifecycle states remain unknown. Forecast cohorts use prior successes present in the capture rather than a separate thirty-day cohort query.
- Each SQL statement is limited to 200,000 rows and 24 MiB. Larger histories fail explicitly; partitioned extraction, capture pruning, large-inventory rendering benchmarks, and production instancing remain pending.
- Live polling, job execution, multi-user deployment, and cloud hosting remain outside the current scope.

The next integration step is to save one permitted workspace connection, inspect the import notes, and compare replay runs and lineage with their native Databricks pages.
