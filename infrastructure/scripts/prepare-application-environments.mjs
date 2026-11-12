import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareApplicationEnvironments } from '../src/application-environments.ts';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const file = fileURLToPath(
  new URL('../../.pulumi/application-environments.json', import.meta.url),
);

function config(args) {
  const result = spawnSync(
    'node',
    ['--env-file-if-exists=.env.local', 'scripts/run-pulumi.mjs', ...args],
    { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error('Cannot read application configuration; values are hidden');
  return result.stdout;
}

try {
  const settings = JSON.parse(
    readFileSync(new URL('../applications.json', import.meta.url), 'utf8'),
  );
  const metadata = JSON.parse(
    config(['config', '--json', '--stack', 'shared']),
  );
  const key = 'anico-foundation:applicationVariables';
  if (metadata[key] && metadata[key].secret !== true)
    throw new Error('applicationVariables must be stored as a Pulumi secret');
  const privateVariables = metadata[key]
    ? JSON.parse(
        config(['config', 'get', 'applicationVariables', '--stack', 'shared']),
      )
    : {};
  const desired = prepareApplicationEnvironments(settings, privateVariables);
  writeFileSync(file, JSON.stringify(desired, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log('Private application environment input prepared; values hidden.');
} catch {
  console.error(
    'Application environment preparation failed. Check settings and encrypted applicationVariables; no values displayed.',
  );
  process.exitCode = 1;
}
