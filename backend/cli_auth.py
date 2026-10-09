"""Resolve a named CLI OAuth profile without exposing or persisting its tokens."""
import configparser
import json
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import urlsplit


def profile_host(profile):
    config = configparser.ConfigParser(interpolation=None)
    path = Path(os.environ.get('DATABRICKS_CONFIG_FILE', str(Path.home() / '.databrickscfg')))
    try:
        with path.open() as stream:
            config.read_file(stream)
        if config.get(profile, 'auth_type', fallback='') != 'databricks-cli':
            raise ValueError('Use a named OAuth profile created with databricks auth login.')
        try:
            parts = urlsplit(config.get(profile, 'host', fallback='').strip())
            valid = (parts.scheme == 'https' and parts.hostname and parts.path in ('', '/')
                     and not (parts.query or parts.fragment or parts.username or parts.password or parts.port))
        except ValueError:
            valid = False
        if not valid:
            raise ValueError('The CLI profile must contain a workspace URL without a path or query.')
        return f'https://{parts.hostname}'
    except (OSError, configparser.Error):
        raise ValueError('The CLI profile could not be read. Run databricks auth login for this workspace.') from None


def check_profile(settings):
    if not shutil.which('databricks'):
        raise ValueError('Install the Databricks CLI on the machine running this app.')
    if profile_host(settings['cli_profile']) != settings['host']:
        raise ValueError('The CLI profile belongs to a different workspace. Use a profile matching the workspace URL.')


def access_token(settings):
    check_profile(settings)
    # A named profile and explicit host are the only authentication inputs.
    # Ambient PAT/host/account variables must not override the selected profile.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('DATABRICKS_') or key == 'DATABRICKS_CONFIG_FILE'}
    try:
        result = subprocess.run([
            'databricks', 'auth', 'token', '--profile', settings['cli_profile'],
            '--host', settings['host'], '--timeout', '20s'],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30, env=env)
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        # Never include subprocess output, which can contain credentials even on failure.
        raise ValueError('CLI authentication could not complete. Check the CLI installation and sign in again.') from None
    if result.returncode:
        raise ValueError('CLI authentication failed. Run databricks auth login with this workspace and profile, then retry.')
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError('The CLI returned an invalid authentication response. Update the CLI or sign in again.') from None
    token = payload.get('access_token') if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token or any(c.isspace() for c in token):
        raise ValueError('The CLI returned no usable OAuth access token. Update the CLI or sign in again.')
    return token
