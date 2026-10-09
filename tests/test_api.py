import pytest
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from backend.app import create_app, snapshot
from backend.fixtures import BASE, END, REFERENCE, CAPTURE_ID, events
from backend.store import EventStore
from backend.models import SceneEvent


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(str(tmp_path / 'demo.sqlite')), base_url='http://localhost', client=('127.0.0.1', 50000)) as client:
        yield client


def test_shared_metastore_objects_and_inventory(client):
    scene = client.get('/api/scene').json()
    assert scene['mode'] == 'demo'
    ids = [o['id'] for o in scene['objects']]
    assert len(ids) == len(set(ids)) == 18
    assert all(len(o['workspace_ids']) == 2 for o in scene['objects'])
    registry = {w['id']: w for w in scene['workspaces']}
    for o in scene['objects']:
        assert len({registry[ws]['region'] for ws in o['workspace_ids']}) == 1
        assert all(registry[ws]['metastore_id'] == o['metastore_id'] for ws in o['workspace_ids'])
    assert {w['status'] for w in scene['workspaces']} == {'connected', 'stale', 'restricted', 'excluded'}
    assert len({w['region'] for w in scene['workspaces']}) == 3


def test_overdue_never_implies_success(client):
    a = client.get('/api/attempts/refine-orders').json()
    assert REFERENCE - a['started_at'] > a['estimate']['predicted_duration_ms']
    assert a['phase'] == 'running'
    assert a['ended_at'] is None
    confirmed = client.get('/api/attempts/refine-orders', params={'at': BASE + 920_000}).json()
    assert confirmed['phase'] == 'succeeded'


def test_early_failure_and_retry_keep_separate_attempts(client):
    scene = client.get('/api/scene').json()
    attempts = {a['id']: a for a in scene['attempts']}
    failed, retry = attempts['payments'], attempts['payments-retry']
    assert failed['phase'] == 'failed' and retry['phase'] == 'running'
    assert failed['run_id'] == retry['run_id']
    assert failed['task_run_id'] != retry['task_run_id']
    assert failed['attempt_number'] != retry['attempt_number']


def test_unknown_route_and_multi_input_are_truthful(client):
    unknown = client.get('/api/attempts/unknown').json()
    assert unknown['kind'] == 'buoy'
    assert unknown['route']['evidence'] == 'unknown'
    assert unknown['route']['source_ids'] == unknown['route']['target_ids'] == []
    assert unknown['estimate']['predicted_duration_ms'] is None
    multi = client.get('/api/attempts/daily-sales').json()
    assert multi['kind'] == 'buoy' and len(multi['route']['source_ids']) == 2


def test_multi_destination_ingestion_is_one_attempt_with_frozen_evidence(client):
    states = [client.get('/api/attempts/ingest-orders', params={'at': BASE + t}).json()
              for t in (400_000, 600_000, 700_000)]
    assert [a['phase'] for a in states] == ['queued', 'running', 'succeeded']
    assert all(a['route'] == states[0]['route'] for a in states)
    assert all(a['estimate'] == states[0]['estimate'] for a in states)
    assert {a['task_run_id'] for a in states} == {'99000'}
    assert states[0]['route']['target_ids'] == [
        'demo-metastore:sales.raw.orders',
        'demo-metastore:operations.events.clickstream',
        'demo-metastore:finance.ledger.payments',
    ]
    scene = client.get('/api/scene').json()
    assert sum(a['id'] == 'ingest-orders' for a in scene['attempts']) == 1
    assert all(any(o['id'] == target and 'ws-east' in o['workspace_ids'] for o in scene['objects'])
               for target in states[0]['route']['target_ids'])


def test_short_run_is_retained_and_estimate_is_frozen(client):
    short = client.get('/api/attempts/short-run').json()
    assert short['ended_at'] - short['started_at'] < 15_000
    assert short['phase'] == 'succeeded'
    first = client.get('/api/attempts/refine-orders', params={'at': BASE + 211_000}).json()
    last = client.get('/api/attempts/refine-orders', params={'at': END}).json()
    assert first['estimate'] == last['estimate'] and first['route'] == last['route']


def test_stale_collection_is_separate_from_running_state(client):
    a = client.get('/api/attempts/forecast').json()
    assert a['phase'] == 'running'
    assert a['collection_stale_at'] == BASE + 560_000
    recovered = client.get('/api/attempts/forecast', params={'at': BASE + 900_000}).json()
    assert recovered['collection_stale_at'] is None
    scene = client.get('/api/scene').json()
    assert len(scene['gaps']) == 1


def test_replay_is_deterministic_and_does_not_show_future_terminal(client):
    response = client.get('/api/replay', params={'start': REFERENCE, 'end': END}).json()
    assert response == client.get('/api/replay', params={'start': REFERENCE, 'end': END}).json()
    assert response['checkpoint'] == client.get('/api/scene').json()
    assert all(e['event_time'] > REFERENCE for e in response['events'])
    assert next(a for a in response['checkpoint']['attempts'] if a['id'] == 'refine-orders')['phase'] == 'running'


