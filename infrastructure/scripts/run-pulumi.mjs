import { spawnSync } from 'node:child_process';

const result = spawnSync('pulumi', process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
});
if (result.error?.code === 'ENOENT') {
  console.error(
    'Pulumi CLI is missing. Install it with: brew install pulumi/tap/pulumi',
  );
}
process.exit(result.status ?? 1);
