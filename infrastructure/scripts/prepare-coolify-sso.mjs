import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const file = fileURLToPath(
  new URL('../../.pulumi/coolify-sso.json', import.meta.url),
);
function cli(args) {
  const r = spawnSync(
    'node',
    ['--env-file-if-exists=.env.local', 'scripts/run-pulumi.mjs', ...args],
    {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (r.status !== 0)
    throw new Error(
      'Cannot read private Coolify SSO configuration; no credentials displayed',
    );
  return r.stdout;
}
const config = JSON.parse(cli(['config', '--json', '--stack', 'shared']));
if (config['anico-foundation:coolifySsoEnabled']?.value !== 'true') {
  if (existsSync(file))
    throw new Error(
      'Existing SSO configuration must not be silently discarded',
    );
  console.log(JSON.stringify({ enabled: false, only: false }));
} else {
  const credentials = {
    provider: 'github',
    clientId: cli([
      'config',
      'get',
      'githubClientId',
      '--stack',
      'shared',
    ]).trim(),
    clientSecret: cli([
      'config',
      'get',
      'githubClientSecret',
      '--stack',
      'shared',
    ]).trim(),
    redirectUri: 'https://admin.anico.online/auth/github/callback',
  };
  const team = JSON.parse(
    cli(['config', 'get', 'coolifyTeam', '--stack', 'shared']),
  );
  const only = config['anico-foundation:coolifySsoOnly']?.value === 'true';
  if (!credentials.clientId || !credentials.clientSecret || !team.owner?.email)
    throw new Error('Incomplete Coolify SSO configuration');
  writeFileSync(
    file,
    JSON.stringify({ ...credentials, ...team, enabled: true, only }, null, 2) +
      '\n',
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
  console.log(JSON.stringify({ enabled: true, only }));
}
