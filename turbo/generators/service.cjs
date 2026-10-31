const { spawn } = require('node:child_process');
const {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rm,
  rename,
  lstat,
} = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
// Turbo bundles generator code; load Prettier at runtime so its ESM plugins
// keep their own import.meta.url instead of being bundled into a CJS config.
const runtimeRequire = createRequire(__filename);
const prettier = runtimeRequire('prettier');

const repositoryRoot = path.resolve(__dirname, '../..');
const templates = path.join(__dirname, 'templates/service');

function normalizeName(input) {
  if (
    typeof input !== 'string' ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(input)
  ) {
    throw new Error(
      'Use a lowercase kebab-case name, e.g. animal or animal-service.',
    );
  }
  const base = input.replace(/-service$/, '');
  if (
    base.length > 40 ||
    ['service', 'frontend', 'infrastructure', 'node-modules'].includes(base)
  ) {
    throw new Error('Choose a service name of at most 40 characters.');
  }
  return {
    name: `${base}-service`,
    database: `anico_${base.replaceAll('-', '_')}`,
  };
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function* files(directory, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, item.name);
    if (item.isDirectory())
      yield* files(path.join(directory, item.name), relative);
    else if (item.isFile()) yield relative;
    else throw new Error('Templates must contain only regular files.');
  }
}

async function createService(input, root = repositoryRoot) {
  const { name, database } = normalizeName(input);
  const destination = path.join(root, 'apps', name);
  if (await exists(destination))
    throw new Error(`apps/${name} already exists; nothing overwritten.`);
  const usedPorts = new Set([3000, 5173]);
  for (const directory of await readdir(path.join(root, 'apps'), {
    withFileTypes: true,
  })) {
    if (!directory.isDirectory()) continue;
    const folder = path.join(root, 'apps', directory.name);
    if (await exists(path.join(folder, 'package.json'))) {
      const manifest = JSON.parse(
        await readFile(path.join(folder, 'package.json'), 'utf8'),
      );
      if (manifest.name === `@anico/${name}`)
        throw new Error('Workspace name already exists.');
    }
    if (await exists(path.join(folder, '.env.example'))) {
      const example = await readFile(path.join(folder, '.env.example'), 'utf8');
      const port = /^PORT=(\d+)\s*$/m.exec(example);
      if (port) usedPorts.add(Number(port[1]));
    }
  }
  let port = 3001;
  while (usedPorts.has(port)) port++;
  if (port > 65535)
    throw new Error('No available service port in the configured range.');
  const temporary = path.join(root, 'apps', `.anico-scaffold-${randomUUID()}`);
  const values = {
    __SERVICE_NAME__: name,
    __DATABASE__: database,
    __PORT__: String(port),
  };
  await mkdir(temporary);
  try {
    for await (const file of files(templates)) {
      const relative = file.replace(/\.tpl$/, '');
      let content = await readFile(path.join(templates, file), 'utf8');
      for (const [token, value] of Object.entries(values))
        content = content.replaceAll(token, value);
      const filepath = path.join(destination, relative);
      const config = await prettier.resolveConfig(
        path.join(root, 'package.json'),
      );
      if (
        ['.ts', '.js', '.mjs', '.json', '.md'].includes(path.extname(relative))
      ) {
        content = await prettier.format(content, { ...config, filepath });
      }
      const target = path.join(temporary, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: 'wx' });
    }
    // Only public defaults are copied; no existing .env or credentials are read.
    await writeFile(
      path.join(temporary, '.env'),
      await readFile(path.join(temporary, '.env.example')),
      { flag: 'wx' },
    );
    if (await exists(destination))
      throw new Error(
        'Destination appeared during generation; nothing overwritten.',
      );
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return { root, name, database, port, workspace: `@anico/${name}` };
}

function installDependencies(root) {
  // Reuse the npm that launched turbo, without shell interpolation (also on Windows).
  const npm = process.env.npm_execpath;
  if (!npm || !/npm-cli\.js$/.test(npm)) {
    throw new Error(
      'Service created. Run npm install from the repository root to install its dependencies.',
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
      {
        cwd: root,
        stdio: 'inherit',
        shell: false,
      },
    );
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              'Service created; dependency installation failed. Retry npm install from the repository root.',
            ),
          ),
    );
  });
}

module.exports = { normalizeName, createService, installDependencies };
