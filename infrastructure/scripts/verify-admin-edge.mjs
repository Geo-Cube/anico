import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const access = JSON.parse(
  readFileSync(new URL('../access.json', import.meta.url), 'utf8'),
);
assert.equal(
  access.publish.administration,
  true,
  'Administration is not published',
);
const address = `https://${access.administratorHostname}/`;
async function request(url, headers = {}) {
  return fetch(url, {
    redirect: 'manual',
    headers,
    signal: AbortSignal.timeout(15_000),
  });
}
const anonymous = await request(address);
assert.ok(
  [302, 303, 307, 308].includes(anonymous.status),
  `Anonymous response must redirect to Access (${anonymous.status})`,
);
const login = new URL(anonymous.headers.get('location'));
assert.ok(login.hostname.endsWith('.cloudflareaccess.com'));
assert.ok(login.pathname.startsWith('/cdn-cgi/access/login'));
const invalid = await request(address, { Cookie: 'CF_Authorization=invalid' });
assert.ok(
  [302, 303, 307, 308, 401, 403].includes(invalid.status),
  `Invalid Access token was not rejected (${invalid.status})`,
);
if (invalid.headers.has('location')) {
  assert.ok(
    new URL(invalid.headers.get('location'), address).hostname.endsWith(
      '.cloudflareaccess.com',
    ),
  );
}
const http = await request(`http://${access.administratorHostname}/`);
assert.ok([301, 302, 303, 307, 308].includes(http.status));
assert.equal(new URL(http.headers.get('location')).protocol, 'https:');
console.log(
  'Public admin checks passed: anonymous Access login, invalid-token rejection and HTTPS redirect.',
);
console.log(
  'Email OTP and the authenticated browser session must be verified by the administrator.',
);
