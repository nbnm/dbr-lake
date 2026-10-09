import json
import subprocess
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.app import create_app
from backend.connections import ConnectionInput, ReplayRepository

HOST = 'https://test.azuredatabricks.net'
SECRET = 'oauth-secret-never-expose'
SETTINGS = dict(name='Workspace', host=HOST, auth_method='databricks_cli', cli_profile='lake-replay')


@pytest.fixture
def cli(monkeypatch, tmp_path):
    config = tmp_path / 'cli.cfg'
    config.write_text(f'[lake-replay]\nhost = {HOST}/\nauth_type = databricks-cli\n')
    monkeypatch.setenv('DATABRICKS_CONFIG_FILE', str(config))
    monkeypatch.setattr('backend.cli_auth.shutil.which', lambda _: '/usr/bin/databricks')
    return config


def test_cli_refreshes_credentials_per_use_and_survives_restart_without_saving_secrets(cli, tmp_path, monkeypatch):
    calls = []
    def run(args, **options):
        calls.append((args, options))
        return SimpleNamespace(returncode=0, stdout=json.dumps({'access_token': f'{SECRET}-{len(calls)}'}))
    monkeypatch.setattr('backend.cli_auth.subprocess.run', run)
    monkeypatch.setenv('DATABRICKS_TOKEN', 'ambient-secret')
    monkeypatch.setenv('DATABRICKS_HOST', 'https://other.azuredatabricks.net')
    path = tmp_path / 'settings.sqlite'
    repo = ReplayRepository(path)
    saved = repo.save(ConnectionInput(**SETTINGS))
    assert saved['credential_configured'] and not saved['token_configured']
    assert repo.credential(saved['id'])[1] == f'{SECRET}-1'
    assert repo.credential(saved['id'])[1] == f'{SECRET}-2'
    repo.close()
    repo = ReplayRepository(path)
    assert repo.list()[0]['credential_configured']
    assert repo.credential(saved['id'])[1] == f'{SECRET}-3'
    assert SECRET not in json.dumps(repo.list())
    assert SECRET.encode() not in path.read_bytes()
    repo.close()
    for args, options in calls:
        assert args == ['databricks', 'auth', 'token', '--profile', 'lake-replay', '--host', HOST, '--timeout', '20s']
        assert options['capture_output'] and options['stdin'] == subprocess.DEVNULL and options['timeout'] == 30
        assert 'DATABRICKS_TOKEN' not in options['env'] and 'DATABRICKS_HOST' not in options['env']
        assert options['env']['DATABRICKS_CONFIG_FILE'] == str(cli)


@pytest.mark.parametrize('config', [
    '[lake-replay]\nhost=https://other.azuredatabricks.net\nauth_type=databricks-cli',
    f'[lake-replay]\nhost={HOST}/malformed\nauth_type=databricks-cli',
    f'[lake-replay]\nhost={HOST}:{SECRET}\nauth_type=databricks-cli',
    f'[lake-replay]\nhost={HOST}?token={SECRET}\nauth_type=databricks-cli',
    f'[lake-replay]\nhost={HOST}\nauth_type=pat\ntoken={SECRET}',
    '[other]\nhost=https://other.azuredatabricks.net\nauth_type=databricks-cli',
    '[invalid',
])
def test_wrong_or_invalid_profile_is_rejected_before_token_resolution(cli, config, tmp_path, monkeypatch):
    cli.write_text(config)
    def forbidden(*args, **kwargs): raise AssertionError('Must not request a token for a mismatched profile')
    monkeypatch.setattr('backend.cli_auth.subprocess.run', forbidden)
    repo = ReplayRepository(tmp_path / 'settings.sqlite')
    saved = repo.save(ConnectionInput(**SETTINGS))
    assert not saved['credential_configured'] and SECRET not in json.dumps(saved)
    with pytest.raises(ValueError): repo.credential(saved['id'])
    repo.close()


@pytest.mark.parametrize('fault', ['failed', 'json', 'missing-token', 'whitespace', 'timeout', 'missing-cli'])
def test_cli_failure_is_sanitized_in_local_api(cli, tmp_path, monkeypatch, fault):
    def run(*args, **kwargs):
        if fault == 'timeout': raise subprocess.TimeoutExpired('databricks', 30, output=SECRET, stderr=SECRET)
        if fault == 'missing-cli': raise FileNotFoundError(SECRET)
        if fault == 'failed': return SimpleNamespace(returncode=1, stdout=SECRET, stderr=SECRET)
        if fault == 'json': return SimpleNamespace(returncode=0, stdout=SECRET)
        if fault == 'missing-token': return SimpleNamespace(returncode=0, stdout=json.dumps({'error': SECRET}))
        return SimpleNamespace(returncode=0, stdout=json.dumps({'access_token': SECRET + '\n'}))
    monkeypatch.setattr('backend.cli_auth.subprocess.run', run)
    with TestClient(create_app(str(tmp_path / 'demo.sqlite')), base_url='http://localhost', client=('127.0.0.1', 1)) as client:
        saved = client.post('/api/configuration', json=SETTINGS).json()
        response = client.post(f'/api/configuration/{saved["id"]}/test')
        assert response.status_code == 400 and SECRET not in response.text
        assert SECRET not in client.get('/api/configuration').text


def test_cli_validation_and_auth_method_changes_cannot_reuse_old_tokens(cli, tmp_path, monkeypatch):
    with pytest.raises(ValidationError): ConnectionInput(**{**SETTINGS, 'cli_profile': None})
    with pytest.raises(ValidationError): ConnectionInput(**{**SETTINGS, 'token': SECRET})
    monkeypatch.setattr('backend.cli_auth.subprocess.run', lambda *a, **k: SimpleNamespace(returncode=0, stdout=json.dumps({'access_token': 'fresh-cli-token'})))
    repo = ReplayRepository(tmp_path / 'settings.sqlite')
    saved = repo.save(ConnectionInput(name='Workspace', host=HOST, token=SECRET))
    repo.save(ConnectionInput(id=saved['id'], **SETTINGS))
    assert saved['id'] not in repo.tokens
    assert repo.credential(saved['id'])[1] == 'fresh-cli-token'
    repo.save(ConnectionInput(id=saved['id'], name='Workspace', host=HOST))
    with pytest.raises(ValueError, match='token'): repo.credential(saved['id'])
    repo.close()
