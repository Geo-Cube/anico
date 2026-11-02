import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

process.umask(0o077);
const root = fileURLToPath(new URL('../../', import.meta.url));
const files = [
  'infrastructure/.env.local',
  'infrastructure/Pulumi.shared.yaml',
  'infrastructure/ansible/inventory.local.yml',
  '.pulumi/passphrase',
  '.pulumi/coolify.env',
];
const directory = join(
  root,
  '.pulumi/recovery',
  new Date().toISOString().replaceAll(':', '-'),
);

try {
  for (const file of files) {
    if (!existsSync(join(root, file)))
      throw new Error(`Required recovery file missing: ${file}`);
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(join(root, '.pulumi/recovery'), 0o700);
  const output = join(directory, 'stack.json');
  const exported = spawnSync(
    'pulumi',
    [
      'stack',
      'export',
      '--stack',
      'shared',
      '--file',
      output,
      '--non-interactive',
    ],
    {
      cwd: join(root, 'infrastructure'),
      stdio: 'pipe',
      timeout: 60_000,
    },
  );
  if (exported.error || exported.status !== 0)
    throw new Error(
      'Pulumi export failed; snapshot is incomplete. Check the local backend and passphrase.',
    );
  chmodSync(output, 0o600);
  const deployment = JSON.parse(readFileSync(output, 'utf8'));
  if (!deployment.deployment?.resources?.length)
    throw new Error('Export contains no resources; snapshot is incomplete');
  for (const file of files) {
    const destination = join(directory, file);
    mkdirSync(join(destination, '..'), { recursive: true, mode: 0o700 });
    copyFileSync(join(root, file), destination);
    chmodSync(destination, 0o600);
  }
  const manifest = {
    createdAt: new Date().toISOString(),
    stack: 'shared',
    warning:
      'PRIVATE PLAINTEXT credentials and decryption passphrase. Local recovery copy only; no server/database data or SSH private key.',
    files: Object.fromEntries(
      ['stack.json', ...files].map((file) => [
        file,
        createHash('sha256')
          .update(readFileSync(join(directory, file)))
          .digest('hex'),
      ]),
    ),
  };
  writeFileSync(
    join(directory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(`Recovery snapshot: ${directory}`);
  console.log(
    'Encrypted Pulumi export and 5 private configuration files saved with restricted permissions.',
  );
  console.log(
    'This copy is on the SAME Mac, contains plaintext credentials and is NOT a backup of server data. Store any off-device copy encrypted.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
