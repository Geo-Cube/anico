"""Inspect only nonsecret runtime properties of the managed shared monitoring."""
import json
from pathlib import Path
import subprocess
import sys

settings = json.loads(Path(sys.argv[1]).read_text())
assert sys.argv[2] in ('ingest', 'no-ingest')
ingest = sys.argv[2] == 'ingest'
with open('/srv/anico/shared/monitoring/compose.json', encoding='utf8') as handle:
    tunnel_image = json.load(handle)['services']['tunnel']['image']


def inspect(kind, name):
    return json.loads(subprocess.check_output(['docker', kind, 'inspect', name], text=True))[0]


expected = {
    settings['containerName']: (settings['image'], '5000:5000', 512, {settings['network'], settings['appNetwork']}),
    settings['databaseContainerName']: (settings['databaseImage'], '70:70', 256, {settings['network']}),
    settings['tunnelContainerName']: (tunnel_image, '65532:65532', 64, {settings['appNetwork']}),
}
secret_variables = ('SECRET_KEY=', 'DATABASE_URL=', 'POSTGRES_PASSWORD=', 'TUNNEL_TOKEN=')
for name, (image, user, memory_mib, networks) in expected.items():
    container = inspect('container', name)
    assert container['Config']['Image'] == image, name
    assert container['State']['Health']['Status'] == 'healthy', name
    assert not container['HostConfig']['PortBindings'], 'Unexpected public port on ' + name
    assert container['HostConfig']['ReadonlyRootfs'], name
    assert container['HostConfig']['CapDrop'] == ['ALL'], name
    assert any(option.startswith('no-new-privileges') for option in container['HostConfig']['SecurityOpt']), name
    assert container['HostConfig']['Memory'] == memory_mib * 1024 * 1024, name
    assert container['Config']['User'] == user, name
    labels = container['Config']['Labels']
    assert labels['com.anico.managed-by'] == 'ansible', name
    assert labels['com.anico.environment'] == 'shared', name
    assert labels['com.anico.role'] == 'monitoring', name
    assert container['HostConfig']['LogConfig'] == {'Type': 'local', 'Config': {'max-file': '3', 'max-size': '10m'}}, name
    assert set(container['NetworkSettings']['Networks']) == networks, name
    assert not any(value.startswith(secret_variables) for value in container['Config']['Env']), name
glitchtip = inspect('container', settings['containerName'])
assert (glitchtip['Config']['Labels'].get('traefik.enable') == 'true') == ingest
assert 'ENABLE_USER_REGISTRATION=false' in glitchtip['Config']['Env']
assert 'DJANGO_SETTINGS_MODULE=anico_settings' in glitchtip['Config']['Env']
# GitHub OAuth údaje zná jen bootstrap ze souboru, nikdy prostředí kontejneru.
assert not any('github' in value.lower() for value in glitchtip['Config']['Env'])
database = inspect('container', settings['databaseContainerName'])
assert any(mount.get('Name') == settings['databaseVolume'] and mount['Destination'] == '/var/lib/postgresql' for mount in database['Mounts'])
assert any(mount.get('Name') == settings['uploadsVolume'] and mount['Destination'] == '/code/uploads' for mount in glitchtip['Mounts'])
assert inspect('network', settings['network'])['Internal']
print('Verified: healthy GlitchTip, private PostgreSQL and dedicated tunnel; memory limits, non-root read-only runtime, exact networks, no published ports or secret environment values.')
