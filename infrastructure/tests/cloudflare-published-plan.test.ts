import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { unwrapMockSecrets } from './mock-secrets.js';

test('publishing production creates public DNS without an Access application or origin JWT requirement', async () => {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({ ...args, inputs: unwrapMockSecrets(args.inputs) });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, aud: `${args.name}-aud` },
        };
      },
      call(args) {
        if (args.token.includes('getZeroTrustAccessApplications'))
          return { results: [] };
        if (args.token.includes('getZeroTrustOrganization'))
          return {
            authDomain: 'anico-test.cloudflareaccess.com',
            denyUnmatchedRequests: false,
          };
        if (args.token.includes('getZeroTrustTunnelCloudflaredToken'))
          return { token: 'mock-secret' };
        throw new Error(`Unexpected lookup: ${args.token}`);
      },
    },
    'anico-foundation',
    'test',
    true,
  );
  const { configureCloudflare } = await import('../src/cloudflare.js');
  const plan = configureCloudflare(
    {
      enabled: true,
      accountId: 'a'.repeat(32),
      zoneId: 'b'.repeat(32),
      teamName: 'anico-test',
    },
    {
      administratorHostname: 'admin.anico.online',
      developerEmails: ['dev@example.com'],
      administratorEmails: [],
      publish: { production: true, dev: true, administration: true },
    },
  );
  await new Promise<void>((resolve) => {
    pulumi
      .all([
        ...plan.dns.map((record) => record.id),
        plan.tunnelConfiguration.id,
      ])
      .apply(() => resolve());
  });
  assert.equal(
    resources.filter((resource) => resource.type.endsWith(':DnsRecord')).length,
    3,
  );
  const applications = resources.filter((resource) =>
    resource.type.endsWith(':ZeroTrustAccessApplication'),
  );
  assert.equal(applications.length, 2);
  assert.equal(
    applications.some((app) => app.inputs.domain === 'anico.online'),
    false,
  );
  assert.equal(
    applications.find((app) => app.inputs.domain === 'dev.anico.online')?.inputs
      .policies[0].decision,
    'allow',
  );
  assert.equal(
    applications.find((app) => app.inputs.domain === 'admin.anico.online')
      ?.inputs.policies[0].decision,
    'deny',
  );
  const routing = resources.find((resource) =>
    resource.type.endsWith(':ZeroTrustTunnelCloudflaredConfig'),
  );
  const production = routing?.inputs.config.ingresses.find(
    (route: { hostname?: string }) => route.hostname === 'anico.online',
  );
  assert.equal(production.service, 'http://coolify-proxy:80');
  assert.equal(production.originRequest.access, undefined);
});
