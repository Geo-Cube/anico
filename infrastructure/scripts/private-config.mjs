import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
export function pulumi(args, input) {
  const result = spawnSync(
    'node',
    ['--env-file-if-exists=.env.local', 'scripts/run-pulumi.mjs', ...args],
    {
      cwd,
      encoding: 'utf8',
      input,
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error('Private Pulumi operation failed; values suppressed');
  return result.stdout;
}
export function configuration() {
  return JSON.parse(pulumi(['config', '--json', '--stack', 'shared']));
}
export function secret(key, optional = false) {
  const entry = configuration()[`anico-foundation:${key}`];
  if (!entry && optional) return undefined;
  if (!entry?.secret) throw new Error('Expected an encrypted Pulumi secret');
  return JSON.parse(pulumi(['config', 'get', key, '--stack', 'shared']));
}
export function setSecret(key, value) {
  pulumi(
    ['config', 'set', key, '--secret', '--stack', 'shared'],
    JSON.stringify(value) + '\n',
  );
}
export function privateFile(path, value) {
  mkdirSync(new URL('.', path), { recursive: true, mode: 0o700 });
  writeFileSync(path, value, { mode: 0o600 });
  chmodSync(path, 0o600);
}
