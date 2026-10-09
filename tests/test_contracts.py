import pytest
from pydantic import ValidationError
from backend.fixtures import events
from backend.models import Attempt


def test_external_ingestion_requires_evidence():
    data = next(e.payload for e in events() if e.execution_attempt_id == 'ingest-orders')
    data['route']['external_source'] = None
    with pytest.raises(ValidationError, match='external source evidence'):
        Attempt.model_validate(data)


def test_read_only_task_cannot_invent_a_shipment():
    data = next(e.payload for e in events() if e.execution_attempt_id == 'refine-orders')
    data['route']['target_ids'] = []
    with pytest.raises(ValidationError, match='processing buoy'):
        Attempt.model_validate(data)


def test_export_requires_source_tables_and_a_supported_external_destination():
    data = next(e.payload for e in events() if e.payload.get('route', {}).get('external_target'))
    assert Attempt.model_validate(data).kind == 'plane'
    data['route']['source_ids'] = []
    with pytest.raises(ValidationError, match='external destination'):
        Attempt.model_validate(data)
