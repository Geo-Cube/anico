"""Verify running development images and boundaries without printing credentials."""
import json
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

identity = sys.argv[1]
assert re.fullmatch(r'[A-Za-z0-9-]{8,100}', identity)


def inspect(name):
    result = subprocess.run(['docker', 'inspect', name], capture_output=True, text=True)
    return json.loads(result.stdout)[0] if result.returncode == 0 else None


containers = None
for attempt in range(40):
    containers = {name: inspect(name + '-' + identity) for name in ['backend', 'frontend']}
    if all(value and value['State'].get('Health', {}).get('Status') == 'healthy' for value in containers.values()):
        break
    time.sleep(3)
else:
    raise RuntimeError('Development containers did not become healthy; inspect Coolify')

revisions = set()
for name, container in containers.items():
    assert not container['HostConfig']['PortBindings'], 'Unexpected published port'
    assert container['HostConfig']['ReadonlyRootfs']
    assert container['HostConfig']['CapDrop'] == ['ALL']
    assert any(option.startswith('no-new-privileges') for option in container['HostConfig']['SecurityOpt'])
    assert container['Config']['User'] not in ['', '0', 'root']
    assert container['Config']['Labels']['com.anico.environment'] == 'dev'
    revision = container['Config']['Labels']['com.anico.revision']
    assert re.fullmatch('[a-f0-9]{40}', revision)
    revisions.add(revision)
    repository = 'breeding-service' if name == 'backend' else 'frontend'
    assert re.fullmatch('ghcr.io/geo-cube/anico-' + repository + '@sha256:[a-f0-9]{64}', container['Config']['Image'])
    networks = set(container['NetworkSettings']['Networks'])
    assert 'anico-dev-app' in networks
    assert networks <= {'anico-dev-app', 'anico-dev-data', identity}
    if name == 'frontend':
        assert 'anico-dev-data' not in networks
        assert not any(value.startswith('MONGODB_URI=') for value in container['Config']['Env'])
    else:
        assert 'anico-dev-data' in networks
        assert not any(value.startswith('MONGODB_URI=') for value in container['Config']['Env'])
        assert any(mount['Destination'] == '/run/secrets/dev-mongodb-uri' and not mount['RW'] for mount in container['Mounts'])
        uri = urlsplit(subprocess.check_output(['docker', 'exec', 'backend-' + identity, 'cat', '/run/secrets/dev-mongodb-uri'], text=True).strip())
        assert uri.hostname == 'anico-dev-mongodb'
        assert uri.username == 'anico_dev_app'
        assert uri.path == '/anico_breeding'
assert len(revisions) == 1, 'Mixed release revisions'


def request(path):
    return subprocess.check_output(['docker', 'exec', 'coolify-proxy', 'wget', '-qO-',
                                    '--header=Host: dev.anico.online', 'http://127.0.0.1' + path], text=True)


assert '<html' in request('/').lower()
assert json.loads(request('/api/ready'))['status'] == 'ok'
release = json.loads(request('/anico-release-' + next(iter(revisions)) + '.json'))
assert release['revision'] in revisions
assert release['images']['frontend'] == containers['frontend']['Config']['Image']
assert release['images']['breeding-service'] == containers['backend']['Config']['Image']
print('Verified healthy matching dev images, frontend and /api/ready routing, non-root/read-only containers, private ports and separate DB credentials/networks.')
