import json
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.connections import ConnectionInput, ReplayRepository
from backend.replay_import import DatabricksReader, ImportFailure, build_capture, scene_at
from backend.estimates import DAY_MS

END = 2_000_000_000_000
START = END - DAY_MS
SETTINGS = {'import_source': 'jobs_api', 'id': 'workspace', 'name': 'Production', 'host': 'https://test.cloud.databricks.com',
            'region': 'test-region', 'routes': [{'job_id': '1', 'task_key': 'ingest', 'source_tables': [],
                'target_tables': ['sales.raw.orders', 'sales.raw.customers'], 'external_source': 'Event Hubs'}]}
SECRET = 'mock-token-never-a-real-credential'


def handler(request):
    assert request.headers['authorization'] == f'Bearer {SECRET}'
    assert request.method == 'GET'
    path, query = request.url.path, request.url.params
    if path.endswith('metastore_summary'):
        data = {'metastore_id': 'meta'}
    elif path.endswith('/catalogs'):
        data = {'catalogs': [{'name': 'sales'}]}
    elif path.endswith('/schemas'):
        data = {'schemas': [{'name': 'raw'}]}
    elif path.endswith('/tables'):
        # Empty pages with a continuation token must not terminate discovery.
        data = {'tables': [], 'next_page_token': 'tables-next'} if not query.get('page_token') else {'tables': [{'name': 'orders'}, {'name': 'customers'}]}
    elif path.endswith('/runs/list'):
        if query.get('limit') == '1': data = {'runs': []}
        elif not query.get('page_token'): data = {'runs': [{'run_id': 10, 'start_time': START - 10000, 'end_time': START + 20000}], 'next_page_token': 'runs-next'}
        else: data = {'runs': [{'run_id': 11, 'start_time': END - 10000, 'end_time': 0}, {'run_id': 99, 'start_time': START - 50000, 'end_time': START - 10000}]}
    elif path.endswith('/runs/get'):
        run = int(query['run_id'])
        started = START - 10000 if run == 10 else END - 10000
        ended = START + 20000 if run == 10 else 0
        tasks = [{'task_key': 'ingest', 'run_id': run * 100, 'start_time': started, 'end_time': ended,
                  'state': {'life_cycle_state': 'TERMINATED', 'result_state': 'SUCCESS'} if ended else {'life_cycle_state': 'RUNNING'}}]
        data = {'job_id': 1, 'run_id': run, 'run_name': 'Commerce', 'start_time': started, 'end_time': ended,
                'run_page_url': f'https://test.cloud.databricks.com/jobs/1/runs/{run}', 'tasks': tasks}
        if run == 11 and not query.get('page_token'):
            data['next_page_token'] = 'task-next'
        elif run == 11:
            data['tasks'] = [{'task_key': 'other', 'run_id': 1101, 'start_time': started, 'end_time': ended, 'state': {'life_cycle_state': 'RUNNING'}}]
    else:
        raise AssertionError(path)
    return httpx.Response(200, json=data)


def factory(settings, token):
    return DatabricksReader(settings, token, transport=httpx.MockTransport(handler))


def test_fixed_day_capture_overlap_pagination_routes_and_native_links():
    capture = build_capture([(SETTINGS, SECRET)], END, factory)
    assert capture['available_duration_ms'] == DAY_MS
    assert capture['checkpoint']['range'] == {'start': START, 'end': END}
    assert len(capture['checkpoint']['objects']) == 2
    before = scene_at(capture, START)
    assert len(before['attempts']) == 1  # A run begun before the window is retained.
    assert before['attempts'][0]['phase'] == 'running'
    after = scene_at(capture, END)
    assert len(after['attempts']) == 3  # Task pagination was followed.
    landed = next(a for a in after['attempts'] if a['run_id'] == '10')
    assert landed['phase'] == 'succeeded' and landed['kind'] == 'plane'
    assert len(landed['route']['target_ids']) == 2
    assert landed['native_url'] == 'https://test.cloud.databricks.com/jobs/1/runs/10'
    unknown = next(a for a in after['attempts'] if a['task_key'] == 'other')
    assert unknown['kind'] == 'buoy' and unknown['route']['evidence'] == 'unknown'
    assert unknown['estimate']['predicted_duration_ms'] is None
    assert scene_at(capture, START) == before
    assert SECRET not in json.dumps(capture)


def test_tokens_are_memory_only_and_host_changes_require_new_credentials(tmp_path):
    path = tmp_path / 'settings.sqlite'
    repo = ReplayRepository(str(path))
    c = repo.save(ConnectionInput(name='Workspace', host=SETTINGS['host'], token=SECRET))
    assert c['token_configured'] and 'token' not in c
    assert SECRET not in path.read_bytes().decode(errors='ignore')
    assert repo.credential(c['id'])[1] == SECRET
    repo.save(ConnectionInput(id=c['id'], name='Changed', host='https://other.cloud.databricks.com'))
    with pytest.raises(ValueError, match='token'): repo.credential(c['id'])
    repo.save(ConnectionInput(id=c['id'], name='Workspace', host=SETTINGS['host'], token=SECRET))
    repo.close()
    restored = ReplayRepository(str(path))
    assert restored.list()[0]['token_configured'] is False
    restored.close()


