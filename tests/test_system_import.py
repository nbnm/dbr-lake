import json
import re
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.connections import ConnectionInput
from backend.estimates import DAY_MS
from backend.replay_import import ImportFailure, phase_for, scene_at
from backend.system_import import SystemTablesReader, build_system_capture, external_name, timeline_query

END = 2_000_000_000_000
START = END - DAY_MS
SECRET = 'test-secret-never-persist'
SETTINGS = dict(id='integration', name='Integration', host='https://east.cloud.databricks.com',
                region='east', warehouse_id='warehouse-1', import_source='system_tables')


def result(rows, columns=('value',), count=None, next_index=None):
    return dict(statement_id='statement-1', status={'state': 'SUCCEEDED'},
        manifest={'total_row_count': len(rows) if count is None else count,
                  'schema': {'columns': [{'name': n} for n in columns]}},
        result={'data_array': rows, **({'next_chunk_index': next_index} if next_index else {})})


def test_statement_execution_polls_and_follows_numeric_chunks_on_same_host(monkeypatch):
    calls = []
    def respond(request):
        calls.append((request.method, request.url.path))
        assert request.url.host == 'east.cloud.databricks.com'
        assert request.headers['authorization'] == f'Bearer {SECRET}'
        if request.method == 'POST':
            body = json.loads(request.content)
            assert body['warehouse_id'] == 'warehouse-1'
            assert body['disposition'] == 'INLINE' and body['format'] == 'JSON_ARRAY'
            assert body['parameters'] == [{'name': 'end', 'type': 'TIMESTAMP', 'value': '2026-10-09T00:00:00Z'}]
            return httpx.Response(200, json={'statement_id': 'statement-1', 'status': {'state': 'RUNNING'}})
        if request.url.path.endswith('/chunks/1'):
            return httpx.Response(200, json={'data_array': [['second']]})
        data = result([['first']], count=2, next_index=1)
        data['result']['next_chunk_internal_link'] = 'https://untrusted.example/secret'
        return httpx.Response(200, json=data)
    monkeypatch.setattr('backend.system_import.time.sleep', lambda _: None)
    reader = SystemTablesReader(SETTINGS, SECRET, transport=httpx.MockTransport(respond))
    assert reader.query('SELECT :end AS value', [{'name': 'end', 'type': 'TIMESTAMP', 'value': '2026-10-09T00:00:00Z'}]) == [{'value': 'first'}, {'value': 'second'}]
    reader.close()
    assert calls == [('POST', '/api/2.0/sql/statements'), ('GET', '/api/2.0/sql/statements/statement-1'), ('GET', '/api/2.0/sql/statements/statement-1/result/chunks/1')]


@pytest.mark.parametrize('fault', ['truncated', 'missing', 'schema', 'remote-error', 'redirect', 'manifest', 'shape'])
def test_incomplete_or_failed_sql_results_fail_without_leaking_remote_body(fault):
    def respond(request):
        data = result([['row']])
        if fault == 'redirect': return httpx.Response(302, text=SECRET, headers={'location': 'https://untrusted.example/'})
        if fault == 'truncated': data['manifest']['truncated'] = True
        if fault == 'missing': data['manifest']['total_row_count'] = 2
        if fault == 'schema': data['result']['data_array'] = [['one', 'two']]
        if fault == 'remote-error': data['status'] = {'state': 'FAILED', 'error': {'message': SECRET}}
        if fault == 'manifest': data.pop('manifest')
        if fault == 'shape': data['status'] = None
        return httpx.Response(200, json=data)
    reader = SystemTablesReader(SETTINGS, SECRET, transport=httpx.MockTransport(respond))
    with pytest.raises(ImportFailure) as error: reader.query('SELECT 1')
    assert SECRET not in str(error.value)
    reader.close()


