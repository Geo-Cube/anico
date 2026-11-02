import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.umask(0o077);
const root = fileURLToPath(new URL('../../', import.meta.url));
let rehearsal;
try {
  assert.equal(
    process.argv.length,
    3,
    'Usage: npm run recovery:verify -w @anico/infrastructure -- /absolute/path/to/snapshot',
  );
  const snapshot = resolve(process.argv[2]);
  const manifest = JSON.parse(
    readFileSync(join(snapshot, 'manifest.json'), 'utf8'),
  );
  const expected = [
    'stack.json',
    'infrastructure/.env.local',
    'infrastructure/Pulumi.shared.yaml',
    'infrastructure/ansible/inventory.local.yml',
    '.pulumi/passphrase',
    '.pulumi/coolify.env',
  ];
  assert.deepEqual(
    Object.keys(manifest.files).sort(),
    [...expected].sort(),
    'Unexpected recovery file list',
  );
  for (const file of expected) {
    const hash = createHash('sha256')
      .update(readFileSync(join(snapshot, file)))
      .digest('hex');
    assert.equal(
      hash,
      manifest.files[file],
      `Recovery file is damaged: ${file}`,
    );
  }
  // Import into an ISOLATED local backend; never refresh, preview or apply here.
  rehearsal = mkdtempSync(join(root, '.pulumi/recovery-check-'));
  const backend = join(rehearsal, 'state');
  mkdirSync(backend, { mode: 0o700 });
  writeFileSync(
    join(rehearsal, 'Pulumi.yaml'),
    'name: anico-foundation\nruntime: nodejs\n',
  );
  copyFileSync(
    join(snapshot, 'infrastructure/Pulumi.shared.yaml'),
    join(rehearsal, 'Pulumi.shared.yaml'),
  );
  const env = {
    ...process.env,
    PULUMI_BACKEND_URL: pathToFileURL(backend).href,
    PULUMI_CONFIG_PASSPHRASE_FILE: join(snapshot, '.pulumi/passphrase'),
  };
  delete env.PULUMI_CONFIG_PASSPHRASE;
  // The rehearsal needs no cloud credentials and must not accidentally use them.
  delete env.HCLOUD_TOKEN;
  delete env.CLOUDFLARE_API_TOKEN;
  function pulumi(args) {
    const result = spawnSync('pulumi', args, {
      cwd: rehearsal,
      env,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error || result.status !== 0)
      throw new Error(
        `Local recovery rehearsal failed at pulumi ${args.slice(0, 2).join(' ')}; check snapshot/passphrase`,
      );
    return result.stdout;
  }
  pulumi([
    'stack',
    'init',
    'shared',
    '--secrets-provider',
    'passphrase',
    '--non-interactive',
  ]);
  pulumi([
    'stack',
    'import',
    '--stack',
    'shared',
    '--file',
    join(snapshot, 'stack.json'),
    '--non-interactive',
  ]);
  const imported = JSON.parse(
    pulumi(['stack', 'export', '--stack', 'shared', '--non-interactive']),
  );
  const original = JSON.parse(
    readFileSync(join(snapshot, 'stack.json'), 'utf8'),
  );
  const identities = (deployment) =>
    deployment.deployment.resources.map(({ urn, id }) => ({ urn, id }));
  assert.deepEqual(identities(imported), identities(original));
  const token = pulumi([
    'stack',
    'output',
    'tunnelToken',
    '--stack',
    'shared',
    '--show-secrets',
    '--non-interactive',
  ]).trim();
  if (!/^[A-Za-z0-9+/=_-]{50,}$/.test(token))
    throw new Error('Could not decrypt the restored tunnel token');
  console.log(
    `Recovery verified: ${expected.length} file checksums, local state import, resource identities and secret decryption.`,
  );
  console.log(
    'No cloud API calls, server changes or data restore were performed. Temporary backend removed.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (rehearsal) rmSync(rehearsal, { recursive: true, force: true });
}
