"""Verify event broker boundaries without printing credentials or message payloads."""
import json
import re
import subprocess
import sys

expected_image = sys.argv[1]
assert re.fullmatch(r'nats:2\.15\.2-alpine@sha256:[a-f0-9]{64}', expected_image)


def inspect(kind, name):
    return json.loads(subprocess.check_output(['docker', kind, 'inspect', name], text=True))[0]


broker = inspect('container', 'anico-dev-events')
assert broker['Config']['Image'] == expected_image
assert broker['State']['Health']['Status'] == 'healthy'
assert not broker['HostConfig']['PortBindings']
assert broker['HostConfig']['ReadonlyRootfs']
assert broker['Config']['User'] == '1000:1000'
assert broker['Config']['Labels']['com.anico.managed-by'] == 'ansible'
assert broker['HostConfig']['LogConfig']['Type'] == 'local'
assert set(broker['NetworkSettings']['Networks']) == {'anico-dev-events'}
assert inspect('network', 'anico-dev-events')['Internal']
assert any(mount.get('Name') == 'anico-dev-events-data' and mount['Destination'] == '/data' for mount in broker['Mounts'])
print('Verified healthy non-root broker, private network, persistent data and no published ports.')