def test_repeated_chunks_and_query_timeout_do_not_save_partial_results(monkeypatch):
    def respond(request):
        if request.url.path.endswith('/chunks/1'):
            return httpx.Response(200, json={'data_array': [['row']], 'next_chunk_index': 1})
        return httpx.Response(200, json=result([['row']], count=3, next_index=1))
    reader = SystemTablesReader(SETTINGS, SECRET, transport=httpx.MockTransport(respond))
    with pytest.raises(ImportFailure, match='pagination'): reader.query('SELECT 1')
    reader.close()
    times = iter([0, 121])
    monkeypatch.setattr('backend.system_import.time.monotonic', lambda: next(times))
    calls = []
    def pending(request):
        calls.append(request.url.path)
        return httpx.Response(200, json={'statement_id': 'statement-1', 'status': {'state': 'PENDING'}})
    reader = SystemTablesReader(SETTINGS, SECRET, transport=httpx.MockTransport(pending))
    with pytest.raises(ImportFailure, match='timed out'): reader.query('SELECT 1')
    reader.close()
    assert calls[-1] == '/api/2.0/sql/statements/statement-1/cancel'


def test_warehouse_selection_uses_running_warehouse_without_starting_it():
    requests = []
    def respond(request):
        requests.append(request.method)
        if request.method == 'GET':
            return httpx.Response(200, json={'warehouses': [{'id': 'stopped', 'state': 'STOPPED'}, {'id': 'active', 'state': 'RUNNING'}]})
        assert json.loads(request.content)['warehouse_id'] == 'active'
        return httpx.Response(200, json=result([]))
    reader = SystemTablesReader({**SETTINGS, 'warehouse_id': None}, SECRET, transport=httpx.MockTransport(respond))
    assert reader.query('SELECT 1') == []
    reader.close()
    assert requests == ['GET', 'POST']


def row(run, launched, ended, state=None, ws='1', job='10', **extra):
    return dict(account_id='account', workspace_id=ws, job_id=job, run_id=run,
                start_ms=str(launched), end_ms=str(ended), result_state=state, run_name='Import', **extra)


def lineage(run, at, target='orders', source=None, path=None, ws='1', job='10', task_fallback=False, metastore='meta'):
    return dict(account_id='account', workspace_id=ws, metastore_id=metastore, record_id=f'{ws}:{run}:{target}:{at}',
        event_ms=str(at), lineage_job_id=None if task_fallback else job, lineage_job_run_id=None if task_fallback else run,
        entity_type='JOB', entity_id=job, entity_run_id=run,
        source_type='TABLE' if source else 'PATH' if path else None, source_path=path,
        source_table_catalog='sales' if source else None, source_table_schema='raw' if source else None, source_table_name=source,
        target_type='TABLE', target_table_catalog='sales', target_table_schema='raw', target_table_name=target)


def fixture_reader(data, unavailable=()):
    class Reader:
        closed = False
        statements = []
        def __init__(self, settings, token): assert settings == SETTINGS and token == SECRET
        def query(self, statement, parameters=None):
            key = re.search(r'lake:(\w+)', statement)[1]
            self.statements.append((key, statement, parameters))
            if key in unavailable: raise ImportFailure('Permission denied.')
            return [dict(r) for r in data.get(key, [])]
        def close(self): Reader.closed = True
    return Reader


def data_fixture():
    launch = START + 600_000
    return dict(
        runs=[row('100', launch, launch + 180_000, 'SUCCEEDED'),
              row('100', launch, launch + 240_000, 'FAILED', ws='2')],
        tasks=[row('1001', launch + 1000, launch + 179_000, 'SUCCEEDED', job_run_id='100', task_key='ingest')],
        lineage=[lineage('100', launch + 60_000, path='s3://bucket/path?secret=hidden'),
                 lineage('1001', launch + 70_000, target='events', path='s3://bucket/other', task_fallback=True),
                 lineage('100', launch + 80_000, source='input', ws='2')],
        workspaces=[dict(account_id='account', workspace_id='1', workspace_name='East', workspace_url=SETTINGS['host'], region='east', cloud='aws'),
                    dict(account_id='account', workspace_id='2', workspace_name='West', workspace_url='https://west.cloud.databricks.com', region='east', cloud='aws'),
                    dict(account_id='account', workspace_id='3', workspace_name='Other region', workspace_url='https://other.cloud.databricks.com', region='west', cloud='aws')],
        metastores=[{'metastore_id': 'meta'}], catalogs=[{'catalog_name': 'empty'}],
        schemas=[{'catalog_name': 'empty', 'schema_name': 'unused'}],
        tables=[dict(table_catalog='sales', table_schema='raw', table_name='orders', table_type='MANAGED')],
        jobs=[dict(account_id='account', workspace_id=ws, job_id='10', name='Earlier definition', change_ms=str(START-1000)) for ws in ['1', '2']]
             + [dict(account_id='account', workspace_id='1', job_id='10', name='Later definition', change_ms=str(launch+1000))])


