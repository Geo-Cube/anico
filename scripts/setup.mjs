import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function prepareAppEnvironments(root) {
  const created = [];
  for (const directory of await readdir(join(root, 'apps'), {
    withFileTypes: true,
  })) {
    if (!directory.isDirectory() || directory.name.startsWith('.')) continue;
    const folder = join(root, 'apps', directory.name);
    let example;
    try {
      example = await readFile(join(folder, '.env.example'));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    try {
      await writeFile(join(folder, '.env'), example, {
        flag: 'wx',
        mode: 0o600,
      });
      created.push(directory.name);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  return created;
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 19))
    throw new Error('Use Node >=22.19 (see .nvmrc) before setup');
  const npm = process.env.npm_execpath;
  if (!npm || !/npm-cli\.js$/.test(npm))
    throw new Error('Run this command with npm run setup');
  const version = spawnSync(process.execPath, [npm, '--version'], {
    encoding: 'utf8',
  });
  if (version.status !== 0 || Number(version.stdout.split('.')[0]) < 11)
    throw new Error('Use npm >=11 before setup (see package.json)');
  const result = spawnSync(process.execPath, [npm, 'ci'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error('npm ci failed; fix its reported error and rerun setup');
  const created = await prepareAppEnvironments(root);
  const build = spawnSync(
    process.execPath,
    [npm, 'run', 'build', '-w', '@anico/shared-schemas'],
    { cwd: root, stdio: 'inherit' },
  );
  if (build.error || build.status !== 0)
    throw new Error(
      'Shared contract build failed; fix its reported error and rerun setup',
    );
  console.log(
    `Setup complete. Created ${created.length} missing app .env files from public examples; existing files preserved.`,
  );
  console.log(
    'Frontend: npm run dev:frontend. Remote backend: npm run doctor -- --service NAME',
  );
  console.log(
    'Remote access still requires your own private .env.remote.local; setup never creates credentials.',
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
