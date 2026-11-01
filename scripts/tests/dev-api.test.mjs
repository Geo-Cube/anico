import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createAccessSession } from '../../apps/frontend/dev-access.mjs';
import { createDevApiProxy } from '../../apps/frontend/dev-api-proxy.mjs';
import { createApiProxy } from '../../apps/frontend/vite-proxy.mjs';

const jwt = (exp) =>
  `test.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
test('Access session uses captured CLI output, shares concurrent login and refreshes expiring tokens', async () => {
  let now = 1000000;
  let signedIn = false;
  const calls = [];
  const messages = [];
  const session = createAccessSession({
    now: () => now,
    notify: (value) => messages.push(value),
    run: async (_command, args) => {
      calls.push(args);
      if (args[1] === 'login') {
        signedIn = true;
        return { stdout: 'private-output' };
      }
      if (!signedIn) throw new Error('private-output');
      return { stdout: jwt(now / 1000 + 120) };
    },
  });
  const [first, second] = await Promise.all([
    session.getToken(),
    session.getToken(),
  ]);
  assert.equal(first, second);
  assert.equal(calls.filter((args) => args[1] === 'login').length, 1);
  assert.ok(calls.find((args) => args.includes('--quiet')));
  assert.equal(await session.getToken(), first);
  assert.equal(calls.length, 3);
  now += 90000;
  assert.notEqual(await session.getToken(), first);
  assert.equal(calls.length, 4);
  assert.ok(!messages.join().includes('private-output'));
  const broken = createAccessSession({
    notify: () => {},
    run: async () => {
      throw new Error('private-output');
    },
  });
  await assert.rejects(
    broken.getToken(),
    (error) =>
      !error.message.includes('private-output') &&
      /sign-in failed/.test(error.message),
  );
  const missing = createAccessSession({
    run: async () => {
      throw Object.assign(new Error('private-output'), { code: 'ENOENT' });
    },
  });
  await assert.rejects(missing.getToken(), /Install cloudflared/);
});

test(
  'real Vite hybrid proxy keeps personal Access tokens on the remote hop and never falls back from a failed local service',
  { timeout: 30000 },
  async () => {
    const require = createRequire(
      new URL('../../apps/frontend/package.json', import.meta.url),
    );
    const { createServer: createViteServer } = await import(
      pathToFileURL(require.resolve('vite')).href
    );
    const servers = [];
    let vite;
    let denyLogin = false;
    const requests = [];
    const secret = jwt(Date.now() / 1000 + 300);
    const backend = async (name) => {
      const server = createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        requests.push({ name, url: req.url, headers: req.headers, body });
        if (req.url.includes('/denied')) {
          res.writeHead(302, {
            Location: 'https://private.cloudflareaccess.com/login?private=true',
          });
          res.end('private-login-html');
          return;
        }
        if (name === 'local' && req.url === '/failure') {
          res.writeHead(503);
          res.end('local unavailable');
          return;
        }
        if (req.url === '/api/auth/forbidden') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Application role required' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'cf-access-token': secret,
          'Set-Cookie': [
            'CF_Authorization=private; HttpOnly',
            'business=okay; HttpOnly',
          ],
        });
        res.end(JSON.stringify({ name, url: req.url, body }));
      });
      servers.push(server);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return server.address().port;
    };
    try {
      const remotePort = await backend('remote');
      const localPort = await backend('local');
      const remote = createDevApiProxy(
        {
          getToken: async () => {
            if (denyLogin) throw new Error('private');
            return secret;
          },
        },
        {
          target: `http://127.0.0.1:${remotePort}`,
          localPrefix: '/api/animal',
        },
      );
      assert.ok(!JSON.stringify(remote.proxy).includes(secret));
      vite = await createViteServer({
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        plugins: [remote.plugin],
        server: {
          host: '127.0.0.1',
          port: 0,
          proxy: {
            ...createApiProxy(
              [{ name: 'animal-service', port: localPort }],
              'animal-service',
              { alias: false },
            ),
            ...remote.proxy,
          },
        },
      });
      await vite.listen();
      const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
      const local = await fetch(origin + '/api/animal/records?limit=1', {
        method: 'POST',
        body: 'example',
      });
      assert.deepEqual(await local.json(), {
        name: 'local',
        url: '/records?limit=1',
        body: 'example',
      });
      assert.equal(requests[0].headers['cf-access-token'], undefined);
      const shared = await fetch(origin + '/api/auth/users?limit=2', {
        method: 'POST',
        body: 'shared-body',
        headers: {
          'cf-access-token': 'forged',
          cookie: 'CF_Authorization=forged; business=okay',
          authorization: 'Bearer application-session',
        },
      });
      assert.deepEqual(await shared.json(), {
        name: 'remote',
        url: '/api/auth/users?limit=2',
        body: 'shared-body',
      });
      assert.equal(requests[1].headers['cf-access-token'], secret);
      assert.equal(
        requests[1].headers.authorization,
        'Bearer application-session',
      );
      assert.ok(!requests[1].headers.cookie.includes('CF_Authorization'));
      assert.equal(shared.headers.get('cf-access-token'), null);
      assert.ok(!shared.headers.get('set-cookie').includes('CF_Authorization'));
      const legacy = await fetch(origin + '/api/health');
      assert.equal((await legacy.json()).name, 'remote');
      const forbidden = await fetch(origin + '/api/auth/forbidden');
      assert.equal(forbidden.status, 403);
      assert.deepEqual(await forbidden.json(), {
        error: 'Application role required',
      });
      const count = requests.length;
      const failure = await fetch(origin + '/api/animal/failure');
      assert.equal(failure.status, 503);
      assert.equal(requests.length, count + 1);
      assert.equal(requests.at(-1).name, 'local');
      const denied = await fetch(origin + '/api/auth/denied');
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('location'), null);
      assert.ok(!(await denied.text()).includes('private'));
      denyLogin = true;
      const before = requests.length;
      const unauth = await fetch(origin + '/api/auth/users');
      assert.equal(unauth.status, 401);
      assert.equal(requests.length, before);
      // A denied dev session must not prevent work on the selected local API.
      assert.equal((await fetch(origin + '/api/animal/health')).status, 200);
    } finally {
      await vite?.close();
      for (const server of servers)
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
    }
  },
);
