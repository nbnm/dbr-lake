"""Local replay configuration. Secrets live in memory, never in the SQLite file."""
import json
import sqlite3
from pathlib import Path
from threading import RLock
from urllib.parse import urlsplit
from uuid import uuid4
from typing import Literal
from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator
from .cli_auth import access_token, check_profile


class TaskMapping(BaseModel):
    job_id: str
    task_key: str
    source_tables: list[str] = Field(default_factory=list)
    target_tables: list[str] = Field(default_factory=list)
    external_source: str | None = None

    @field_validator("source_tables", "target_tables")
    @classmethod
    def table_names(cls, values):
        if any(len(name.split('.')) != 3 or not all(name.split('.')) for name in values):
            raise ValueError("Use catalog.schema.table for route mappings.")
        return list(dict.fromkeys(values))


class ConnectionInput(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=120)
    host: str
    token: SecretStr | None = None
    auth_method: Literal['token', 'databricks_cli'] = 'token'
    cli_profile: str | None = Field(default=None, pattern=r'^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}$')
    region: str = Field(default="unspecified", max_length=100)
    routes: list[TaskMapping] = Field(default_factory=list, max_length=200)
    import_source: Literal['system_tables', 'jobs_api'] = 'system_tables'
    warehouse_id: str | None = Field(default=None, pattern=r'^[A-Za-z0-9-]{1,100}$')

    @field_validator("host")
    @classmethod
    def workspace_host(cls, host):
        parts = urlsplit(host.strip())
        allowed = ('.azuredatabricks.net', '.cloud.databricks.com', '.gcp.databricks.com')
        if (parts.scheme != 'https' or not parts.hostname or not parts.hostname.endswith(allowed)
                or parts.username or parts.password or parts.port or parts.query or parts.fragment
                or parts.path not in ('', '/')):
            raise ValueError("Enter an HTTPS Databricks workspace URL without a path or query.")
        return f"https://{parts.hostname}"

    @field_validator("token")
    @classmethod
    def token_value(cls, token):
        if token and (not token.get_secret_value().strip() or any(c.isspace() for c in token.get_secret_value())):
            raise ValueError("Token must be nonempty and contain no whitespace.")
        return token

    @model_validator(mode='after')
    def authentication(self):
        if self.auth_method == 'databricks_cli' and (not self.cli_profile or self.token):
            raise ValueError('CLI authentication requires a named profile and no pasted token.')
        return self


class ReplayRepository:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        self.tokens: dict[str, str] = {}
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, settings TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS captures (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS active_capture (slot INTEGER PRIMARY KEY, id TEXT NOT NULL)')
        self.db.commit()
        Path(path).chmod(0o600)

    def list(self):
        with self.lock:
            return [self.public_settings(json.loads(row[0]))
                    for row in self.db.execute('SELECT settings FROM connections ORDER BY rowid')]

    def public_settings(self, settings):
        token_ready, error = settings['id'] in self.tokens, None
        ready = token_ready
        if settings.get('auth_method') == 'databricks_cli':
            try:
                check_profile(settings)
                ready = True
            except ValueError as e:
                ready, error = False, str(e)
        return {**settings, 'token_configured': token_ready, 'credential_configured': ready,
                'authentication_error': error}

    def save(self, connection: ConnectionInput):
        ident = connection.id or uuid4().hex
        settings = {**connection.model_dump(exclude={'token'}), 'id': ident}
        with self.lock, self.db:
            old = self.db.execute('SELECT settings FROM connections WHERE id=?', (ident,)).fetchone()
            if (connection.auth_method == 'databricks_cli' or
                    old and (json.loads(old[0])['host'] != connection.host or
                             json.loads(old[0]).get('auth_method', 'token') != connection.auth_method)):
                self.tokens.pop(ident, None)  # Never reuse a token at a changed destination or method.
            if connection.token:
                self.tokens[ident] = connection.token.get_secret_value()
            self.db.execute('INSERT OR REPLACE INTO connections VALUES (?,?)', (ident, json.dumps(settings)))
        return self.public_settings(settings)

    def credential(self, ident):
        with self.lock:
            row = self.db.execute('SELECT settings FROM connections WHERE id=?', (ident,)).fetchone()
            token = self.tokens.get(ident)
            if not row:
                raise ValueError('Save an integration workspace first.')
            settings = json.loads(row[0])
        if settings.get('auth_method') == 'databricks_cli':
            # Resolve afresh before every test/import; the CLI refreshes its OAuth cache.
            return settings, access_token(settings)
        if not token:
            raise ValueError('Save a connection with a token first. Tokens must be re-entered after server restart.')
        return settings, token

    def delete(self, ident):
        with self.lock, self.db:
            self.tokens.pop(ident, None)
            self.db.execute('DELETE FROM connections WHERE id=?', (ident,))

    def save_capture(self, capture):
        ident = capture['checkpoint']['capture_id']
        with self.lock, self.db:
            self.db.execute('INSERT INTO captures VALUES (?,?)', (ident, json.dumps(capture)))
            self.db.execute('INSERT OR REPLACE INTO active_capture VALUES (1,?)', (ident,))

    def capture(self, ident=None):
        with self.lock:
            if ident is None:
                row = self.db.execute('SELECT id FROM active_capture WHERE slot=1').fetchone()
                ident = row[0] if row else None
            row = self.db.execute('SELECT payload FROM captures WHERE id=?', (ident,)).fetchone()
            return json.loads(row[0]) if row else None

    def activate_capture(self, ident):
        with self.lock, self.db:
            if not self.db.execute('SELECT 1 FROM captures WHERE id=?', (ident,)).fetchone():
                raise ValueError('Replay capture not found.')
            self.db.execute('INSERT OR REPLACE INTO active_capture VALUES (1,?)', (ident,))

    def close(self):
        with self.lock:
            self.tokens.clear()
            self.db.close()
