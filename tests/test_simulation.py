from copy import deepcopy
import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.models import Attempt, Estimate, LakeObject, Route, SceneEvent, Workspace
from backend.replay_import import scene_at
from backend.simulation import build_simulation, captured_attempts, PROVENANCE, SIMULATED_RUNS

START = 1_790_000_000_000
END = START + 86_400_000


def real_capture():
    tables = [LakeObject(id=f'real-metastore:{catalog}.{schema}.{name}',
        metastore_id='real-metastore', catalog=catalog, schema_name=schema, name=name,
        workspace_ids=['real-workspace'], position=(0, 0, 0), source_id='inventory',
        observed_at=END, provenance='system.information_schema.tables').model_dump(mode='json')
        for catalog, schema, name in [
            ('sandbox', 'antares_raw', 'sales_mthly_add'),
            ('sandbox', 'antares_raw', 'sales_mthly_flow'),
            ('sandbox', 'antares_sigma', 'bv_sales_mthly_add'),
            ('platform', 'de_bronze', 'api_tracking_raw'),
            ('platform', 'de_bronze', 'delivery_performance_raw'),
            ('platform', 'de_silver', 'api_tracking_parsed'),
        ]]
    a = Attempt(id='real-run-1', account_id='real-account', workspace_id='real-workspace',
        job_id='123', run_id='456', task_run_id='456', task_key='job-run', scope='job_run',
        name='Sigma Demo 2-tables-deploy', kind='ship', phase='running', raw_state='RUNNING',
        started_at=START - 60_000, observed_at=END, source_id='system:123:456',
        native_url='https://real.cloud.databricks.com/jobs/123/runs/456',
        provenance='system_tables_history',
        route=Route(version='real-route', evidence='historical', source_ids=[tables[0]['id']],
            target_ids=[tables[2]['id']], source_record_ids=['real-lineage'], observed_at=END,
            provenance='system.access.table_lineage'),
        estimate=Estimate(predicted_duration_ms=None, sample_count=0, confidence='unknown', version='real'))
    checkpoint = dict(mode='replay', capture_id='real-capture', account_id='real-account', captured_at=END,
        server_time=START, cursor=0, range={'start': START, 'end': END}, objects=tables,
        inventory=[], attempts=[a.model_dump()], gaps=[], warnings=[], history_note='Actual captured history.',
        workspaces=[Workspace(account_id='real-account', id='real-workspace', name='wrk-int-sandbox',
            region='canadacentral', metastore_id='real-metastore', status='connected',
            last_successful_poll=END, lineage_observed_at=END).model_dump()])
    a.phase, a.raw_state, a.ended_at = 'succeeded', 'SUCCEEDED', START + 120_000
    event = SceneEvent(event_id='real-event', account_id='real-account', workspace_id=a.workspace_id,
        execution_attempt_id=a.id, event_time=a.ended_at, observed_at=END, sequence=1,
        type='attempt.upsert', payload=a.model_dump()).model_dump()
    return dict(mode='replay', checkpoint=checkpoint, events=[event], retention_days=1,
                available_duration_ms=END - START)


