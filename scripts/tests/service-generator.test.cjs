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
  registerDatabaseService,
  createBackendModule,
  createFrontendFeature,
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
    assert.match(policy, /anico_breeding_\$\{suffix\}/);
    assert.doesNotMatch(policy, /\^anico_breeding/);
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
        /__SERVICE_NAME__|__DATABASE__|__PORT__|__MODULE_NAME__|__MODULE_PASCAL__|PRIVATE_SENTINEL/,
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

test('business modules are named, isolated and wired without overwriting existing code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-module-generator-'));
  try {
    await mkdir(join(root, 'apps'));
    await createService('pet-care', root);
    const index = join(root, 'apps/pet-care-service/src/modules/index.ts');
    const before = await readFile(index, 'utf8');
    assert.match(before, /PetCareRouter/);
    assert.match(
      await readFile(
        join(root, 'apps/pet-care-service/src/health/health.ts'),
        'utf8',
      ),
      /pet-care-service/,
    );
    await assert.rejects(
      access(join(root, 'apps/pet-care-service/src/modules/health')),
    );
    const module = await createBackendModule('pet-care', 'feeding', root);
    assert.equal(module.wired, true);
    const after = await readFile(index, 'utf8');
    assert.match(after, /PetCareRouter/);
    assert.match(after, /router.use\('\/feeding', FeedingRouter/);
    await assert.rejects(
      createBackendModule('pet-care', 'feeding', root),
      /already exists/,
    );
    await assert.rejects(createBackendModule('pet-care', '../escape', root));
    await assert.rejects(createBackendModule('pet-care', 'health', root));
    await createBackendModule('pet-care', 'plan1', root);
    await assert.rejects(
      createBackendModule('pet-care', 'plan-1', root),
      /collides/,
    );
    await writeFile(index, '// user-maintained registry\n');
    const manual = await createBackendModule('pet-care', 'visits', root);
    assert.equal(manual.wired, false);
    assert.equal(
      await readFile(index, 'utf8'),
      '// user-maintained registry\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('service registration preserves earlier services even when their source is absent locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'anico-service-registry-'));
  try {
    await registerDatabaseService('animal', root);
    await registerDatabaseService('auth-service', root);
    await registerDatabaseService('animal-service', root);
    assert.deepEqual(
      JSON.parse(
        await readFile(
          join(root, 'infrastructure/dev-database-services.json'),
          'utf8',
        ),
      ),
      ['animal-service', 'auth-service', 'breeding-service'],
    );
    await assert.rejects(registerDatabaseService('../admin', root));
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
      await createBackendModule(result.name, 'feeding', root);
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
      const { MongoBinary } = resolveFromBackend('mongodb-memory-server');
      const binary = await MongoBinary.getPath();
      const saved = process.env.MONGOMS_SYSTEM_BINARY;
      process.env.MONGOMS_SYSTEM_BINARY = binary;
      try {
        run(vitest, ['run', '--coverage'], cwd);
      } finally {
        if (saved === undefined) delete process.env.MONGOMS_SYSTEM_BINARY;
        else process.env.MONGOMS_SYSTEM_BINARY = saved;
      }
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

test(
  'React feature compiles, renders and preserves the existing application',
  { timeout: 30000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'anico-react-feature-'));
    const repository = join(__dirname, '../..');
    const frontendRequire = createRequire(
      join(repository, 'apps/frontend/package.json'),
    );
    try {
      const frontend = join(root, 'apps/frontend');
      await mkdir(join(frontend, 'src'), { recursive: true });
      await writeFile(
        join(frontend, 'package.json'),
        JSON.stringify({
          name: '@anico/frontend',
          type: 'module',
          dependencies: { react: '*' },
        }),
      );
      await writeFile(
        join(frontend, 'src/App.tsx'),
        'export function App() { return <h1>Existing application</h1>; }\n',
      );
      await symlink(
        join(repository, 'node_modules'),
        join(root, 'node_modules'),
        'junction',
      );
      try {
        await access(join(repository, 'apps/frontend/node_modules'));
        await symlink(
          join(repository, 'apps/frontend/node_modules'),
          join(frontend, 'node_modules'),
          'junction',
        );
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const result = await createFrontendFeature('animal-list', root);
      assert.equal(result.component, 'AnimalListFeature');
      assert.equal(
        await readFile(join(frontend, 'src/App.tsx'), 'utf8'),
        'export function App() { return <h1>Existing application</h1>; }\n',
      );
      await assert.rejects(
        createFrontendFeature('animal-list', root),
        /already exists/,
      );
      await copyFile(
        join(repository, 'tsconfig.base.json'),
        join(root, 'tsconfig.base.json'),
      );
      await copyFile(
        join(repository, 'apps/frontend/tsconfig.json'),
        join(frontend, 'tsconfig.json'),
      );
      const tsc = spawnSync(
        process.execPath,
        [frontendRequire.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'],
        { cwd: frontend, encoding: 'utf8' },
      );
      assert.equal(tsc.status, 0, tsc.stdout + tsc.stderr);
      const esbuild = createRequire(require.resolve('@turbo/gen/package.json'))(
        'esbuild',
      );
      const output = join(frontend, 'feature.mjs');
      await esbuild.build({
        entryPoints: [join(frontend, 'src/features/animal-list/index.ts')],
        outfile: output,
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        jsx: 'automatic',
        logLevel: 'silent',
      });
      const { AnimalListFeature } = await import(
        require('node:url').pathToFileURL(output).href
      );
      const { createElement } = frontendRequire('react');
      const { renderToStaticMarkup } = frontendRequire('react-dom/server');
      const html = renderToStaticMarkup(
        createElement(AnimalListFeature, {
          title: 'Animals',
          children: 'Custom content',
        }),
      );
      assert.match(html, /Animals/);
      assert.match(html, /Custom content/);
      assert.doesNotMatch(html, /Obsah funkce/);
      assert.match(
        renderToStaticMarkup(createElement(AnimalListFeature)),
        /Obsah funkce animal-list/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
