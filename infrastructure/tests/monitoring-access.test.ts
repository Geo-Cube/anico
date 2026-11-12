import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { unwrapMockSecrets } from './mock-secrets.js';

test('monitoring UI has a dedicated GitHub-only Access app and tunnel to the internal GlitchTip', async () => {
  const resources: pulumi.runtime.MockResourceArgs[] = [];
  await pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push({ ...args, inputs: unwrapMockSecrets(args.inputs) });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, aud: 'monitoring-audience' },
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
  // Pulumi mocks must be registered before the resource module is loaded.
  const { configureMonitoringAccess } =
    await import('../src/monitoring-access.js');
  const plan = configureMonitoringAccess(
    {
      enabled: true,
      accountId: 'a'.repeat(32),
      zoneId: 'b'.repeat(32),
      teamName: 'anico-test',
    },
    JSON.parse(
      readFileSync(new URL('../monitoring.json', import.meta.url), 'utf8'),
    ),
    'existing-github-id',
    ['one@example.com'],
  );
  // ES2023 lib target: Promise.withResolvers is not typed here.
  await new Promise<void>((resolve) =>
    pulumi
      .all([plan.application.id, plan.routing.id, plan.dns.id, plan.token])
      .apply(() => resolve()),
  );
  assert.equal(resources.length, 4);
  const app = resources.find((r) =>
    r.type.endsWith(':ZeroTrustAccessApplication'),
  )!;
  assert.equal(app.inputs.domain, 'monitoring.anico.online');
  assert.deepEqual(app.inputs.allowedIdps, ['existing-github-id']);
  assert.equal(app.inputs.autoRedirectToIdentity, true);
  const routes = resources.find((r) =>
    r.type.endsWith(':ZeroTrustTunnelCloudflaredConfig'),
  )!.inputs.config.ingresses;
  assert.equal(routes.length, 2);
  assert.equal(routes[0].hostname, 'monitoring.anico.online');
  assert.equal(routes[0].service, 'http://anico-glitchtip:8000');
  assert.equal(
    routes[0].originRequest.httpHostHeader,
    'monitoring.anico.online',
  );
  assert.equal(routes[0].originRequest.access.required, true);
  assert.deepEqual(routes[0].originRequest.access.audTags, [
    'monitoring-audience',
  ]);
  assert.deepEqual(routes[1], { service: 'http_status:404' });
  const dns = resources.find((r) => r.type.endsWith(':DnsRecord'))!;
  assert.equal(dns.inputs.name, 'monitoring.anico.online');
  assert.equal(dns.inputs.proxied, true);
  assert.equal(await pulumi.isSecret(plan.application.policies), true);
  assert.equal(await pulumi.isSecret(plan.token), true);
});
