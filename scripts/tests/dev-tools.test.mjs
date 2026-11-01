import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadRemoteWorkspace,
  loadPersonalEnvironment,
  assertAvailablePort,
} from '../dev-workspace.mjs';
import { prepareAppEnvironments } from '../setup.mjs';
import { remoteArguments } from '../remote-dev-config.mjs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('setup creates missing app environments but preserves existing and private configurations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-setup-'));
  try {
    for (const name of ['first-service', 'second-service', 'frontend']) {
      await mkdir(join(root, 'apps', name), { recursive: true });
      await writeFile(join(root, 'apps', name, '.env.example'), 'PORT=3001\n');
    }
    await writeFile(join(root, 'apps/second-service/.env'), 'PORT=4001\n');
    await writeFile(join(root, '.env.remote.local'), 'private sentinel');
    assert.deepEqual((await prepareAppEnvironments(root)).sort(), [
      'first-service',
      'frontend',
    ]);
    assert.equal(
      await readFile(join(root, 'apps/second-service/.env'), 'utf8'),
      'PORT=4001\n',
    );
    assert.equal(
      await readFile(join(root, '.env.remote.local'), 'utf8'),
      'private sentinel',
    );
    assert.deepEqual(await prepareAppEnvironments(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace diagnostics identify missing manifest, invalid name and missing public configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-diagnostics-'));
  try {
    assert.throws(
      () => loadRemoteWorkspace(root, 'animal-service'),
      /Missing apps\/animal-service\/package.json/,
    );
    const folder = join(root, 'apps/animal-service');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), '{');
    assert.throws(
      () => loadRemoteWorkspace(root, 'animal-service'),
      /Invalid or unreadable/,
    );
    const manifest = {
      name: '@anico/animal-service',
      scripts: { dev: 'tsx' },
      dependencies: { mongoose: '*' },
    };
    await writeFile(join(folder, 'package.json'), JSON.stringify(manifest));
    assert.throws(
      () => loadRemoteWorkspace(root, 'animal-service'),
      /\.env.example/,
    );
    await writeFile(join(folder, '.env.example'), 'PORT=3001');
    assert.equal(loadRemoteWorkspace(root, 'animal-service').port, 3001);
    await writeFile(
      join(folder, 'package.json'),
      JSON.stringify({ ...manifest, name: 'animal-service' }),
    );
    assert.throws(
      () => loadRemoteWorkspace(root, 'animal-service'),
      /name @anico\/animal-service/,
    );
    assert.throws(
      () => loadPersonalEnvironment(root, folder),
      /Missing personal/,
    );
    await writeFile(join(folder, '.env.remote.local'), 'service private');
    assert.equal(loadPersonalEnvironment(root, folder), 'service private');
    await writeFile(join(root, '.env.remote.local'), 'root private');
    assert.equal(loadPersonalEnvironment(root, folder), 'root private');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('combined remote launch is explicit and cannot accidentally run with a DB maintenance command', () => {
  assert.equal(
    remoteArguments(['--service', 'animal', '--frontend']).frontend,
    true,
  );
  assert.equal(remoteArguments(['--service', 'animal']).frontend, false);
  assert.equal(remoteArguments([]).frontend, false);
  assert.throws(() =>
    remoteArguments(['--db=reset', '--confirm=db', '--frontend']),
  );
  assert.throws(() => remoteArguments(['--check', '--frontend']));
});

test('port diagnostics report an existing listener without terminating it', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    await assert.rejects(assertAvailablePort(port), /occupied/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await assertAvailablePort(port);
});

test('frontend doctor recognizes the ESM-only shared workspace after its build', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = spawnSync(
    process.execPath,
    ['scripts/doctor.mjs', '--frontend'],
    { cwd: root, encoding: 'utf8', timeout: 10000 },
  );
  assert.match(result.stdout, /OK: Frontend dependencies/);
  assert.doesNotMatch(result.stderr, /FAIL: Frontend dependencies/);
});
