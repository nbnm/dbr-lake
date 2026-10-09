"""A local simulation overlay on an immutable, imported workspace capture."""
from collections import defaultdict
from copy import deepcopy
import re
from uuid import NAMESPACE_URL, uuid5

from .models import Attempt, Estimate, Route, SceneEvent

SIMULATED_RUNS = 84
SIMULATION_VERSION = "workspace-overlay-v3"
PROVENANCE = "workspace_simulation"


def normalize_simulated_job_names(capture):
    """Clean legacy names on a decoded capture without changing stored history."""
    attempts = [*capture['checkpoint']['attempts'],
                *(e['payload'] for e in capture['events'] if e['type'] == 'attempt.upsert')]
    for attempt in attempts:
        if attempt.get('provenance') == PROVENANCE:
            attempt['name'] = re.sub(r'-sim-(\d+-(?:API-landing|tables-deploy|export))$',
                                     r'-\1', attempt['name'])
    return capture


def captured_attempts(capture):
    attempts = {a['id']: a for a in capture['checkpoint']['attempts']}
    for event in capture['events']:
        if event['type'] == 'attempt.upsert':
            attempts[event['payload']['id']] = event['payload']
    return list(attempts.values())


def _table_key(table):
    return table['metastore_id'], table['catalog'], table['schema_name']


def _layer(schema):
    for word, rank in [('bronze', 0), ('raw', 0), ('ledger', 0),
                       ('silver', 1), ('metrics', 1), ('gold', 2)]:
        if word in schema.lower():
            return rank
    return 3


def _stem(name):
    return re.sub(r'^(?:bronze_|silver_|gold_|bv_|mv_)|_raw$', '', name)


# Each family changes the work represented by its landing, processing and export
# runs. The endpoint identities always come from the captured inventory.
WORKLOADS = {
    'streaming': (['event-ingestion', 'API-ingestion', 'CDC-ingestion'],
                  ['event-deduplication', 'SCD2-merge', 'window-aggregation'],
                  ['event-export', 'warehouse-export', 'BI-export']),
    'observability': (['telemetry-ingestion', 'usage-ingestion', 'API-ingestion'],
                      ['cost-allocation', 'lineage-refresh', 'quality-check'],
                      ['monitoring-export', 'cost-report-export', 'audit-export']),
    'migration': (['file-ingestion', 'source-sync', 'CDC-ingestion'],
                  ['SAS-conversion', 'dependency-analysis', 'reconciliation'],
                  ['migration-export', 'validation-export', 'warehouse-export']),
    'machine-learning': (['feature-ingestion', 'API-ingestion', 'source-sync'],
                         ['feature-engineering', 'batch-scoring', 'model-validation'],
                         ['prediction-export', 'feature-export', 'evaluation-export']),
    'AI': (['document-ingestion', 'API-ingestion', 'source-sync'],
           ['embedding-refresh', 'document-chunking', 'retrieval-evaluation'],
           ['index-export', 'assessment-export', 'data-share']),
    'finance': (['ledger-ingestion', 'CDC-ingestion', 'API-ingestion'],
                ['reconciliation', 'risk-aggregation', 'balance-refresh'],
                ['finance-report-export', 'warehouse-export', 'audit-export']),
    'marketing': (['CRM-ingestion', 'API-ingestion', 'source-sync'],
                  ['audience-segmentation', 'campaign-attribution', 'quality-check'],
                  ['CRM-export', 'campaign-export', 'BI-export']),
    'operations': (['API-ingestion', 'CDC-ingestion', 'source-sync'],
                   ['delivery-metrics', 'SCD2-merge', 'quality-check'],
                   ['operations-report-export', 'warehouse-export', 'BI-export']),
    'reporting': (['API-ingestion', 'CDC-ingestion', 'source-sync'],
                  ['dbt-transform', 'mart-refresh', 'quality-check'],
                  ['BI-export', 'report-export', 'data-share']),
}


def _workload(tables):
    text = ' '.join(f"{o['catalog']} {o['schema_name']} {o['name']}" for o in tables).lower()
    patterns = [
        ('streaming', r'iot|stream|transaction_stream'),
        ('observability', r'lakesentry|logging|monitoring|observability|telemetry|dbu|commitment'),
        ('migration', r'sas|alchemist|migration|bmo|liberty_mutual|currys'),
        ('machine-learning', r'mlops|predict|feature|inferencelog|medical|omop|census'),
        ('AI', r'vector|genai|embedding|rag|agent|document'),
        ('finance', r'financ|loan|account|nota|billing|risk|debiteuren'),
        ('marketing', r'marketing|outreach|prospect|campaign'),
        ('operations', r'carrier|delivery|tracking|buspart|order|shipment'),
    ]
    # Catalog purpose takes precedence over incidental table terms (a marketing
    # catalog can contain a SAS staging table without becoming a migration job).
    for context in [' '.join(o['catalog'] for o in tables).lower(), text]:
        for family, pattern in patterns:
            if re.search(pattern, context):
                return family
    return 'reporting'