def test_eighty_simulated_job_runs_cover_the_day_with_supported_data_flows(client):
    replay = client.get('/api/replay', params={'capture': CAPTURE_ID}).json()
    assert replay['mode'] == replay['checkpoint']['mode'] == 'demo'
    assert replay['checkpoint']['capture_id'] == CAPTURE_ID
    assert 'All job data is invented' in replay['checkpoint']['history_note']
    final = client.get('/api/scene', params={'capture': CAPTURE_ID, 'at': END}).json()
    attempts = final['attempts']
    assert len({(a['workspace_id'], a['job_id'], a['run_id']) for a in attempts}) == 80
    assert len(attempts) == 81  # A repair is not another parent run.
    assert {(a['started_at'] - BASE) // 3_600_000 for a in attempts} == set(range(24))
    assert all(BASE <= a['started_at'] < a['ended_at'] <= END for a in attempts)
    known = {o['id'] for o in final['objects']}
    incoming = [a for a in attempts if a['route']['external_source']]
    outgoing = [a for a in attempts if a['route']['external_target']]
    assert len(incoming) == 25 and len(outgoing) == 23
    assert any('API' in a['route']['external_source'] for a in incoming)
    assert all(a['kind'] == 'plane' and a['route']['target_ids'] and not a['route']['source_ids'] for a in incoming)
    assert all(a['kind'] == 'plane' and a['route']['source_ids'] and not a['route']['target_ids'] for a in outgoing)
    for a in attempts:
        assert set(a['route']['source_ids'] + a['route']['target_ids']) <= known
        if a['kind'] == 'ship':
            assert a['route']['source_ids'] and a['route']['target_ids']
    assert replay == client.get('/api/replay', params={'capture': CAPTURE_ID}).json()


def test_simulated_pipelines_land_transform_and_export_in_order(client):
    for hour in (1, 12, 23):
        scene = client.get('/api/scene', params={'capture': CAPTURE_ID, 'at': END}).json()
        pipeline = [a for a in scene['attempts'] if a['id'].endswith(f'-{hour:02}')]
        incoming = next(a for a in pipeline if a['route']['external_source'])
        transfer = next(a for a in pipeline if a['kind'] == 'ship')
        export = next(a for a in pipeline if a['route']['external_target'])
        assert incoming['ended_at'] < transfer['started_at'] < transfer['ended_at'] < export['started_at']
        assert transfer['route']['source_ids'][0] in incoming['route']['target_ids']
        assert export['route']['source_ids'] == transfer['route']['target_ids']
        midpoint = export['started_at'] + export['replay_duration_ms'] // 2
        running = client.get(f'/api/attempts/{export["id"]}', params={'capture': CAPTURE_ID, 'at': midpoint}).json()
        assert running['phase'] == 'running' and running['ended_at'] is None
        assert running['replay_duration_ms'] == export['ended_at'] - export['started_at']


def test_event_pagination_has_no_duplicates(client):
    cursor, seen = 0, []
    while True:
        page = client.get('/api/events', params={'cursor': cursor, 'limit': 17}).json()
        seen.extend(e['event_id'] for e in page['events'])
        cursor = page['cursor']
        if not page['has_more']:
            break
    full = client.get('/api/events').json()
    assert seen == [e['event_id'] for e in full['events']]
    assert len(seen) == len(set(seen))
    assert cursor == client.get('/api/scene').json()['cursor']


@pytest.mark.parametrize('url', ['/api/events?cursor=999999', '/api/events?cursor=-1',
    f'/api/replay?start={END}&end={BASE}', f'/api/scene?at={BASE-1}', '/api/attempts/missing'])
def test_invalid_requests_are_rejected(client, url):
    assert client.get(url).status_code in (404, 409, 422)


def test_restart_is_idempotent(tmp_path):
    path = str(tmp_path / 'events.sqlite')
    first = EventStore(path)
    first.append_many(events())
    before = snapshot(first, REFERENCE)
    first.close()
    restored = EventStore(path)
    restored.append_many(events())
    assert snapshot(restored, REFERENCE) == before
    assert len(restored.read(END)) == len(events())
    restored.close()


def test_late_old_observation_cannot_regress_state_or_hide_replay_events(client):
    before = client.get('/api/attempts/refine-orders').json()
    old = next(e for e in events() if e.execution_attempt_id == 'refine-orders')
    client.app.state.store.append_many([SceneEvent(**{**old.model_dump(), 'event_id': 'late-old-observation'})])
    assert client.get('/api/attempts/refine-orders').json() == before
    replay = client.get('/api/replay', params={'start': REFERENCE, 'end': END}).json()
    assert any(e['execution_attempt_id'] == 'refine-orders' and e['payload'].get('phase') == 'succeeded' for e in replay['events'])


def test_live_mode_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setenv('LAKE_MODE', 'live')
    with pytest.raises(RuntimeError, match='viewer authorization'):
        with TestClient(create_app(str(tmp_path / 'events.sqlite'))):
            pass


def test_concurrent_scene_and_replay_requests_share_store_safely(client):
    expected = client.get('/api/replay').json()
    urls = ['/api/replay', '/api/scene', '/api/events', '/api/coverage'] * 20
    with ThreadPoolExecutor(max_workers=12) as executor:
        responses = list(executor.map(client.get, urls))
    assert all(r.status_code == 200 for r in responses)
    assert all(r.json() == expected for r in responses[::4])
