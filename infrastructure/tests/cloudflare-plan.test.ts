import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';

test('Cloudflare plan protects only dev/admin, validates private origins, and publishes no DNS by default', async () => {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, aud: `${args.name}-aud` },
        };
      },
      call(args) {
        if (args.token.includes('getZeroTrustAccessApplications'))
          return { results: [] };
        if (args.token.includes('getZeroTrustOrganization')) {
          return {
            authDomain: 'anico-test.cloudflareaccess.com',
            denyUnmatchedRequests: false,
          };
        }
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
      developerEmails: [],
      administratorEmails: [],
      publish: { production: false, dev: false, administration: false },
    },
  );
  await new Promise<void>((resolve) => {
    pulumi
      .all([
        plan.dev.id,
        plan.administration.id,
        plan.tunnel.id,
        plan.tunnelConfiguration.id,
        plan.token,
      ])
      .apply(() => resolve());
  });
  const applications = resources.filter((resource) =>
    resource.type.endsWith(':ZeroTrustAccessApplication'),
  );
  assert.deepEqual(applications.map((app) => app.inputs.domain).sort(), [
    'admin.anico.online',
    'dev.anico.online',
  ]);
  for (const app of applications)
    assert.equal(app.inputs.policies[0].decision, 'deny');
  assert.equal(
    resources.some((resource) => resource.type.endsWith(':DnsRecord')),
    false,
  );
  assert.equal(await pulumi.isSecret(plan.token), true);
  const routing = resources.find((resource) =>
    resource.type.endsWith(':ZeroTrustTunnelCloudflaredConfig'),
  );
  assert.ok(routing);
  const routes = routing.inputs.config.ingresses;
  const production = routes.find(
    (route: { hostname?: string }) => route.hostname === 'anico.online',
  );
  assert.equal(production.originRequest.access, undefined);
  for (const hostname of ['admin.anico.online', 'dev.anico.online']) {
    const route = routes.find(
      (item: { hostname?: string }) => item.hostname === hostname,
    );
    assert.equal(route.originRequest.access.required, true);
    assert.equal(route.originRequest.access.audTags.length, 1);
  }
  assert.deepEqual(routes.at(-1), { service: 'http_status:404' });
});