def _table_preference(o):
    return (bool(re.match(r'^(?:event_log_|rv_|temp_|work_|test|demo_|sample)', o['name'])),
            bool(re.search(r'[0-9a-f]{12}|_old$', o['name'])), o['name'], o['id'])


def _pipelines(cp, real_attempts):
    """Balance workload families and catalogs, then rotate through schema layers."""
    job_workspaces = {a['workspace_id'] for a in real_attempts}
    groups = defaultdict(list)
    for o in cp['objects']:
        if (o.get('type', 'table') != 'table' or o['catalog'] in {'system', 'samples'}
                or o['catalog'].startswith('__') or o['schema_name'].startswith('__')
                or o['schema_name'] == 'pg_catalog' or o['name'].startswith(('__', 'event_log_'))
                or not set(o['workspace_ids']) & job_workspaces):
            continue
        groups[_table_key(o)].append(o)
    by_id = {o['id']: o for tables in groups.values() for o in tables}
    catalogs = defaultdict(list)
    for key in groups:
        catalogs[key[:2]].append(key)
    pairs = defaultdict(list)
    seen = set()

    def add(source, target):
        shared = set(source['workspace_ids']) & set(target['workspace_ids']) & job_workspaces
        if not shared or source['metastore_id'] != target['metastore_id']:
            return
        key = _table_key(source), _table_key(target)
        if key in seen:
            return
        seen.add(key)
        pairs[_table_key(source)[:2]].append((source, target, sorted(shared)[0]))

    for a in sorted(real_attempts, key=lambda a: a['id']):
        sources = [by_id[i] for i in a['route']['source_ids'] if i in by_id]
        targets = [by_id[i] for i in a['route']['target_ids'] if i in by_id]
        if sources and targets:
            source = min(sources, key=_table_preference)
            target = min(targets, key=lambda o: (_stem(o['name']) != _stem(source['name']),
                                                 o['id'] == source['id'], _table_preference(o)))
            add(source, target)

    for catalog in sorted(catalogs):
        # A bounded hierarchy keeps the replay legible. More inventory entries
        # cannot crowd out other catalogs as the old seven-pair cutoff did.
        ordered = sorted(catalogs[catalog], key=lambda k: (_layer(k[2]), k[2] == 'default', k[2]))
        layers = {}
        for key in ordered:
            layers.setdefault(_layer(key[2]), key)
        schemas = list(layers.values())[:3]
        for key in ordered:
            if key not in schemas and len(schemas) < 3:
                schemas.append(key)
        for index, key in enumerate(schemas):
            source = min(groups[key], key=_table_preference)
            target_key = schemas[min(index + 1, len(schemas) - 1)]
            target = min(groups[target_key], key=lambda o: (o['id'] == source['id'],
                _stem(o['name']) != _stem(source['name']), _table_preference(o)))
            add(source, target)

    # Pick one catalog per workload family in each round, favouring business
    # catalogs over test and marketplace inventories. Existing routes retain
    # their real endpoints, but do not dominate the added activity.
    families = defaultdict(list)
    def business_catalog(key):
        return not re.search(r'^(?:test|om_test|pg-demo)|marketplace|sample|documentation_dataset', key[1])
    candidates = [c for c in pairs if business_catalog(c)]
    if len(candidates) < 20:
        candidates.extend(c for c in pairs if c not in candidates)
    imported_catalogs = {by_id[i]['catalog'] for a in real_attempts
                         for i in a['route']['source_ids'] + a['route']['target_ids'] if i in by_id}
    for catalog in sorted(candidates):
        routes = pairs[catalog]
        family = _workload([routes[0][0], routes[0][1]])
        families[family].append(catalog)
    def preference(key):
        return (not business_catalog(key), key[1] not in imported_catalogs,
                not key[1].endswith('_prod'), -min(len(catalogs[key]), 3), key)
    for candidates in families.values():
        candidates.sort(key=preference)
    selected = []
    depth = 0
    while len(selected) < 20:
        row = [candidates[depth] for _, candidates in sorted(families.items()) if depth < len(candidates)]
        if not row:
            break
        selected.extend(sorted(row, key=preference)[:20 - len(selected)])
        depth += 1
    result = []
    for depth in range(max((len(pairs[c]) for c in selected), default=0)):
        result.extend(pairs[c][depth] for c in selected if depth < len(pairs[c]))
    if not result:
        raise ValueError('The saved replay needs real job runs and visible tables before activity can be added.')
    return result


def _job_name(source, target, serial, kind, variation):
    family = _workload([source, target])
    actions = WORKLOADS[family][{'landing': 0, 'transfer': 1, 'export': 2}[kind]]
    endpoint = source if kind == 'landing' else target
    # Recognizable names come from the actual catalog, schema and table, rather
    # than repeatedly cloning the few Sigma jobs in the captured day.
    base = f"{endpoint['catalog']}-{endpoint['schema_name']}-{_stem(endpoint['name'])}"
    return f'{base}-{serial:03}-{actions[variation % len(actions)]}'


