import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createIdentityVerifier } from '@anico/auth';
import { createLocalJWKSet } from 'jose';
import {
  startDevelopmentRelay,
  developmentRelayClient,
  DEV_AUTH_ISSUER,
  DEV_AUTH_AUDIENCE,
} from '../../apps/frontend/dev-app-auth.mjs';
import { createDevApiProxy } from '../../apps/frontend/dev-api-proxy.mjs';
import { createApiProxy } from '../../apps/frontend/vite-proxy.mjs';

const random = () => randomBytes(32).toString('base64url');
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
async function raw(url, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      res.resume();
      res.once('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test(
  'real local bridge and Vite keep credentials in Node, verify signed identities and reject cross-site or forged requests',
  { timeout: 30000 },
  async () => {
    const keys = await generateKeyPair('ES256');
    const jwks = {
      keys: [
        {
          ...(await exportJWK(keys.publicKey)),
          alg: 'ES256',
          kid: 'development-test',
        },
      ],
    };
    const user = {
      userId: randomUUID(),
      givenName: 'Dev',
      familyName: 'Example',
      email: 'dev@example.test',
      roles: ['breeder'],
    };
    const access = 'private-cli-access-for-test';
    const grants = new Map(),
      sessions = new Map(),
      requests = [],
      backendRequests = [];
    const cloud = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url, 'http://cloud.example.test');
        if (url.pathname === '/api/auth/development/authorize') {
          assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
          const code = random(),
            redirectUri = url.searchParams.get('redirect_uri');
          grants.set(code, {
            redirectUri,
            challenge: url.searchParams.get('code_challenge'),
          });
          const callback = new URL(redirectUri);
          callback.searchParams.set('code', code);
          callback.searchParams.set('state', url.searchParams.get('state'));
          res.writeHead(303, { Location: callback.href });
          res.end();
          return;
        }
        requests.push({ path: url.pathname, headers: req.headers });
        if (req.headers['cf-access-token'] !== access)
          return json(res, 403, {});
        let text = '';
        for await (const part of req) text += part;
        const data = text ? JSON.parse(text) : {};
        if (url.pathname === '/api/auth/.well-known/jwks.json')
          return json(res, 200, jwks);
        if (url.pathname === '/api/auth/providers')
          return json(res, 200, { providers: ['google', 'microsoft'] });
        if (url.pathname === '/api/auth/development/token') {
          const grant = grants.get(data.code);
          if (
            !grant ||
            grant.redirectUri !== data.redirect_uri ||
            grant.challenge !==
              createHash('sha256')
                .update(data.code_verifier)
                .digest('base64url')
          )
            return json(res, 401, {});
          grants.delete(data.code);
          const token = random();
          sessions.set(token, new URL(data.redirect_uri).origin);
          return json(res, 200, {
            access_token: token,
            token_type: 'Bearer',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          });
        }
        const token = req.headers['x-anico-development-token'];
        if (!sessions.has(token) || sessions.get(token) !== req.headers.origin)
          return json(res, 401, {});
        if (url.pathname === '/api/auth/development/logout') {
          sessions.delete(token);
          res.writeHead(204);
          res.end();
          return;
        }
        if (url.pathname === '/api/auth/session')
          return json(res, 200, {
            identity: user,
            csrfToken: 'test-csrf',
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            linkedProviders: ['google'],
          });
        if (url.pathname === '/api/auth/development/identity') {
          const token = await new SignJWT({ identity: user })
            .setProtectedHeader({
              alg: 'ES256',
              kid: 'development-test',
              typ: 'anico-identity+jwt',
            })
            .setIssuer(DEV_AUTH_ISSUER)
            .setAudience(DEV_AUTH_AUDIENCE)
            .setSubject(user.userId)
            .setJti(randomUUID())
            .setIssuedAt()
            .setExpirationTime('30s')
            .sign(keys.privateKey);
          return json(res, 200, {
            identityToken: token,
            expiresAt: new Date(Date.now() + 30000).toISOString(),
          });
        }
        res.setHeader('x-anico-development-token', token);
        res.setHeader('cf-access-token', access);
        res.setHeader(
          'set-cookie',
          '__Host-anico-session=not-for-local-browser; Secure; HttpOnly',
        );
        json(res, 200, { userId: user.userId, roles: user.roles });
      })().catch(() => json(res, 500, { error: 'Test server failed' }));
    });
    const verify = createIdentityVerifier({
      key: createLocalJWKSet(jwks),
      issuer: DEV_AUTH_ISSUER,
      audience: DEV_AUTH_AUDIENCE,
    });
    const backend = createServer((req, res) => {
      void (async () => {
        backendRequests.push(req.headers);
        try {
          const identity = await verify(req.headers['x-anico-identity']);
          res.setHeader('x-anico-identity', req.headers['x-anico-identity']);
          json(res, 200, { userId: identity.userId, roles: identity.roles });
        } catch {
          json(res, 401, {});
        }
      })();
    });
    let relay, vite;
    try {
      const remoteOrigin = await listen(cloud),
        backendOrigin = await listen(backend);
      relay = await startDevelopmentRelay({
        accessSession: { getToken: async () => access },
        remoteOrigin,
        appOrigin: 'http://127.0.0.1:5173',
        backend: {
          prefix: '/api/animal',
          port: Number(new URL(backendOrigin).port),
        },
      });
      const client = developmentRelayClient(relay.origin, relay.relayKey);
      assert.deepEqual(await client.publicKeys(), jwks);
      await assert.rejects(client.session(), (e) => e.status === 401);
      assert.equal(
        (await fetch(relay.origin + '/rpc/identity', { method: 'POST' }))
          .status,
        403,
      );
      assert.equal(
        (
          await fetch(relay.origin + '/rpc/identity', {
            method: 'POST',
            headers: {
              'x-anico-relay-key': relay.relayKey,
              Origin: 'https://attacker.example.test',
            },
          })
        ).status,
        403,
      );
      const login = await client.beginLogin('google');
      assert.ok(!login.includes(access));
      assert.ok(!login.includes(relay.relayKey));
      const native = await fetch(login, { redirect: 'manual' });
      const callback = new URL(native.headers.get('location'));
      const wrong = new URL(callback);
      wrong.searchParams.set('state', random());
      assert.equal((await fetch(wrong, { redirect: 'manual' })).status, 401);
      assert.equal((await fetch(callback, { redirect: 'manual' })).status, 303);
      assert.equal((await fetch(callback, { redirect: 'manual' })).status, 401);
      const session = await client.session();
      await Promise.all(
        Array.from({ length: 8 }, () => client.identityToken()),
      );
      assert.equal(
        requests.filter((r) => r.path === '/api/auth/development/identity')
          .length,
        1,
      );
      assert.equal(session.identity.userId, user.userId);
      assert.equal(session.canManageAccounts, false);
      assert.ok(!JSON.stringify(session).includes(access));
      assert.ok(!JSON.stringify(session).includes(relay.relayKey));
      const require = createRequire(
        new URL('../../apps/frontend/package.json', import.meta.url),
      );
      const { createServer: createViteServer } = await import(
        pathToFileURL(require.resolve('vite')).href
      );
      const proxy = createDevApiProxy(
        { getToken: async () => access },
        { target: remoteOrigin, localPrefix: '/api/animal', appAuth: client },
      );
      const local = createApiProxy(
        [{ name: 'animal-service', port: Number(new URL(backendOrigin).port) }],
        'animal-service',
        { alias: false },
      );
      for (const options of Object.values(local))
        options.configure = (server) => proxy.configureLocal(server);
      vite = await createViteServer({
        configFile: false,
        appType: 'custom',
        logLevel: 'silent',
        plugins: [proxy.plugin],
        server: {
          host: '127.0.0.1',
          port: 0,
          cors: false,
          proxy: { ...local, ...proxy.proxy },
        },
      });
      await vite.listen();
      const localOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
      const forged = {
        'x-user-id': randomUUID(),
        'x-user-roles': 'owner',
        'x-anico-identity': 'forged',
        'x-anico-development-token': 'forged',
        'cf-access-token': 'forged',
        authorization: 'Bearer forged',
        Cookie: 'CF_Authorization=forged; __Host-anico-session=forged',
      };
      const localResponse = await fetch(localOrigin + '/api/animal', {
        headers: forged,
      });
      assert.equal(localResponse.status, 200);
      assert.deepEqual(await localResponse.json(), {
        userId: user.userId,
        roles: ['breeder'],
      });
      assert.equal(localResponse.headers.get('x-anico-identity'), null);
      const seen = backendRequests.at(-1);
      assert.equal(seen['cf-access-token'], undefined);
      assert.equal(seen['x-anico-development-token'], undefined);
      assert.equal(seen.cookie, undefined);
      assert.equal(seen['x-user-roles'], undefined);
      assert.equal((await fetch(backendOrigin)).status, 401);
      const remote = await fetch(localOrigin + '/api/other', {
        headers: forged,
      });
      assert.equal(remote.status, 200);
      assert.deepEqual(await remote.json(), {
        userId: user.userId,
        roles: ['breeder'],
      });
      assert.equal(remote.headers.get('x-anico-development-token'), null);
      assert.equal(remote.headers.get('cf-access-token'), null);
      assert.equal(remote.headers.get('set-cookie'), null);
      const upstream = requests.at(-1);
      assert.equal(upstream.headers['cf-access-token'], access);
      assert.ok(sessions.has(upstream.headers['x-anico-development-token']));
      assert.equal(upstream.headers.cookie, undefined);
      for (const path of [
        '/api/auth/development/identity',
        '/api/auth/%64evelopment/identity',
        '/api/auth//development/identity',
      ])
        assert.equal(
          (await fetch(localOrigin + path, { method: 'POST' })).status,
          403,
        );
      assert.equal(
        await raw(localOrigin + '/api/animal', {
          Origin: 'https://attacker.example.test',
        }),
        403,
      );
      assert.equal(
        await raw(localOrigin + '/api/animal', {
          'Sec-Fetch-Site': 'cross-site',
        }),
        403,
      );
      assert.equal(
        await raw(localOrigin + '/api/animal', {
          Host: 'attacker.example.test',
        }),
        403,
      );
      assert.equal((await fetch(relay.origin + '/api/animal')).status, 200);
      assert.equal(
        (await fetch(localOrigin + '/api/auth/session')).status,
        200,
      );
      assert.equal(
        (
          await fetch(localOrigin + '/api/auth/logout', {
            method: 'POST',
            headers: { Origin: localOrigin },
          })
        ).status,
        204,
      );
      assert.equal(
        (await fetch(localOrigin + '/api/auth/session')).status,
        401,
      );
      assert.equal((await fetch(localOrigin + '/api/animal')).status, 401);
      assert.equal(sessions.size, 0);
      const cancel = await fetch(await client.beginLogin('google'), {
        redirect: 'manual',
      });
      await client.logout();
      assert.equal(
        (await fetch(cancel.headers.get('location'), { redirect: 'manual' }))
          .status,
        401,
      );
      await assert.rejects(client.session(), (e) => e.status === 401);
    } finally {
      await vite?.close();
      await relay?.close();
      await close(backend);
      await close(cloud);
    }
  },
);