def test_single_connection_joins_parent_lineage_keeps_workspace_ids_and_native_links():
    data = data_fixture()
    reader = fixture_reader(data)
    capture = build_system_capture(SETTINGS, SECRET, END, reader)
    assert reader.closed
    attempts = scene_at(capture, END)['attempts']
    east = next(a for a in attempts if a['workspace_id'] == '1')
    west = next(a for a in attempts if a['workspace_id'] == '2')
    assert east['id'] != west['id'] and east['scope'] == 'job_run'
    assert east['name'] == 'Earlier definition'
    assert east['kind'] == 'plane' and len(east['route']['target_ids']) == 2
    assert east['route']['external_source'] == 's3://bucket'
    assert east['native_url'] == f'{SETTINGS["host"]}/jobs/10/runs/100?o=1'
    assert west['native_url'] == 'https://west.cloud.databricks.com/jobs/10/runs/100?o=2'
    assert west['kind'] == 'ship' and west['phase'] == 'failed'
    assert east['phase'] == 'succeeded' and east['replay_duration_ms'] == 180_000
    assert east['run_tasks'][0]['task_run_id'] == '1001'
    halfway = next(a for a in scene_at(capture, START + 690_000)['attempts'] if a['workspace_id'] == '1')
    assert halfway['phase'] == 'running' and halfway['ended_at'] is None and halfway['raw_state'] == 'REPLAY_RUNNING'
    assert halfway['estimate']['predicted_duration_ms'] is None
    assert any(i['catalog'] == 'empty' and i['schema_name'] == 'unused' for i in capture['checkpoint']['inventory'])
    assert next(w for w in capture['checkpoint']['workspaces'] if w['id'] == '3')['status'] == 'excluded'
    assert 'secret=hidden' not in json.dumps(capture)


@pytest.mark.parametrize('extra_destination, mixed_table_target', [(False, False), (True, False), (False, True)])
def test_export_lineage_uses_outbound_path_without_inventing_ambiguous_flights(extra_destination, mixed_table_target):
    data = data_fixture()
    launch = START + 600_000
    route = lineage('100', launch + 60_000, source='input', target=None)
    route.update(target_type='PATH', target_path='https://user:password@exports.example/batches?token=secret#private')
    data['lineage'] = [route]
    if extra_destination:
        data['lineage'].append({**route, 'record_id': 'other-export', 'target_path': 's3://other-bucket/export'})
    if mixed_table_target:
        data['lineage'].append(lineage('100', launch + 70_000, source='input'))
    reader = fixture_reader(data)
    capture = build_system_capture(SETTINGS, SECRET, END, reader)
    attempt = next(a for a in scene_at(capture, END)['attempts'] if a['workspace_id'] == '1')
    assert any('target_path' in sql for key, sql, _ in reader.statements if key == 'lineage')
    assert attempt['route']['external_source'] is None
    if extra_destination or mixed_table_target:
        assert attempt['kind'] == 'buoy' and attempt['route']['external_target'] is None
    else:
        assert attempt['kind'] == 'plane'
        assert attempt['route']['external_target'] == 'https://exports.example'
        assert attempt['route']['source_ids'] == ['meta:sales.raw.input']
        assert not attempt['route']['target_ids']
        assert attempt['native_url'] == f'{SETTINGS["host"]}/jobs/10/runs/100?o=1'
    assert all(secret not in json.dumps(capture) for secret in ('password', 'token=secret', '#private'))


def test_workspace_directory_resolves_native_links_with_actual_directory_schema():
    data = data_fixture()
    columns = {'account_id', 'workspace_id', 'workspace_name', 'workspace_url', 'create_time', 'status'}
    data['workspaces'] = [{k: v for k, v in row.items() if k in columns} for row in data['workspaces']]
    class Reader(fixture_reader(data)):
        def query(self, statement, parameters=None):
            if 'lake:workspaces' in statement:
                selected = re.search(r'\*/\s*(.*?)\s+FROM', statement).group(1).split(',')
                if any(column.strip() not in columns for column in selected):
                    raise ImportFailure('Unresolved workspace directory column.')
            return super().query(statement, parameters)
    capture = build_system_capture(SETTINGS, SECRET, END, Reader)
    attempts = scene_at(capture, END)['attempts']
    assert next(a for a in attempts if a['workspace_id'] == '2')['native_url'] == 'https://west.cloud.databricks.com/jobs/10/runs/100?o=2'
    assert not any('Workspace directory unavailable' in warning for warning in capture['checkpoint']['warnings'])


