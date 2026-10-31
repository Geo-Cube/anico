const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { copyFile, symlink, access } = require('node:fs/promises');
const {
  createService,
  normalizeName,
} = require('../../turbo/generators/service.cjs');

test('validates service names without allowing paths, shell input or reserved names', () => {
  assert.deepEqual(normalizeName('animal'), {
    name: 'animal-service',
    database: 'anico_animal',
  });
  assert.deepEqual(normalizeName('pet-care-service'), {
    name: 'pet-care-service',
    database: 'anico_pet_care',
  });
  for (const name of [
    '../animal',
    '/tmp/x',
    'Animal',
    'animal;echo',
    '$(id)',
    '@anico/animal',
    '',
    'a--b',
    'frontend',
    'service',
    'infrastructure',
    'x'.repeat(41),
  ]) {
    assert.throws(() => normalizeName(name));
  }
});

test('renders independent workspaces, allocates ports and never copies credentials or overwrites files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-generator-'));
  try {
    await mkdir(join(root, 'apps/breeding-service'), { recursive: true });
    await writeFile(
      join(root, 'apps/breeding-service/.env.example'),
      'PORT=3000\n',
    );
    await writeFile(
      join(root, 'apps/breeding-service/.env'),
      'PRIVATE_SENTINEL=do-not-copy\n',
    );
    const animal = await createService('animal', root);
    const pet = await createService('pet-care-service', root);
    assert.equal(animal.port, 3001);
    assert.equal(pet.port, 3002);
    const folder = join(root, 'apps', animal.name);
    const manifest = JSON.parse(
      await readFile(join(folder, 'package.json'), 'utf8'),
    );
    assert.equal(manifest.name, '@anico/animal-service');
    for (const dep of [
      'express',
      'mongoose',
      'pino',
      'pino-http',
      'zod',
      '@anico/shared-schemas',
    ])
      assert.ok(manifest.dependencies[dep]);
    for (const dep of [
      'tsx',
      'vitest',
      '@vitest/coverage-v8',
      'supertest',
      'mongodb-memory-server',
      '@types/express',
      '@types/supertest',
      '@types/node',
    ])
      assert.ok(manifest.devDependencies[dep]);
    const environment = await readFile(join(folder, '.env'), 'utf8');
    assert.match(environment, /anico_animal_local/);
    assert.match(environment, /PORT=3001/);
    assert.equal(
      environment,
      await readFile(join(folder, '.env.example'), 'utf8'),
    );
    const policy = await readFile(
      join(folder, 'src/database/policy.ts'),
      'utf8',
    );
    assert.match(policy, /anico_animal_dev_app/);
    assert.doesNotMatch(policy, /breeding/);
    await writeFile(join(folder, 'src/server.ts'), 'user-owned edits\n');
    await assert.rejects(
      createService('animal-service', root),
      /already exists/,
    );
    assert.equal(
      await readFile(join(folder, 'src/server.ts'), 'utf8'),
      'user-owned edits\n',
    );
    for (const file of await readdir(folder, { recursive: true })) {
      if (!/\.(?:ts|json|md|mjs)$/.test(file) && file !== '.env') continue;
      const source = await readFile(join(folder, file), 'utf8');
      assert.doesNotMatch(
        source,
        /__SERVICE_NAME__|__DATABASE__|__PORT__|PRIVATE_SENTINEL/,
      );
    }
    assert.deepEqual((await readdir(join(root, 'apps'))).sort(), [
      'animal-service',
      'breeding-service',
      'pet-care-service',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'generated service typechecks, builds and passes its MongoDB/HTTP coverage suite',
  { timeout: 180000 },
  async () => {
    const repository = join(__dirname, '../..');
    const root = await mkdtemp(join(tmpdir(), 'anico-template-smoke-'));
    const resolveFromBackend = createRequire(
      join(repository, 'apps/breeding-service/package.json'),
    );
    function run(file, args, cwd) {
      const result = spawnSync(process.execPath, [file, ...args], {
        cwd,
        encoding: 'utf8',
        timeout: 150000,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      assert.equal(
        result.status,
        0,
        `${result.error?.message ?? ''}\n${result.stdout}\n${result.stderr}`,
      );
    }
    try {
      await mkdir(join(root, 'apps'));
      await copyFile(
        join(repository, 'tsconfig.base.json'),
        join(root, 'tsconfig.base.json'),
      );
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ private: true }),
      );
      await symlink(
        join(repository, 'node_modules'),
        join(root, 'node_modules'),
        'junction',
      );
      const result = await createService('template-check', root);
      const cwd = join(root, 'apps', result.name);
      const backendModules = join(
        repository,
        'apps/breeding-service/node_modules',
      );
      try {
        await access(backendModules);
        await symlink(backendModules, join(cwd, 'node_modules'), 'junction');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const tsc = resolveFromBackend.resolve('typescript/bin/tsc');
      run(tsc, ['-p', 'tsconfig.test.json', '--noEmit'], cwd);
      run(tsc, ['-p', 'tsconfig.json'], cwd);
      const vitest = join(
        resolveFromBackend.resolve('vitest/package.json'),
        '..',
        'vitest.mjs',
      );
      run(vitest, ['run', '--coverage'], cwd);
      const cli = spawnSync(
        process.execPath,
        ['dist/database/cli.js', 'status', '--shared'],
        { cwd, encoding: 'utf8' },
      );
      assert.equal(cli.status, 1);
      assert.match(cli.stderr, /INVALID_ARGUMENTS/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
