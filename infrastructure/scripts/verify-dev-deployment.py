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


REPOSITORIES = {'backend': 'breeding-service', 'frontend': 'frontend', 'auth': 'auth-service',
                'animal': 'animal-service', 'breeder': 'breeder-service'}


def request(path):
    return subprocess.check_output(['docker', 'exec', 'coolify-proxy', 'wget', '-qO-',
                                    '--header=Host: dev.anico.online', 'http://127.0.0.1' + path], text=True)


def wait_healthy(names):
    for attempt in range(40):
        found = {name: inspect(name + '-' + identity) for name in names}
        if all(value and value['State'].get('Health', {}).get('Status') == 'healthy' for value in found.values()):
            return found
        time.sleep(3)
    raise RuntimeError('Development containers did not become healthy; inspect Coolify')


# Povinné komponenty určuje release manifest požadované revize, ne existence kontejnerů.
frontend = wait_healthy(['frontend'])['frontend']
release = json.loads(request('/anico-release-' + frontend['Config']['Labels']['com.anico.revision'] + '.json'))
names = [name for name, repository in REPOSITORIES.items() if repository in release['images']]
assert {'backend', 'frontend', 'auth'} <= set(names), 'Release manifest misses a required component'
containers = wait_healthy(names)

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
    repository = REPOSITORIES[name]
    assert re.fullmatch('ghcr.io/geo-cube/anico-' + repository + '@sha256:[a-f0-9]{64}', container['Config']['Image'])
    networks = set(container['NetworkSettings']['Networks'])
    assert 'anico-dev-app' in networks
    assert not any(value.startswith(('NATS_PASSWORD=', 'NATS_URL=', 'NATS_USER=', 'BREEDER_VERIFICATION_BROKER_PASSWORD=', 'ANIMAL_VERIFICATION_BROKER_PASSWORD=')) for value in container['Config']['Env'])
    publisher_enabled = 'AUTH_REGISTRATION_PUBLISHER_ENABLED=true' in container['Config']['Env']
    allowed_networks = {'anico-dev-app', 'anico-dev-data', identity}
    if (name == 'auth' and publisher_enabled) or name in ('animal', 'breeder'):
        allowed_networks.add('anico-dev-events')
    assert networks <= allowed_networks
    if name == 'frontend':
        assert 'anico-dev-events' not in networks
        assert 'anico-dev-data' not in networks
        assert not any(value.startswith('MONGODB_URI=') for value in container['Config']['Env'])
    elif name == 'backend':
        assert 'anico-dev-events' not in networks
        assert 'anico-dev-data' in networks
        assert not any(value.startswith('MONGODB_URI=') for value in container['Config']['Env'])
        assert any(mount['Destination'] == '/run/secrets/dev-mongodb-uri' and not mount['RW'] for mount in container['Mounts'])
        uri = urlsplit(subprocess.check_output(['docker', 'exec', 'backend-' + identity, 'cat', '/run/secrets/dev-mongodb-uri'], text=True).strip())
        assert uri.hostname == 'anico-dev-mongodb'
        assert uri.username == 'anico_dev_app'
        assert uri.path == '/anico_breeding'
    elif name in ('animal', 'breeder'):
        assert 'anico-dev-events' in networks
        broker_secret = '/run/secrets/' + name + '-verification-broker-json'
        assert name.upper() + '_VERIFICATION_BROKER_FILE=' + broker_secret in container['Config']['Env']
        assert any(mount['Destination'] == broker_secret and not mount['RW'] for mount in container['Mounts'])
        broker_credentials = json.loads(subprocess.check_output(['docker', 'exec', name + '-' + identity, 'cat', broker_secret], text=True))
        assert broker_credentials['server'] == 'nats://anico-dev-events:4222'
        assert broker_credentials['user'] == ('breeder-publisher' if name == 'breeder' else 'animal-consumer')
        assert re.fullmatch(r'[a-f0-9]{64}', broker_credentials['password'])
        assert all(broker_credentials['password'] not in value for value in container['Config']['Env'])
        assert not any(value.startswith('BREEDER_SERVICE_URL=') for value in container['Config']['Env'])
        assert 'anico-dev-data' in networks
        assert not any(value.startswith('MONGODB_URI=') for value in container['Config']['Env'])
        secret = '/run/secrets/' + name + '-mongodb-uri'
        assert any(mount['Destination'] == secret and not mount['RW'] for mount in container['Mounts'])
        uri = urlsplit(subprocess.check_output(['docker', 'exec', name + '-' + identity, 'cat', secret], text=True).strip())
        assert uri.hostname == 'anico-dev-mongodb'
        assert uri.username == 'anico_' + name + '_dev_app'
        assert uri.path == '/anico_' + name
    else:
        assert 'anico-dev-data' in networks
        assert not any(value.startswith(('MONGODB_URI=', 'GOOGLE_CLIENT_SECRET=')) for value in container['Config']['Env'])
        assert len(container['Mounts']) >= 4
        if publisher_enabled:
            assert 'anico-dev-events' in networks
            assert any(mount['Destination'] == '/run/secrets/auth-registration-broker-json' and not mount['RW'] for mount in container['Mounts'])
        assert not any(value.startswith(('NATS_PASSWORD=', 'NATS_URL=')) for value in container['Config']['Env'])
assert len(revisions) == 1, 'Mixed release revisions'

assert '<html' in request('/').lower()
assert json.loads(request('/api/ready'))['status'] == 'ok'
assert release['revision'] in revisions
for name, container in containers.items():
    assert release['images'][REPOSITORIES[name]] == container['Config']['Image']
for name in ('animal', 'breeder'):
    if name in containers:
        assert json.loads(request('/api/' + name + '/ready'))['status'] == 'ok'
print('Verified healthy matching dev images, frontend and API readiness routing, non-root/read-only containers, private ports and separate DB credentials/networks.')