def test_hourly_slices_and_repair_segments_keep_real_start_times_and_staleness():
    data = data_fixture()
    data['runs'] = [row('long', START-3_600_000, START), row('long', START, START+3_600_000, 'SUCCEEDED'),
                    row('repair', START+1000, START+2000, 'FAILED'), row('repair', START+3000, START+4000, 'SUCCEEDED'),
                    row('active', START+1000, END-3_600_000)]
    data['tasks'], data['lineage'] = [], []
    capture = build_system_capture(SETTINGS, SECRET, END, fixture_reader(data))
    long_at_start = next(a for a in capture['checkpoint']['attempts'] if a['run_id'] == 'long')
    assert long_at_start['started_at'] == START-3_600_000 and long_at_start['phase'] == 'running'
    final = scene_at(capture, END)['attempts']
    repairs = [a for a in final if a['run_id'] == 'repair']
    assert len(repairs) == 2 and {a['attempt_number'] for a in repairs} == {0, 1}
    assert {a['phase'] for a in repairs} == {'failed', 'succeeded'}
    active = next(a for a in final if a['run_id'] == 'active')
    assert active['collection_stale_at'] == END-3_600_000 and active['replay_duration_ms'] is None
    assert next(a for a in scene_at(capture, END-7_200_000)['attempts'] if a['run_id'] == 'active')['collection_stale_at'] is None
    assert 't.job_run_id=s.run_id' in timeline_query(True)
    assert 't.period_start_time <= :end' in timeline_query()
    assert 't.period_start_time >= :start' not in timeline_query()


def test_unresolved_lineage_and_missing_directory_never_invent_a_transport_or_host():
    data = data_fixture()
    data['lineage'] = [lineage('100', START+650_000, path=None)]
    capture = build_system_capture(SETTINGS, SECRET, END, fixture_reader(data, unavailable=('workspaces', 'catalogs', 'schemas', 'tables')))
    assert all(a['kind'] == 'buoy' and a['native_url'] is None for a in scene_at(capture, END)['attempts'])
    assert any('Workspace directory unavailable' in w for w in capture['checkpoint']['warnings'])
    assert len(capture['checkpoint']['objects']) == 1
    assert external_name('abfss://container@storage.dfs.core.windows.net/data?sas=secret') == 'abfss://container@storage.dfs.core.windows.net'
    assert external_name('abfss://user:secret@storage.example/data') == 'abfss://storage.example'
    assert phase_for({'result_state': 'TIMED_OUT'}) == 'failed'


def test_import_selects_only_one_saved_integration_and_preserves_capture_on_failure(tmp_path, monkeypatch):
    captured = []
    def build(credentials):
        captured.append(credentials)
        return build_system_capture(SETTINGS, SECRET, END, fixture_reader(data_fixture()))
    monkeypatch.setattr('backend.app.build_capture', build)
    with TestClient(create_app(str(tmp_path/'demo.sqlite')), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        selected = client.post('/api/configuration', json={**SETTINGS, 'token': SECRET}).json()
        client.post('/api/configuration', json={'name': 'Unselected', 'host': 'https://other.cloud.databricks.com'})
        assert selected['import_source'] == 'system_tables' and SECRET not in json.dumps(selected)
        assert client.post('/api/replay/import').status_code == 400
        saved = client.post('/api/replay/import?connection_id=integration')
        assert saved.status_code == 200
        assert len(captured[0]) == 1 and captured[0][0][0]['id'] == 'integration'
        def fail(_): raise ImportFailure('System table unavailable.')
        monkeypatch.setattr('backend.app.build_capture', fail)
        assert client.post('/api/replay/import?connection_id=integration').status_code == 400
        assert client.get('/api/replay').json()['checkpoint']['capture_id'] == saved.json()['checkpoint']['capture_id']
        assert client.post('/api/replay/import?connection_id=missing').status_code == 400
