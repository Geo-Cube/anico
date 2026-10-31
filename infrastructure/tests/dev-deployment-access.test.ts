import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { unwrapMockSecrets } from './mock-secrets.js';

test('CI Access token is accepted only on its separate deployment hostname', async () => {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({ ...args, inputs: unwrapMockSecrets(args.inputs) });
        return {
          id: args.name + '-id',
          state: {
            ...args.inputs,
            aud: args.name + '-aud',
            clientId: 'mock-id',
            clientSecret: 'mock-secret',
          },
        };
      },
      call() {
        throw new Error('Unexpected lookup');
      },
    },
    'anico-foundation',
    'test',
    true,
  );
  const { configureDevDeploymentAccess } =
    await import('../src/dev-deployment-access.js');
  const plan = configureDevDeploymentAccess(
    {
      enabled: true,
      accountId: 'a'.repeat(32),
      zoneId: 'b'.repeat(32),
      teamName: 'anico-test',
    },
    'test-tunnel',
  );
  await new Promise<void>((resolve) =>
    pulumi.all([plan.application.id, plan.dns.id]).apply(() => resolve()),
  );
  const app = resources.find((x) => x.name === 'anico-dev-deploy-access')!;
  assert.equal(app.inputs.domain, 'deploy-dev.anico.online');
  assert.equal(app.inputs.policies[0].decision, 'non_identity');
  assert.deepEqual(app.inputs.policies[0].includes, [
    { serviceToken: { tokenId: 'anico-dev-deploy-token-id' } },
  ]);
  assert.equal(
    resources.filter((x) => x.type.endsWith(':ZeroTrustAccessApplication'))
      .length,
    1,
  );
  const dns = resources.find((x) => x.name === 'anico-dns-dev-deploy')!;
  assert.equal(dns.inputs.proxied, true);
  assert.equal(dns.inputs.content, 'test-tunnel.cfargotunnel.com');
});
