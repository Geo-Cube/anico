import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  createApiProxy,
  discoverLocalBackends,
} from '../../apps/frontend/vite-proxy.mjs';

test('proxy discovers only public local service metadata and rejects invalid ports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-proxy-config-'));
  try {
    for (const name of [
      'breeding-service',
      'animal-service',
      'frontend',
      '.anico-scaffold-test',
    ]) {
      const folder = join(root, 'apps', name);
      await mkdir(folder, { recursive: true });
      if (name.startsWith('.')) continue;
      await writeFile(
        join(folder, 'package.json'),
        JSON.stringify({
          name: `@anico/${name}`,
          dependencies:
            name === 'frontend' ? { react: '*' } : { mongoose: '*' },
        }),
      );
      await writeFile(
        join(folder, '.env.example'),
        `PORT=${name === 'breeding-service' ? 3000 : 3001}\n`,
      );
      await writeFile(
        join(folder, '.env'),
        'PORT=9999\nPRIVATE_SENTINEL=never-read\n',
      );
    }
    const services = discoverLocalBackends(root).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    assert.deepEqual(services, [
      { name: 'animal-service', port: 3001 },
      { name: 'breeding-service', port: 3000 },
    ]);
    assert.throws(() => createApiProxy(services, 'missing-service'), /missing/);
    assert.throws(
      () =>
        createApiProxy([...services, { name: 'other-service', port: 3001 }]),
      /share port/,
    );
    assert.throws(
      () =>
        createApiProxy(
          [{ name: 'animal-service', port: '3001' }],
          'animal-service',
        ),
      /Invalid/,
    );
    assert.throws(
      () =>
        createApiProxy(
          [{ name: 'animal-service|.*', port: 3001 }],
          'animal-service|.*',
        ),
      /Invalid/,
    );
    await writeFile(
      join(root, 'apps/animal-service/.env.example'),
      'PORT=5173',
    );
    assert.throws(() => discoverLocalBackends(root), /Invalid PORT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'real Vite proxy routes prefixes, selected-service alias, queries and POST to the right local backend',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'anico-proxy-http-'));
    const require = createRequire(
      new URL('../../apps/frontend/package.json', import.meta.url),
    );
    const { createServer: createViteServer } = await import(
      pathToFileURL(require.resolve('vite')).href
    );
    const servers = [];
    let vite;
    try {
      const services = [];
      for (const name of [
        'breeding-service',
        'animal-service',
        'animal-care-service',
      ]) {
        const server = createServer((req, res) => {
          req.resume();
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({ service: name, url: req.url, method: req.method }),
          );
        });
        servers.push(server);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        services.push({ name, port: server.address().port });
      }
      vite = await createViteServer({
        configFile: false,
        root,
        appType: 'custom',
        logLevel: 'silent',
        server: {
          host: '127.0.0.1',
          port: 0,
          proxy: createApiProxy(services, 'animal-service'),
        },
      });
      await vite.listen();
      const address = `http://127.0.0.1:${vite.httpServer.address().port}`;
      for (const [path, service, url] of [
        ['/api/animal', 'animal-service', '/'],
        ['/api/animal?limit=1', 'animal-service', '/?limit=1'],
        ['/api/animal/health?probe=1', 'animal-service', '/health?probe=1'],
        ['/api/animal-care/records', 'animal-care-service', '/records'],
        ['/api/breeding/breeding-plans', 'breeding-service', '/breeding-plans'],
        ['/api/health', 'animal-service', '/health'],
      ]) {
        const response = await fetch(address + path);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
          service,
          url,
          method: 'GET',
        });
      }
      const response = await fetch(address + '/api/animal', {
        method: 'POST',
        body: JSON.stringify({ name: 'Example' }),
        headers: { 'Content-Type': 'application/json' },
      });
      assert.deepEqual(await response.json(), {
        service: 'animal-service',
        url: '/',
        method: 'POST',
      });
    } finally {
      await vite?.close();
      for (const server of servers)
        await new Promise((resolve) => {
          server.close(resolve);
          server.closeAllConnections();
        });
      await rm(root, { recursive: true, force: true });
    }
  },
);
