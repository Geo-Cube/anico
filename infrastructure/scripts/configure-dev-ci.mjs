import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pulumi, secret } from './private-config.mjs';

function gh(args, input) {
  const result = spawnSync('gh', args, {
    input,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error('GitHub configuration failed; response suppressed');
  return result.stdout;
}
try {
  const repository = 'Geo-Cube/anico';
  const prefix = `repos/${repository}/environments/dev`;
  gh(
    ['api', prefix, '--method', 'PUT', '--input', '-'],
    JSON.stringify({
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    }),
  );
  const policies = JSON.parse(
    gh(['api', `${prefix}/deployment-branch-policies`]),
  );
  if (
    policies.branch_policies.some(
      (x) => x.name !== 'dev' || x.type !== 'branch',
    )
  )
    throw new Error('Unexpected GitHub dev deployment branch policy');
  if (!policies.branch_policies.length)
    gh(
      [
        'api',
        `${prefix}/deployment-branch-policies`,
        '--method',
        'POST',
        '--input',
        '-',
      ],
      JSON.stringify({ name: 'dev', type: 'branch' }),
    );
  const outputs = JSON.parse(
    pulumi([
      'stack',
      'output',
      '--stack',
      'shared',
      '--json',
      '--show-secrets',
    ]),
  );
  const credentials = secret('devDeploymentCredentials');
  const metadata = JSON.parse(
    readFileSync(
      new URL('../../.pulumi/dev-deployment/metadata.json', import.meta.url),
      'utf8',
    ),
  );
  if (
    !outputs.devDeployClientId ||
    !outputs.devDeployClientSecret ||
    !credentials.token ||
    !metadata.uuid
  )
    throw new Error('Incomplete private CI configuration');
  for (const [name, value] of Object.entries({
    COOLIFY_DEV_TOKEN: credentials.token,
    CF_DEV_DEPLOY_CLIENT_ID: outputs.devDeployClientId,
    CF_DEV_DEPLOY_CLIENT_SECRET: outputs.devDeployClientSecret,
  }))
    gh(['secret', 'set', name, '--env', 'dev', '--repo', repository], value);
  gh(
    [
      'variable',
      'set',
      'COOLIFY_DEV_SERVICE_UUID',
      '--env',
      'dev',
      '--repo',
      repository,
    ],
    metadata.uuid,
  );
  console.log(
    'Dev GitHub environment configured: dev branch only, service identity and three encrypted secrets.',
  );
} catch {
  console.error(
    'Development CI configuration failed; credentials and API responses suppressed.',
  );
  process.exitCode = 1;
}
