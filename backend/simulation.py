"""A local simulation overlay on an immutable, imported workspace capture."""
from collections import defaultdict
from copy import deepcopy
import re
from uuid import NAMESPACE_URL, uuid5

from .models import Attempt, Estimate, Route, SceneEvent

SIMULATED_RUNS = 84
SIMULATION_VERSION = "workspace-overlay-v2"
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


def _pipelines(cp, real_attempts):
    """Prefer actual route pairs and layer pairs, using only captured objects."""
    by_id = {o['id']: o for o in cp['objects']}
    job_workspaces = {a['workspace_id'] for a in real_attempts}
    pairs = []
    seen = set()

    def add(source, target):
        shared = set(source['workspace_ids']) & set(target['workspace_ids']) & job_workspaces
        if not shared or source['metastore_id'] != target['metastore_id']:
            return
        key = _table_key(source), _table_key(target)
        if key in seen:
            return
        seen.add(key)
        pairs.append((source, target, sorted(shared)[0]))

    # Imported routes supply identities, not evidence for the simulated runs.
    for a in sorted(real_attempts, key=lambda a: a['id']):
        sources = [by_id[i] for i in a['route']['source_ids']
                   if i in by_id and by_id[i].get('type', 'table') == 'table']
        targets = [by_id[i] for i in a['route']['target_ids'] if i in by_id]
        if sources and targets:
            source = sorted(sources, key=lambda o: o['id'])[0]
            target = min(targets, key=lambda o: (_stem(o['name']) != _stem(source['name']),
                                                 o['id'] == source['id'], o['id']))
            add(source, target)

    groups = defaultdict(list)
    for o in cp['objects']:
        if (o['catalog'] in {'system', 'samples'} or o['catalog'].startswith('__')
                or o['schema_name'] == 'pg_catalog' or o['name'].startswith('__')
                or not set(o['workspace_ids']) & job_workspaces):
            continue
        groups[_table_key(o)].append(o)
    catalogs = defaultdict(list)
    for key in groups:
        catalogs[key[:2]].append(key)
    # Limit the added hierarchy to a few actual layer pairs; table density does
    # not turn the lake into thousands of independent visual modules.
    for catalog in sorted(catalogs):
        schemas = sorted(catalogs[catalog], key=lambda k: (_layer(k[2]), k[2]))
        lows = [key for key in schemas if _layer(key[2]) == 0]
        highs = [key for key in schemas if _layer(key[2]) > 0]
        if not lows or not highs:
            continue
        source_group = [o for o in groups[lows[0]] if o.get('type', 'table') == 'table']
        target_group = groups[highs[0]]
        if not source_group:
            continue
        source = min(source_group, key=lambda o: (bool(re.match(r'^(?:event_log_|rv_|temp_|work_)', o['name'])), o['id']))
        target = min(target_group, key=lambda o: (_stem(o['name']) != _stem(source['name']),
                                                bool(re.match(r'^(?:event_log_|rv_|temp_|work_)', o['name'])), o['id']))
        add(source, target)
        if len(pairs) >= 7:
            break
    if not pairs:
        # Small imports may have one schema or no resolved lineage. Even here,
        # both endpoints must be actual captured table identities.
        for group in sorted(groups):
            tables = sorted(groups[group], key=lambda o: o['id'])
            writable = [o for o in tables if o.get('type', 'table') == 'table']
            if not writable:
                continue
            add(writable[0], tables[-1])
            if len(pairs) >= 4:
                break
    if not pairs:
        raise ValueError('The saved replay needs real job runs and visible tables before a simulation can be added.')
    return pairs


def _job_name(template, serial, kind):
    base = re.sub(r'_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', '', template)
    # Keep the recognizable deployment pattern without copying a real run's
    # timestamp/hash into a made-up execution name.
    base = re.sub(r'-validation-rv_local_.+?(?=-tables-deploy$)', '', base)
    base = re.sub(r'-[0-9a-f]{12}(?=-tables-deploy$)', '', base)
    base = base.removesuffix('-tables-deploy')
    suffix = {'landing': 'API-landing', 'transfer': 'tables-deploy', 'export': 'export'}[kind]
    return f'{base}-{serial:02}-{suffix}'


def build_simulation(capture, additional=False):
    cp = capture['checkpoint']
    if capture['mode'] != 'replay' or cp.get('simulation') and not additional:
        raise ValueError('Select an imported workspace capture for the simulation.')
    all_attempts = captured_attempts(capture)
    real_attempts = [a for a in all_attempts if a.get('provenance') != PROVENANCE]
    if not real_attempts:
        raise ValueError('The saved replay has no real job runs to use as naming references.')
    pairs = _pipelines(cp, real_attempts)
    count = 80 if additional else SIMULATED_RUNS
    previous_count = len(all_attempts) - len(real_attempts)
    version = 'workspace-additional-v1' if additional else SIMULATION_VERSION
    ident = uuid5(NAMESPACE_URL, f"simlake:{cp['capture_id']}:{version}").hex
    output = deepcopy(capture)
    checkpoint = output['checkpoint']
    start, end = cp['range']['start'], cp['range']['end']
    span = end - start
    if span != 86_400_000:
        raise ValueError('Import a full 24-hour replay before adding simulated runs.')
    templates = defaultdict(dict)
    for a in sorted(real_attempts, key=lambda a: a['id']):
        templates[a['workspace_id']][a['job_id']] = a['name']
    envelopes = output['events']
    pipelines = (count + 2) // 3
    for pipeline in range(pipelines):
        choice = pipeline + previous_count // 3
        source, target, ws = pairs[choice % len(pairs)]
        names = list(templates[ws].values())
        template = names[choice % len(names)]
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
                            and not o['name'].startswith('__')), key=lambda o: o['id'])
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
            run_id = f'sim-run-{serial:03}'
            attempt_id = f'{ident}:{run_id}'
            route_id = f'simulation:{ident}:route:{serial}'
            a = Attempt(id=attempt_id, account_id=cp['account_id'], workspace_id=ws,
                job_id=f'sim-job-{serial:03}', run_id=run_id, task_run_id=run_id,
                task_key='job-run', name=_job_name(template, serial, kind), kind=vessel,
                scope='job_run', phase='queued', raw_state='SIMULATED_PENDING', started_at=None,
                observed_at=launched - 30_000, source_id=f'simulation:{ident}:{serial}',
                provenance=PROVENANCE, native_url=None, replay_duration_ms=finished - launched,
                route=Route(version=route_id, evidence='configured', source_ids=sources,
                    target_ids=targets, external_source=external_source, external_target=external_target,
                    source_record_ids=[route_id], observed_at=launched, provenance=PROVENANCE),
                estimate=Estimate(predicted_duration_ms=None, sample_count=0, confidence='unknown',
                    version=f'{ident}:simulation', timing_basis='simulated_duration'))
            for time, phase in [(launched - 30_000, 'queued'), (launched, 'running'), (finished, 'succeeded')]:
                a.phase, a.raw_state, a.observed_at = phase, f'SIMULATED_{phase.upper()}', time
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
    original_note = cp.get('history_note', '').split(
        'Simulated runs use actual captured table identities; their routes, times and results are invented. ', 1)[-1]
    checkpoint['history_note'] = (f'{len(real_attempts)} imported real runs plus {previous_count + count} simulated runs. '
        'Simulated runs use actual captured table identities; their routes, times and results are invented. '
        + original_note)
    return output
