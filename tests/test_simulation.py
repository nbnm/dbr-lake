from copy import deepcopy
import json
import re
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
        assert not re.search(r'(?i)\bsim(?:ulated)?\b|Sigma Demo', a['name'])
        assert a['name'].startswith(('sandbox-', 'platform-'))
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


def test_additional_batch_retains_the_first_84_runs_and_adds_exactly_80_on_real_tables(tmp_path):
    source = real_capture()
    first = build_simulation(source)
    before = deepcopy(first)
    result = build_simulation(first, additional=True)
    assert first == before
    old = {a['id']: a for a in captured_attempts(first)}
    final = {a['id']: a for a in captured_attempts(result)}
    assert all(final[ident] == attempt for ident, attempt in old.items())
    added = [a for ident, a in final.items() if ident not in old]
    assert len(added) == 80
    known = {o['id'] for o in source['checkpoint']['objects']}
    for a in added:
        assert a['provenance'] == PROVENANCE and a['native_url'] is None
        assert not re.search(r'(?i)\bsim(?:ulated)?\b|Sigma Demo', a['name'])
        assert a['name'].startswith(('sandbox-', 'platform-'))
        assert START < a['started_at'] < a['ended_at'] <= END
        assert set(a['route']['source_ids'] + a['route']['target_ids']) <= known
        Attempt.model_validate(a)
    assert len({a['run_id'] for a in final.values()}) == 165
    assert result['checkpoint']['simulation']['added_runs'] == 164
    assert result['checkpoint']['simulation']['parent_capture_id'] == first['checkpoint']['capture_id']
    assert result['checkpoint']['simulation']['source_capture_id'] == 'real-capture'
    assert build_simulation(first, additional=True) == result
    with TestClient(create_app(str(tmp_path / 'demo.sqlite')), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        client.app.state.repository.save_capture(source)
        client.app.state.repository.save_capture(first)
        assert client.post('/api/replay/simulate/more').status_code == 400
        request = {'capture': first['checkpoint']['capture_id']}
        assert client.post('/api/replay/simulate/more', params=request).json() == result
        assert client.post('/api/replay/simulate/more', params=request).json() == result
        assert client.get('/api/replay').json() == result
        assert client.get('/api/replay', params={'capture': first['checkpoint']['capture_id']}).json() == first
        assert client.get('/api/replay', params={'capture': 'real-capture'}).json() == source
        assert client.get('/api/configuration').json()['last_capture']['simulation']['added_runs'] == 164


def test_saved_legacy_names_are_cleaned_across_replay_and_run_details_without_rewriting_history(tmp_path):
    source = real_capture()
    for a in [*source['checkpoint']['attempts'], *(e['payload'] for e in source['events'])]:
        a['name'] = 'Sigma-sim-01-tables-deploy'  # A real name must be preserved verbatim.
    expected = build_simulation(source)
    # Explicitly construct the old format, independently of the current naming
    # scheme, so this checks compatibility rather than a no-op conversion.
    selected = next(e['execution_attempt_id'] for e in expected['events']
                    if e['type'] == 'attempt.upsert' and e['payload'].get('provenance') == PROVENANCE)
    for e in expected['events']:
        if e['execution_attempt_id'] == selected:
            e['payload']['name'] = 'Sigma Demo 2-001-API-landing'
    legacy = deepcopy(expected)
    for e in legacy['events']:
        if e['execution_attempt_id'] == selected:
            e['payload']['name'] = 'Sigma Demo 2-sim-001-API-landing'
    with TestClient(create_app(str(tmp_path / 'demo.sqlite')), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        repo = client.app.state.repository
        repo.save_capture(source)
        repo.save_capture(legacy)
        assert client.get('/api/replay').json() == expected
        assert client.get('/api/replay', params={'start': START + 180_000}).json()['checkpoint']['attempts'] == scene_at(expected, START + 180_000)['attempts']
        final = client.get('/api/scene', params={'at': END}).json()
        assert final == scene_at(expected, END)
        a = next(a for a in final['attempts'] if a['provenance'] == PROVENANCE)
        assert client.get(f'/api/attempts/{a["id"]}', params={'at': END}).json() == a
        assert client.post('/api/replay/simulate').json() == expected
        assert client.get('/api/replay', params={'capture': 'real-capture'}).json() == source
        stored = repo.db.execute('SELECT payload FROM captures WHERE id=?', (legacy['checkpoint']['capture_id'],)).fetchone()[0]
        assert json.loads(stored) == legacy


def test_activity_balances_catalogs_workloads_and_schema_layers_with_writable_endpoints():
    source = real_capture()
    cp = source['checkpoint']
    families = ['iot_streaming', 'lakesentry_monitoring', 'sas_migration', 'mlops',
                'genai_vector', 'finance_prod', 'marketing_prod', 'delivery_ops', 'reporting']
    prototype = cp['objects'][0]
    for catalog in families:
        for schema in ['bronze', 'silver', 'gold', 'bronze_all_tables']:
            for name in ['records', 'records_view']:
                cp['objects'].append({**prototype,
                    'id': f'real-metastore:{catalog}.{schema}.{name}', 'catalog': catalog,
                    'schema_name': schema, 'name': name,
                    'type': 'view' if name.endswith('_view') else 'table'})
    # Thousands of tables in Sigma must not displace smaller catalogs.
    for n in range(300):
        cp['objects'].append({**prototype, 'id': f'large-{n}',
                              'name': f'sales_{n}'})
    cp['objects'].append({**prototype, 'id': 'internal', 'catalog': '__internal'})
    cp['objects'].append({**prototype, 'id': 'event-log', 'name': 'event_log_123'})
    before = deepcopy(source)
    result = build_simulation(build_simulation(source), additional=True)
    assert source == before
    inventory = {o['id']: o for o in cp['objects']}
    generated = [a for a in captured_attempts(result) if a['provenance'] == PROVENANCE]
    used = {i for a in generated for i in a['route']['source_ids'] + a['route']['target_ids']}
    assert set(families) <= {inventory[i]['catalog'] for i in used}
    assert {'internal', 'event-log'}.isdisjoint(used)
    assert all(inventory[i]['type'] == 'table' for i in used)
    for catalog in families:
        assert {'bronze', 'silver', 'gold'} <= {
            inventory[i]['schema_name'] for i in used if inventory[i]['catalog'] == catalog}
    actions_by_catalog = {
        'iot_streaming': ['event-deduplication', 'SCD2-merge', 'window-aggregation'],
        'lakesentry_monitoring': ['cost-allocation', 'lineage-refresh', 'quality-check'],
        'sas_migration': ['SAS-conversion', 'dependency-analysis', 'reconciliation'],
        'mlops': ['feature-engineering', 'batch-scoring', 'model-validation'],
        'genai_vector': ['embedding-refresh', 'document-chunking', 'retrieval-evaluation'],
        'finance_prod': ['reconciliation', 'risk-aggregation', 'balance-refresh'],
        'marketing_prod': ['audience-segmentation', 'campaign-attribution', 'quality-check'],
        'delivery_ops': ['delivery-metrics', 'SCD2-merge', 'quality-check'],
        'reporting': ['dbt-transform', 'mart-refresh', 'quality-check'],
    }
    for catalog, actions in actions_by_catalog.items():
        jobs = [a for a in generated if a['kind'] == 'ship' and a['name'].startswith(catalog + '-')]
        assert jobs and all(any(a['name'].endswith(action) for action in actions) for a in jobs)
    assert captured_attempts(source) == [a for a in captured_attempts(result) if a['provenance'] != PROVENANCE]