def test_overlay_preserves_real_identities_history_and_links_without_inventing_tables():
    source = real_capture()
    before = deepcopy(source)
    result = build_simulation(source)
    assert source == before
    assert result['checkpoint']['objects'] == source['checkpoint']['objects']
    assert result['checkpoint']['workspaces'] == source['checkpoint']['workspaces']
    assert result['checkpoint']['attempts'] == source['checkpoint']['attempts']
    assert next(e for e in result['events'] if e['event_id'] == 'real-event')['payload'] == source['events'][0]['payload']
    final = captured_attempts(result)
    real = [a for a in final if a['provenance'] != PROVENANCE]
    assert real == captured_attempts(source)
    simulated = [a for a in final if a['provenance'] == PROVENANCE]
    assert len(simulated) == len({a['run_id'] for a in simulated}) == SIMULATED_RUNS == 84
    known = {o['id'] for o in source['checkpoint']['objects']}
    for a in simulated:
        assert a['workspace_id'] == 'real-workspace' and a['account_id'] == 'real-account'
        assert a['name'].startswith('Sigma Demo 2-sim-')
        assert a['native_url'] is None
        assert a['estimate']['sample_count'] == 0
        assert a['route']['evidence'] == 'configured' and a['route']['provenance'] == PROVENANCE
        assert set(a['route']['source_ids'] + a['route']['target_ids']) <= known
        assert START < a['started_at'] < a['ended_at'] <= END
        Attempt.model_validate(a)
    assert result['checkpoint']['simulation']['source_capture_id'] == 'real-capture'
    assert {a['kind'] for a in simulated} == {'plane', 'ship'}
    assert len([a for a in simulated if a['route']['external_source']]) == 28
    assert len([a for a in simulated if a['route']['external_target']]) == 28
    assert {(a['started_at'] - START) // 3_600_000 for a in simulated} == set(range(24))
    assert any(len(a['route']['target_ids']) > 1 for a in simulated)
    assert build_simulation(source) == result
    early = scene_at(result, START + 180_000)
    assert any(a['provenance'] == PROVENANCE and a['phase'] == 'running' and a['ended_at'] is None for a in early['attempts'])


def test_simulation_uses_only_job_visible_objects_and_handles_unresolved_real_routes():
    source = real_capture()
    source['checkpoint']['objects'][1]['type'] = 'view'
    source['checkpoint']['objects'][2]['type'] = 'view'
    for a in [*source['checkpoint']['attempts'], *(e['payload'] for e in source['events'])]:
        a['kind'] = 'buoy'
        a['route'].update(evidence='unknown', source_ids=[], target_ids=[])
    foreign = {**source['checkpoint']['objects'][0], 'id': 'foreign', 'workspace_ids': ['unrelated']}
    source['checkpoint']['objects'].insert(0, foreign)
    simulated = [a for a in captured_attempts(build_simulation(source)) if a['provenance'] == PROVENANCE]
    assert all('foreign' not in a['route']['source_ids'] + a['route']['target_ids'] for a in simulated)
    inventory = {o['id']: o for o in source['checkpoint']['objects']}
    assert all(inventory[i]['type'] == 'table' for a in simulated if a['route']['external_source']
               for i in a['route']['target_ids'])
    source['checkpoint']['objects'] = [foreign]
    with pytest.raises(ValueError, match='visible tables'):
        build_simulation(source)


def test_simulation_endpoint_persists_an_idempotent_overlay_and_keeps_the_source(tmp_path):
    path = str(tmp_path / 'demo.sqlite')
    source = real_capture()
    with TestClient(create_app(path), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        assert client.post('/api/replay/simulate').status_code == 400
        client.app.state.repository.save_capture(source)
        first = client.post('/api/replay/simulate')
        assert first.status_code == 200
        result = first.json()
        assert client.post('/api/replay/simulate').json() == result
        assert client.get('/api/replay').json() == result
        assert client.get('/api/replay', params={'capture': 'real-capture'}).json() == source
        assert len(client.get('/api/scene', params={'at': END}).json()['attempts']) == 85
        assert client.get('/api/health').json()['live_collection'] is False
    with TestClient(create_app(path), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        assert client.get('/api/replay').json() == result
        assert client.get('/api/replay', params={'capture': 'real-capture'}).json() == source
        assert client.post('/api/replay/simulate').json() == result


def test_overlay_rejects_demo_empty_jobs_and_a_partial_window():
    source = real_capture()
    source['mode'] = 'demo'
    with pytest.raises(ValueError, match='imported workspace'):
        build_simulation(source)
    source = real_capture()
    source['checkpoint']['attempts'], source['events'] = [], []
    with pytest.raises(ValueError, match='no real job runs'):
        build_simulation(source)
    source = real_capture()
    source['checkpoint']['range']['end'] = START + 3_600_000
    with pytest.raises(ValueError, match='24-hour'):
        build_simulation(source)
