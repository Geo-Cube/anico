"""Inspect only nonsecret runtime properties of the managed developer database."""
import json
from pathlib import Path
import subprocess
import sys

settings = json.loads(Path(sys.argv[1]).read_text())


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name], text=True))[0]


database = inspect(settings['containerName'])
connector = inspect(settings['project'] + '-cloudflared-1')
for container in [database, connector]:
    assert container['State']['Health']['Status'] == 'healthy'
    assert not container['HostConfig']['PortBindings'], 'Unexpected public port'
    assert container['HostConfig']['ReadonlyRootfs']
    assert container['HostConfig']['CapDrop'] == ['ALL']
    assert any(option.startswith('no-new-privileges') for option in container['HostConfig']['SecurityOpt'])
    assert container['Config']['Labels']['com.anico.managed-by'] == 'ansible'
    assert container['Config']['Labels']['com.anico.environment'] == 'dev'
    assert container['HostConfig']['LogConfig'] == {'Type': 'local', 'Config': {'max-file': '3', 'max-size': '10m'}}
assert database['Config']['Image'] == settings['image']
assert database['Config']['User'] == '999:999'
assert set(database['NetworkSettings']['Networks']) == {settings['dataNetwork']}
assert set(connector['NetworkSettings']['Networks']) == {settings['dataNetwork'], settings['egressNetwork']}
assert any(mount.get('Name') == settings['volume'] and mount['Destination'] == '/data/db' for mount in database['Mounts'])
assert not any(value.startswith('MONGO_INITDB_ROOT_PASSWORD=') for value in database['Config']['Env'])
print('Verified: healthy private DB, dedicated tunnel, non-root/read-only runtime, correct volume, no published ports or management/prod network access.')
