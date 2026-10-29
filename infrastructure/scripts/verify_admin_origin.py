#!/usr/bin/env python3
"""Verify private admin routing and secure forwarded headers without printing credentials."""
import base64
import http.client
import json
import os
import socket
import subprocess
from pathlib import Path

root = Path('/data/coolify/source')
access = json.loads((root / 'anico/access.json').read_text())
assert access['publish']['administration'], 'Administration is not enabled'
hostname = access['administratorHostname']
proxy = json.loads(subprocess.check_output(['docker', 'inspect', 'coolify-proxy']))[0]
address = proxy['NetworkSettings']['Networks']['coolify']['IPAddress']
headers = {'Host': hostname, 'X-Forwarded-Proto': 'https'}
connection = http.client.HTTPConnection(address, 80, timeout=15)
connection.request('GET', '/login', headers=headers)
response = connection.getresponse()
body = response.read().decode()
assert response.status == 200, 'Private admin login routing failed'
assert f'https://{hostname}' in body, 'Secure application URLs were not generated'
assert f'http://{hostname}' not in body, 'Application generated insecure absolute URLs'
connection.close()

sso_path = root / 'anico/sso.json'
if sso_path.exists() and json.loads(sso_path.read_text()).get('only'):
    assert '/auth/github/redirect' in body, 'SSO login button is missing'
    assert 'name="password"' not in body, 'Public login still offers a password'
    for method, path in [('POST', '/login'), ('POST', '/login/'), ('GET', '/auth/link'),
                         ('GET', '/forgot-password'), ('POST', '/reset-password')]:
        connection = http.client.HTTPConnection(address, 80, timeout=15)
        # A spoofed forwarding header must not bypass the recovery restriction.
        connection.request(method, path, headers={**headers, 'X-Forwarded-For': '127.0.0.1'})
        response = connection.getresponse()
        response.read()
        assert response.status == 403, 'Public password/recovery route was not blocked'
        connection.close()
    connection = http.client.HTTPConnection('127.0.0.1', 8000, timeout=15)
    connection.request('GET', '/login?recovery=1')
    response = connection.getresponse()
    recovery_body = response.read().decode()
    assert response.status == 200 and 'name="password"' in recovery_body, 'SSH recovery form is unavailable'
    connection.close()
    connection = http.client.HTTPConnection('127.0.0.1', 8000, timeout=15)
    connection.request('POST', '/login')
    response = connection.getresponse()
    response.read()
    assert response.status == 419, 'Direct SSH recovery route must reach Laravel CSRF validation'
    connection.close()

# The browser-visible Reverb app key is public; app secrets are never printed.
env = dict(line.split('=', 1) for line in (root / '.env').read_text().splitlines() if line and not line.startswith('#'))
app_key = json.loads(env['PUSHER_APP_KEY'])
ws_headers = {
    **headers,
    'Upgrade': 'websocket', 'Connection': 'Upgrade',
    'Sec-WebSocket-Version': '13',
    'Sec-WebSocket-Key': base64.b64encode(os.urandom(16)).decode(),
}
connection = http.client.HTTPConnection(address, 80, timeout=15)
connection.request('GET', f'/app/{app_key}?protocol=7&client=js&version=8.4.0&flash=false', headers=ws_headers)
response = connection.getresponse()
assert response.status == 101, f'Realtime WebSocket upgrade failed ({response.status})'
connection.close()
# Coolify deliberately upgrades rejected terminal sessions, then sends close 4401.
with socket.create_connection((address, 80), timeout=15) as stream:
    request = 'GET /terminal/ws HTTP/1.1\r\n' + ''.join(f'{key}: {value}\r\n' for key, value in ws_headers.items()) + '\r\n'
    stream.sendall(request.encode())
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = stream.recv(4096)
        assert chunk, 'Terminal closed before the upgrade response'
        data += chunk
    response_headers, buffer = data.split(b'\r\n\r\n', 1)
    assert response_headers.split(b'\r\n', 1)[0].startswith(b'HTTP/1.1 101 ')
    def read_exact(length):
        global buffer
        while len(buffer) < length:
            chunk = stream.recv(4096)
            assert chunk, 'Terminal closed without a rejection frame'
            buffer += chunk
        result, buffer = buffer[:length], buffer[length:]
        return result
    frame = read_exact(2)
    assert frame[0] & 0x0f == 8 and frame[1] & 0x80 == 0, 'Expected terminal close frame'
    length = frame[1] & 0x7f
    assert 2 <= length <= 125
    payload = read_exact(length)
    assert int.from_bytes(payload[:2], 'big') == 4401, 'Terminal did not reject the missing authentication'
print('Private admin HTTP routing, HTTPS URLs, realtime WebSocket and terminal authentication checks passed.')
