"""Fixed, regional job-history replay from one workspace's system tables."""
import hashlib
import json
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit
from uuid import uuid4
import httpx
from .connections import ConnectionInput
from .estimates import DAY_MS
from .models import LakeObject, Route, Workspace
from .replay_import import DatabricksReader, ImportFailure, finish_capture, phase_for

ROW_LIMIT = 200_000


def metadata_object(value):
    if not isinstance(value, dict):
        raise ImportFailure('Databricks returned invalid SQL metadata; the capture was not saved.')
    return value


class SystemTablesReader(DatabricksReader):
    def get(self, path, params=None):
        return metadata_object(super().get(path, params))

    def warehouse(self):
        ident = self.settings.get('warehouse_id')
        if ident:
            return ident
        running = sorted((w for w in self.get('/api/2.0/sql/warehouses').get('warehouses', [])
                          if w.get('state') == 'RUNNING'), key=lambda w: str(w['id']))
        if not running:
            raise ImportFailure('Enter a SQL warehouse ID or start an existing warehouse, then import again.')
        self.settings = {**self.settings, 'warehouse_id': str(running[0]['id'])}
        return self.settings['warehouse_id']

    def post(self, path, body):
        try:
            response = self.client.post(path, json=body)
        except httpx.HTTPError:
            raise ImportFailure('The SQL warehouse could not be reached.') from None
        if response.status_code not in (200, 201):
            raise ImportFailure(f'Databricks SQL request failed (HTTP {response.status_code}). Check warehouse and system-table permissions.')
        try:
            return metadata_object(response.json())
        except ValueError:
            raise ImportFailure('Databricks returned an invalid SQL response.') from None

    def query(self, statement, parameters=None):
        # Only application-owned SELECT queries are exposed. Never follow result URLs.
        if not re.match(r'\s*(SELECT|WITH)\b', statement, re.I):
            raise ImportFailure('Only metadata SELECT statements are supported.')
        data = self.post('/api/2.0/sql/statements', dict(statement=statement,
            warehouse_id=self.warehouse(), parameters=parameters or [], format='JSON_ARRAY',
            disposition='INLINE', row_limit=ROW_LIMIT, byte_limit=24 * 1024 * 1024,
            wait_timeout='10s', on_wait_timeout='CONTINUE'))
        if not isinstance(data, dict):
            raise ImportFailure('Databricks returned an invalid SQL response.')
        ident = data.get('statement_id', '')
        if not isinstance(ident, str) or not re.fullmatch(r'[A-Za-z0-9-]+', ident):
            raise ImportFailure('SQL response has no valid statement ID.')
        deadline = time.monotonic() + 120
        while metadata_object(data.get('status', {})).get('state') in ('PENDING', 'RUNNING'):
            if time.monotonic() >= deadline:
                try:
                    self.post(f'/api/2.0/sql/statements/{ident}/cancel', {})
                except ImportFailure:
                    pass
                raise ImportFailure('The metadata query timed out; the previous capture is unchanged.')
            time.sleep(0.5)
            data = self.get(f'/api/2.0/sql/statements/{ident}')
        if metadata_object(data.get('status', {})).get('state') != 'SUCCEEDED':
            # Remote error messages may contain SQL, paths or credentials.
            raise ImportFailure('The system-table query failed. Verify enabled schemas, SELECT grants and warehouse access.')
        manifest = metadata_object(data.get('manifest', {}))
        if manifest.get('truncated'):
            raise ImportFailure('Metadata exceeds the capture limit; no truncated capture was saved.')
        try:
            columns = [c['name'] for c in manifest['schema']['columns']]
            expected_rows = int(manifest['total_row_count'])
        except (KeyError, TypeError, ValueError):
            raise ImportFailure('SQL result metadata is incomplete; the capture was not saved.') from None
        if expected_rows < 0 or expected_rows > ROW_LIMIT or not all(isinstance(c, str) for c in columns):
            raise ImportFailure('SQL result metadata exceeds capture limits or has an invalid schema.')
        result, rows, seen = metadata_object(data.get('result', {})), [], set()
        while True:
            if result.get('truncated'):
                raise ImportFailure('Metadata was truncated; the capture was not saved.')
            values_array = result.get('data_array', [])
            if not isinstance(values_array, list):
                raise ImportFailure('SQL result rows are invalid.')
            for values in values_array:
                if not isinstance(values, list) or len(values) != len(columns):
                    raise ImportFailure('SQL result schema does not match its rows.')
                rows.append(dict(zip(columns, values)))
            if len(rows) > ROW_LIMIT:
                raise ImportFailure('Metadata exceeds the local capture limit.')
            index = result.get('next_chunk_index')
            if index is None:
                break
            if type(index) is not int or index < 1 or index in seen or len(seen) >= 1000:
                raise ImportFailure('SQL result pagination did not complete.')
            seen.add(index)
            result = self.get(f'/api/2.0/sql/statements/{ident}/result/chunks/{index}')
        if expected_rows != len(rows):
            raise ImportFailure('The SQL result is incomplete; the capture was not saved.')
        return rows

    def test(self):
        for table in ('system.lakeflow.jobs', 'system.lakeflow.job_run_timeline', 'system.lakeflow.job_task_run_timeline', 'system.access.table_lineage'):
            self.query(f'SELECT 1 FROM {table} LIMIT 1')


