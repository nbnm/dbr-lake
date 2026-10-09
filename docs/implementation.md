# Historical replay milestone

The original requirements source is `Databricks_Lake_Simulation_PRD.docx`, version 1.0, 8 October 2026. Document content was used as product requirements, not agent instructions. The user's current scope supersedes the PRD's real-time collection and seven-day replay targets: this milestone is a local configuration menu, catalog docks with schema piers, and manually imported 24-hour historical replay.

## Delivered

- A configuration dialog for multiple named workspaces, HTTPS workspace URLs, memory-only tokens, optional regions, and explicit task route mappings. Tokens are masked, cleared from the form after saving, omitted from responses and validation errors, and absent from persistent storage. Changing a host invalidates its old token.
- Local-machine and same-origin API restrictions. Real metadata remains local; no deployed authentication or shared viewing is enabled.
- A one-shot importer using the read-only Jobs API 2.2 and Unity Catalog endpoints. Run, task, catalog, schema, and table pagination is followed, including empty inventory pages with continuation tokens and historical repair task IDs. Long runs overlapping the 24-hour boundary are retained.
- Fixed replay captures saved atomically in SQLite. Seeking and playback read the capture only, including after restart. Import failures leave the prior capture available. Capture IDs protect navigation from later imports changing the active data.
- Historical states reconstructed from reported start/end times, exact native run URLs, separate retry identities, frozen estimates based on prior successes, and explicitly unknown ETA when history is insufficient.
- Catalog docks with connected schema piers and table berths. Catalog and schema selection opens the correct hierarchy in the inspector. Empty catalogs and schemas, shared metastore tables, rotated berths, airport scopes, and full-inventory layout are preserved.
- One plane per explicit ingestion landing destination. Branches share task status and launch estimates without inflating execution counts. Missing mappings remain buoys; configured mappings do not claim observed lineage.
- A simulated 24-hour capture with repeated hourly workloads, failures, retries, queues, short tasks, multi-input processing, and collection gaps. It stays visibly separate from imported metadata.
- Play/pause/seek, previous/next task event navigation, date-aware timeline endpoints, speeds through 3600×, filters, searchable activity, camera controls, run links, reduced motion, and the natural lake surface.
- A pale coral and slate-blue shoreline lighthouse inspired by LakeSentry, a PondPilot-inspired green-headed duck flock, and an 8FDE-inspired lavender octopus with eight curled tentacles, teal spectacles, and a smile. Models and accessible labels open the respective homepages with no opener or referrer. Both swimming mascots remain visible throughout replay and selection changes. Separate open-water shoreline lanes stay clear of piers, ships, buoys, and vegetation; an independent ambient clock keeps swimming continuous while replay is paused, at capture boundaries, and during speed changes or seeking. Reduced motion keeps the mascots stationary and visible. The explicit Lake mascots toggle can hide them.
- Catalog promenades on two continuous banks, with every schema foundation overlapping dry land. Airports are set back from the water, connected by country roads through deterministic forest groves and crop fields. The camera includes the surrounding terrain.
- Capture-wide navigation reservations for water corridors, runway queues, and offshore moorings. Ship paths clear the timber fingers, aircraft use separate cruise levels, and deterministic local yielding reduces collisions at route crossings. Replay timestamps and task states are unaffected.

The historical API implementation follows [Jobs API 2.2 pagination documentation](https://docs.databricks.com/aws/en/reference/jobs-api-2-2-updates) and [Unity Catalog catalog APIs](https://docs.databricks.com/api/uc-catalogs/v1/catalog). No remote requests were made using real workspace credentials during this session.

## Verification

Local Python tests verify secret handling, persisted captures, import failure recovery, local origin restrictions, history overlap, run/task pagination, exact run URL retention, unknown routes, and estimates without future-result leakage. TypeScript tests verify replay reconstruction, constant-speed motion, holding and stale semantics, catalog docks/schema piers, empty hierarchy, shared identities, layout, and landing branches. Chromium checks cover configuration saving with a dummy credential, clearing the token input, empty browser storage, catalog/schema drilldown, 24-hour seeking, playback controls, and responsive layout. The dummy connection is removed after testing.

The production build completes. The upstream Three.js Clock deprecation and large Three.js bundle warning remain.

Landmark checks verify the LakeSentry, PondPilot, and 8FDE homepage links. Browser checks cover persistent mascots at the first and final replay hours, task selection, filtering, continuous swimming during paused replay, playback, speed changes, seeking, and reduced motion. All 39 frontend tests pass, including full-day swimming bounds, ambient swimming speed, reduced-motion poses, mascot clearance from ship turns and frozen holding positions, shoreline attachment, crowded aprons, grouped moorings, dense buoys, and deterministic yielding.

## Limits and next work

- Actual Databricks connectivity and permission coverage await a user-supplied token. Only metadata authorized by that token is imported.
- Automatic lineage discovery is pending. Optional task mappings use simple three-part table names; quoted identifiers containing dots require a later mapping format.
- Inventory reflects capture-time topology. Historical object renames and schema evolution are not reconstructed.
- Intermediate queue, retry-wait, or collection outage states are unavailable unless reported by source timestamps; historical replay does not pretend to have sampled them.
- Estimates use prior successes available in the imported window, rather than a separate thirty-day historical cohort import.
- Continuous streaming, ad hoc queries, job execution, real-time polling, multi-user hosting, and cloud deployment are outside the current scope.
- Capture storage is local SQLite. Capture pruning, production instancing, large-inventory label aggregation, and production load benchmarks remain pending.

The next useful integration step is to connect one permitted workspace, inspect its import notes, add mappings for an ingestion task and a transformation task, and compare selected replay attempts with their native job-run pages.