def test_local_settings_api_never_echoes_invalid_secret_and_blocks_foreign_origins(tmp_path):
    app = create_app(str(tmp_path / 'demo.sqlite'))
    with TestClient(app, base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        body = {'name': 'Test', 'host': 'http://localhost', 'token': SECRET}
        response = client.post('/api/configuration', json=body)
        assert response.status_code == 422 and SECRET not in response.text
        body['host'] = SETTINGS['host']
        response = client.post('/api/configuration', json=body, headers={'origin': 'https://untrusted.example'})
        assert response.status_code == 403 and not client.get('/api/configuration').json()['connections']
        response = client.post('/api/configuration', json=body)
        assert response.status_code == 200 and 'token' not in response.json()
        assert SECRET not in client.get('/api/configuration').text
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/api/configuration').json()['realtime_enabled'] is False
    with TestClient(app, base_url='http://localhost', client=('192.0.2.1', 1)) as client:
        assert client.get('/api/replay').status_code == 403


def test_import_activates_persisted_capture_and_replay_never_calls_the_workspace(tmp_path, monkeypatch):
    calls = []
    def tracked(settings, token):
        calls.append(settings['id'])
        return factory(settings, token)
    monkeypatch.setattr('backend.app.build_capture', lambda credentials: build_capture(credentials, END, tracked))
    path = str(tmp_path / 'demo.sqlite')
    with TestClient(create_app(path), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        client.post('/api/configuration', json={**SETTINGS, 'token': SECRET})
        response = client.post('/api/replay/import')
        assert response.status_code == 200
        saved = response.json()
        assert client.get('/api/replay').json() == saved
        assert client.get('/api/scene', params={'at': START}).json() == scene_at(saved, START)
        assert client.get('/api/scene', params={'at': END}).json() == scene_at(saved, END)
        assert client.get('/api/scene', params={'at': START - 1}).status_code == 422
        assert client.get('/api/events').status_code == 409
        assert calls == ['workspace']
        old_id = saved['checkpoint']['capture_id']
        def failed(credentials): raise ImportFailure('Import failed safely.')
        monkeypatch.setattr('backend.app.build_capture', failed)
        assert client.post('/api/replay/import').status_code == 400
        assert client.get('/api/replay').json()['checkpoint']['capture_id'] == old_id
    with TestClient(create_app(path), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        assert client.get('/api/replay', params={'capture': old_id}).json() == saved
        assert client.get('/api/configuration').json()['connections'][0]['token_configured'] is False


def test_api_error_body_and_redirects_cannot_leak_token():
    def denied(request): return httpx.Response(302, headers={'location': 'https://untrusted.example/'}, text=SECRET)
    reader = DatabricksReader(SETTINGS, SECRET, transport=httpx.MockTransport(denied))
    with pytest.raises(ImportFailure) as error: reader.test()
    assert SECRET not in str(error.value)
    reader.close()


def test_capture_without_routes_never_invents_planes():
    capture = build_capture([({**SETTINGS, 'routes': []}, SECRET)], END, factory)
    assert all(a['kind'] == 'buoy' for a in scene_at(capture, END)['attempts'])


def test_historical_estimates_use_only_prior_successes_and_stay_frozen():
    class Reader:
        def __init__(self, settings, token): pass
        def test(self): pass
        def inventory(self, at): return 'meta', [], [], []
        def close(self): pass
        def runs(self, start, end):
            for i in range(7):
                launched = START + 1000 + i * 10000
                task = {'task_key': 'task', 'run_id': 100 + i, 'start_time': launched, 'end_time': launched + 4000,
                        'state': {'life_cycle_state': 'TERMINATED', 'result_state': 'SUCCESS'}}
                yield {'job_id': 1, 'run_id': i + 1, 'start_time': launched}, [task]
    capture = build_capture([({**SETTINGS, 'routes': []}, SECRET)], END, Reader)
    attempts = scene_at(capture, END)['attempts']
    earliest = next(a for a in attempts if a['run_id'] == '1')
    assert earliest['estimate']['predicted_duration_ms'] is None
    sixth = next(a for a in attempts if a['run_id'] == '6')
    assert sixth['estimate']['sample_count'] == 5 and sixth['estimate']['predicted_duration_ms'] == 4000
    at_launch = next(a for a in scene_at(capture, START + 51000)['attempts'] if a['run_id'] == '6')
    assert at_launch['phase'] == 'running'
    assert at_launch['estimate'] == sixth['estimate']