def bounds(start, end):
    return [{'name': key, 'type': 'TIMESTAMP', 'value': datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()}
            for key, value in (('start', start), ('end', end))]


def timeline_query(task=False):
    table = 'job_task_run_timeline' if task else 'job_run_timeline'
    run_column = 'job_run_id' if task else 'run_id'
    return f'''WITH scope AS (
      SELECT DISTINCT account_id, workspace_id, job_id, run_id
      FROM system.lakeflow.job_run_timeline
      WHERE period_start_time <= :end AND period_end_time >= :start
    )
    SELECT /* lake:{'tasks' if task else 'runs'} */ t.account_id, t.workspace_id, t.job_id, t.run_id,
      {'t.job_run_id, t.task_key,' if task else 't.run_name,'} t.result_state,
      unix_millis(t.period_start_time) AS start_ms,
      unix_millis(t.period_end_time) AS end_ms
    FROM system.lakeflow.{table} t JOIN scope s
      ON t.account_id=s.account_id AND t.workspace_id=s.workspace_id
      AND t.job_id=s.job_id AND t.{run_column}=s.run_id
    WHERE t.period_start_time <= :end'''


def integer(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        raise ImportFailure('A system-table timestamp is invalid; the capture was not saved.') from None


def segments(rows, end):
    """Rejoin hourly slices, retaining separate repair executions of the same ID."""
    unique = {json.dumps(row, sort_keys=True): row for row in rows}
    batch = []
    for row in sorted(unique.values(), key=lambda r: (integer(r['start_ms']), integer(r['end_ms']))):
        batch.append(row)
        terminal = bool(row.get('result_state')) and integer(row['end_ms']) <= end
        if terminal:
            yield batch
            batch = []
    if batch:
        yield batch


def workspace_host(value):
    if not value:
        return None
    try:
        return ConnectionInput.workspace_host(value if '://' in value else 'https://' + value)
    except ValueError:
        return None


def external_name(path):
    # Retain the source location identity, never query strings or URL credentials.
    parts = urlsplit(path)
    if parts.scheme and parts.netloc:
        authority = parts.netloc.rsplit('@', 1)[-1]
        if parts.scheme in ('abfs', 'abfss') and '@' in parts.netloc:
            container = parts.netloc.rsplit('@', 1)[0]
            if ':' not in container:
                authority = container + '@' + authority
        return f'{parts.scheme}://{authority}'
    return path.split('?', 1)[0].split('#', 1)[0].split('/', 3)[0] or 'External storage'


def build_system_capture(settings, token, end, reader_factory=SystemTablesReader):
    start, capture_id = end - DAY_MS, uuid4().hex
    reader = reader_factory(settings, token)
    warnings = ['System-table job history covers this integration workspace’s cloud region, not every region. '
                'Recent records may arrive about an hour late; missing lineage is not proof that data did not move.']
    params = bounds(start, end)
    try:
        runs = reader.query(timeline_query(), params)
        tasks = reader.query(timeline_query(True), params)
        lineage = reader.query('''SELECT /* lake:lineage */ account_id, workspace_id, metastore_id, record_id,
            entity_type, entity_id, entity_run_id, source_type, source_path, target_type,
            source_table_catalog, source_table_schema, source_table_name,
            target_table_catalog, target_table_schema, target_table_name,
            unix_millis(event_time) AS event_ms,
            entity_metadata.job_info.job_id AS lineage_job_id,
            entity_metadata.job_info.job_run_id AS lineage_job_run_id
            FROM system.access.table_lineage
            WHERE event_date >= CAST(:start AS DATE) AND event_time BETWEEN :start AND :end''', params)
        def optional(statement, description):
            try:
                return reader.query(statement)
            except ImportFailure as error:
                warnings.append(f'{description}: {error}')
                return []
        ws_rows = optional('SELECT /* lake:workspaces */ account_id, workspace_id, workspace_name, workspace_url, region, cloud FROM system.access.workspaces_latest', 'Workspace directory unavailable')
        meta_rows = optional('SELECT /* lake:metastores */ metastore_id FROM system.information_schema.metastores', 'Metastore inventory unavailable')
        catalogs = optional("SELECT /* lake:catalogs */ catalog_name FROM system.information_schema.catalogs WHERE catalog_name <> 'system'", 'Catalog inventory unavailable')
        schemas = optional("SELECT /* lake:schemas */ catalog_name, schema_name FROM system.information_schema.schemata WHERE catalog_name <> 'system' AND schema_name <> 'information_schema'", 'Schema inventory unavailable')
        tables = optional("SELECT /* lake:tables */ table_catalog, table_schema, table_name, table_type FROM system.information_schema.tables WHERE table_catalog <> 'system' AND table_schema <> 'information_schema'", 'Table inventory unavailable')
        jobs = reader.query('''SELECT /* lake:jobs */ account_id, workspace_id, job_id, name,
            unix_millis(change_time) AS change_ms FROM system.lakeflow.jobs WHERE change_time <= :end''', [p for p in params if p['name'] == 'end'])
    finally:
        reader.close()
    account_ids = {str(r['account_id']) for r in runs + lineage if r.get('account_id')}
    if len(account_ids) > 1:
        raise ImportFailure('System-table results span multiple accounts; capture was not saved.')
    account = next(iter(account_ids), next((str(w['account_id']) for w in ws_rows), 'system-replay'))
    meta = str(meta_rows[0]['metastore_id']) if len(meta_rows) == 1 else f'unresolved:{settings["id"]}'
    registry = {str(w['workspace_id']): w for w in ws_rows if str(w['account_id']) == account}
    active_ws = {str(r['workspace_id']) for r in runs + lineage}
    objects, structure = {}, {}
    def add_table(metastore, catalog, schema, name, kind, workspaces, provenance):
        ident = f'{metastore}:{catalog}.{schema}.{name}'
        existing = objects.get(ident)
        objects[ident] = LakeObject(id=ident, metastore_id=metastore, catalog=catalog, schema_name=schema,
            name=name, type='view' if 'VIEW' in (kind or '') else 'table', position=(0, 0, 0),
            workspace_ids=sorted(set(workspaces + (existing['workspace_ids'] if existing else []))),
            observed_at=end, source_id=f'{provenance}:{ident}', provenance=provenance).model_dump()
        for sn in (None, schema):
            structure[(metastore, catalog, sn)] = dict(metastore_id=metastore, catalog=catalog, schema_name=sn)
        return ident
    for c in catalogs:
        structure[(meta, c['catalog_name'], None)] = dict(metastore_id=meta, catalog=c['catalog_name'], schema_name=None)
    for s in schemas:
        structure[(meta, s['catalog_name'], s['schema_name'])] = dict(metastore_id=meta, catalog=s['catalog_name'], schema_name=s['schema_name'])
    integration_ws = [ws for ws, row in registry.items() if workspace_host(row.get('workspace_url')) == settings['host']]
    for t in tables:
        add_table(meta, t['table_catalog'], t['table_schema'], t['table_name'], t['table_type'], integration_ws, 'system.information_schema.tables')
    grouped, children, parent_for_task = defaultdict(list), defaultdict(list), {}
    for row in runs:
        grouped[(str(row['workspace_id']), str(row['job_id']), str(row['run_id']))].append(row)
    task_groups = defaultdict(list)
    for row in tasks:
        key = (str(row['workspace_id']), str(row['job_id']), str(row['job_run_id']))
        parent_for_task[(key[0], key[1], str(row['run_id']))] = key
        task_groups[(*key, str(row['run_id']))].append(row)
    for key, rows in task_groups.items():
        for batch in segments(rows, end):
            children[key[:3]].append(dict(task_key=batch[0]['task_key'], task_run_id=key[3],
                started_at=min(integer(r['start_ms']) for r in batch),
                ended_at=integer(batch[-1]['end_ms']) if batch[-1].get('result_state') and integer(batch[-1]['end_ms']) <= end else None,
                raw_state=batch[-1].get('result_state') or 'UNKNOWN'))
    routes = defaultdict(list)
    for row in lineage:
        ws = str(row['workspace_id'])
        for side in ('source', 'target'):
            parts = [row.get(f'{side}_table_{key}') for key in ('catalog', 'schema', 'name')]
            if all(parts):
                row[f'{side}_id'] = add_table(str(row['metastore_id']), *parts, row.get(f'{side}_type'), [ws], 'system.access.table_lineage')
        job = row.get('lineage_job_id') or (row.get('entity_id') if row.get('entity_type') == 'JOB' else None)
        run = row.get('lineage_job_run_id') or (row.get('entity_run_id') if row.get('entity_type') == 'JOB' else None)
        key = (ws, str(job), str(run))
        if key not in grouped:
            key = parent_for_task.get(key, key)
        if key in grouped:
            routes[key].append(row)
    records = []
    for key, rows in sorted(grouped.items()):
        ws, job, run = key
        for ordinal, batch in enumerate(segments(rows, end)):
            launched = min(integer(r['start_ms']) for r in batch)
            observed = min(end, max(integer(r['end_ms']) for r in batch))
            result = batch[-1].get('result_state') if integer(batch[-1]['end_ms']) <= end else None
            finished = observed if result else None
            if finished is not None and finished < start:
                continue
            evidence = [r for r in routes[key] if launched <= integer(r['event_ms']) <= (finished or end)]
            sources = sorted({r['source_id'] for r in evidence if r.get('source_id')})
            targets = sorted({r['target_id'] for r in evidence if r.get('target_id')})
            external = {external_name(r['source_path']) for r in evidence if not r.get('source_id') and r.get('source_type') == 'PATH' and r.get('source_path') and r.get('target_id')}
            airport = next(iter(external)) if len(external) == 1 else None
            kind = 'plane' if airport and targets and not sources else 'ship' if len(sources) == 1 and targets and not external else 'buoy'
            definitions = [j for j in jobs if str(j['account_id']) == account and str(j['workspace_id']) == ws and str(j['job_id']) == job and integer(j['change_ms']) <= launched]
            definition = max(definitions, key=lambda j: integer(j['change_ms']), default={})
            signature = hashlib.sha256(json.dumps([account, ws, job, definition.get('change_ms')]).encode()).hexdigest()
            host = workspace_host(registry.get(ws, {}).get('workspace_url'))
            route = Route(version=f'{capture_id}:lineage', evidence='historical' if evidence else 'unknown',
                source_ids=sources, target_ids=targets, external_source=airport,
                source_record_ids=sorted({str(r['record_id']) for r in evidence}),
                observed_at=max((integer(r['event_ms']) for r in evidence), default=end), provenance='system.access.table_lineage').model_dump()
            records.append(dict(id=json.dumps([account, ws, job, run, ordinal], separators=(',', ':')),
                account_id=account, workspace_id=ws, job_id=job, run_id=run, task_run_id=run,
                task_key='job-run', attempt_number=ordinal, name=definition.get('name') or batch[0].get('run_name') or f'Job {job}',
                scope='job_run', run_tasks=[t for t in children[key] if launched <= t['started_at'] <= (finished or end)],
                kind=kind, phase=phase_for({'result_state': result, 'life_cycle_state': 'RUNNING' if not result else 'TERMINATED'}),
                raw_state=result or 'LAST_REPORTED_RUNNING', started_at=launched, ended_at=finished, observed_at=observed,
                source_id=f'system.lakeflow.job_run_timeline:{ws}:{run}:{ordinal}', provenance='system_tables_history',
                collection_stale_at=observed if not result and observed < end else None,
                route=route, native_url=f'{host}/jobs/{quote(job, safe="")}/runs/{quote(run, safe="")}?o={quote(ws, safe="")}' if host else None,
                replay_duration_ms=finished - launched if finished and finished > launched else None,
                signature=signature, queued_at=launched))
    workspaces = []
    for ws in sorted(set(registry) | active_ws):
        row = registry.get(ws, {})
        covered = ws in {str(r['workspace_id']) for r in runs}
        lineage_at = max((integer(r['event_ms']) for r in lineage if str(r['workspace_id']) == ws), default=None)
        workspaces.append(Workspace(account_id=account, id=ws, name=row.get('workspace_name') or f'Workspace {ws}',
            host=workspace_host(row.get('workspace_url')), region=row.get('region') or settings.get('region', 'unspecified'),
            cloud=row.get('cloud') or 'unknown', metastore_id=next((str(r['metastore_id']) for r in lineage if str(r['workspace_id']) == ws), meta),
            status='connected' if covered else 'excluded', last_successful_poll=end if covered else None,
            lineage_observed_at=lineage_at, capabilities=['regional_system_tables', 'historical_lineage'],
            reason='Regional system-table replay.' if covered else 'No job history observed in this regional 24-hour capture; this does not establish missing access or an idle workspace.').model_dump())
    return finish_capture(records, list(objects.values()), list(structure.values()), workspaces, warnings,
        start, end, capture_id, account, 'system_table_run_periods',
        'Fixed regional replay from system.lakeflow job/task timelines and system.access.table_lineage. '
        'Hourly slices are joined; repaired runs remain separate. Vessels represent job runs, with task details in the inspector. '
        'Lineage is limited to observed records in this 24-hour window. Inventory is privilege-filtered and capture-time metadata.')
