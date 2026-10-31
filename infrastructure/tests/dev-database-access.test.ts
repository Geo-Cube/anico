import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { unwrapMockSecrets } from './mock-secrets.js';

test('database has a dedicated GitHub-only Access app and tunnel without publishing production', async () => {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({ ...args, inputs: unwrapMockSecrets(args.inputs) });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, aud: 'database-audience' },
        };
      },
      call(args) {
        assert.ok(args.token.includes('getZeroTrustTunnelCloudflaredToken'));
        return { token: 'fake-test-value' };
      },
    },
    'anico-foundation',
    'test',
    true,
  );
  const { configureDevDatabaseAccess } =
    await import('../src/dev-database-access.js');
  const plan = configureDevDatabaseAccess(
    {
      enabled: true,
      accountId: 'a'.repeat(32),
      zoneId: 'b'.repeat(32),
      teamName: 'anico-test',
    },
    JSON.parse(
      readFileSync(new URL('../dev-database.json', import.meta.url), 'utf8'),
    ),
    'existing-github-id',
    ['one@example.com'],
  );
  await new Promise<void>((resolve) =>
    pulumi
      .all([plan.application.id, plan.routing.id, plan.dns.id, plan.token])
      .apply(() => resolve()),
  );
  assert.equal(resources.length, 4);
  const app = resources.find((r) =>
    r.type.endsWith(':ZeroTrustAccessApplication'),
  )!;
  assert.equal(app.inputs.domain, 'db-dev.anico.online');
  assert.deepEqual(app.inputs.allowedIdps, ['existing-github-id']);
  const routes = resources.find((r) =>
    r.type.endsWith(':ZeroTrustTunnelCloudflaredConfig'),
  )!.inputs.config.ingresses;
  assert.equal(routes.length, 2);
  assert.equal(routes[0].service, 'tcp://anico-dev-mongodb:27017');
  assert.equal(routes[0].originRequest.access.required, true);
  assert.deepEqual(routes[0].originRequest.access.audTags, [
    'database-audience',
  ]);
  assert.deepEqual(routes[1], { service: 'http_status:404' });
  assert.equal(await pulumi.isSecret(plan.application.policies), true);
  assert.equal(await pulumi.isSecret(plan.token), true);
});