def build_simulation(capture, additional=False):
    cp = capture['checkpoint']
    if capture['mode'] != 'replay' or cp.get('simulation') and not additional:
        raise ValueError('Select an imported workspace capture to add activity.')
    all_attempts = captured_attempts(capture)
    real_attempts = [a for a in all_attempts if a.get('provenance') != PROVENANCE]
    if not real_attempts:
        raise ValueError('The saved replay has no real job runs to use as naming references.')
    pairs = _pipelines(cp, real_attempts)
    count = 80 if additional else SIMULATED_RUNS
    previous_count = len(all_attempts) - len(real_attempts)
    version = 'workspace-additional-v2' if additional else SIMULATION_VERSION
    ident = uuid5(NAMESPACE_URL, f"simlake:{cp['capture_id']}:{version}").hex
    output = deepcopy(capture)
    checkpoint = output['checkpoint']
    start, end = cp['range']['start'], cp['range']['end']
    span = end - start
    if span != 86_400_000:
        raise ValueError('Import a full 24-hour replay before adding activity.')
    envelopes = output['events']
    pipelines = (count + 2) // 3
    for pipeline in range(pipelines):
        choice = pipeline + previous_count // 3
        source, target, ws = pairs[choice % len(pairs)]
        # Each pipeline has landing, transformation and export runs. Stagger
        # their starts across the captured day and finish within its bounds.
        landing_start = start + (1_020_000 if additional else 120_000) + pipeline * span // pipelines
        landing_end = landing_start + 600_000 + (pipeline % 3) * 60_000
        transfer_start = landing_end + 60_000
        transfer_end = transfer_start + 1_080_000 + (pipeline % 4) * 60_000
        export_start = transfer_end + 60_000
        export_end = min(export_start + 720_000, end - 1_000)
        landing = [source['id']]
        if pipeline % 4 == 0:
            extra = sorted((o for o in cp['objects'] if _table_key(o) == _table_key(source)
                            and o['id'] != source['id'] and ws in o['workspace_ids']
                            and o.get('type', 'table') == 'table'
                            and not o['name'].startswith(('__', 'event_log_'))), key=_table_preference)
            if extra:
                landing.append(extra[0]['id'])
        api = f"{source['catalog']} API"
        destination = f"{target['catalog']} export"
        definitions = [
            ('landing', 'plane', landing_start, landing_end, [], landing, api, None),
            ('transfer', 'ship', transfer_start, transfer_end, [source['id']], [target['id']], None, None),
            ('export', 'plane', export_start, export_end, [target['id']], [], None, destination),
        ]
        for offset, (kind, vessel, launched, finished, sources, targets, external_source, external_target) in enumerate(definitions):
            serial = previous_count + pipeline * 3 + offset + 1
            if serial > previous_count + count:
                break
            run_id = f'activity-run-{serial:03}'
            attempt_id = f'{ident}:{run_id}'
            route_id = f'simulation:{ident}:route:{serial}'
            a = Attempt(id=attempt_id, account_id=cp['account_id'], workspace_id=ws,
                job_id=f'activity-job-{serial:03}', run_id=run_id, task_run_id=run_id,
                task_key='job-run', name=_job_name(source, target, serial, kind, choice), kind=vessel,
                scope='job_run', phase='queued', raw_state='PENDING', started_at=None,
                observed_at=launched - 30_000, source_id=f'simulation:{ident}:{serial}',
                provenance=PROVENANCE, native_url=None, replay_duration_ms=finished - launched,
                route=Route(version=route_id, evidence='configured', source_ids=sources,
                    target_ids=targets, external_source=external_source, external_target=external_target,
                    source_record_ids=[route_id], observed_at=launched, provenance=PROVENANCE),
                estimate=Estimate(predicted_duration_ms=None, sample_count=0, confidence='unknown',
                    version=f'{ident}:simulation', timing_basis='simulated_duration'))
            for time, phase in [(launched - 30_000, 'queued'), (launched, 'running'), (finished, 'succeeded')]:
                a.phase, a.raw_state, a.observed_at = phase, phase.upper(), time
                a.started_at = None if phase == 'queued' else launched
                a.ended_at = finished if phase == 'succeeded' else None
                envelopes.append(SceneEvent(event_id=f'{ident}:{serial}:{phase}', account_id=cp['account_id'],
                    workspace_id=ws, execution_attempt_id=attempt_id, event_time=time, observed_at=time,
                    type='attempt.upsert', payload=a.model_dump()).model_dump())
    envelopes.sort(key=lambda e: (e['event_time'], e['event_id']))
    for sequence, e in enumerate(envelopes, 1):
        e['sequence'] = sequence
    checkpoint['capture_id'] = ident
    source_id = cp.get('simulation', {}).get('source_capture_id', cp['capture_id'])
    checkpoint['simulation'] = {'added_runs': previous_count + count, 'source_capture_id': source_id,
                                'version': version}
    if additional:
        checkpoint['simulation']['parent_capture_id'] = cp['capture_id']
    checkpoint['history_note'] = '24-hour activity replay using captured workspace catalogs and schemas.'
    return output
