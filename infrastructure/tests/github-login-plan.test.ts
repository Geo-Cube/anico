import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { inspectGitHubLogin } from './inspect-github-login.js';

test('GitHub login keeps email fallback, existing allowlists and private/public boundaries', async () => {
  const { resources, plan, members } = await inspectGitHubLogin(true);
  assert.ok(plan.github);
  assert.equal(await pulumi.isSecret(plan.github.config), true);
  assert.equal(await pulumi.isSecret(plan.administration.policies), true);
  assert.equal(await pulumi.isSecret(plan.dev.policies), true);
  const provider = resources.find((r) => r.name === 'anico-github-login');
  assert.equal(provider?.inputs.type, 'github');
  const unwrap = (value: any) =>
    pulumi.runtime.isRpcSecret(value) ? value.value : value;
  const config = unwrap(provider?.inputs.config);
  assert.equal(config.clientId, 'Ov23liTestClient12345');
  assert.equal(unwrap(config.clientSecret), 'test-oauth-secret');

  const apps = resources.filter((r) =>
    r.type.endsWith(':ZeroTrustAccessApplication'),
  );
  assert.equal(apps.length, 2);
  for (const app of apps) {
    assert.deepEqual(app.inputs.allowedIdps, [
      'anico-github-login-id',
      'anico-email-login-id',
    ]);
    assert.equal(app.inputs.autoRedirectToIdentity, false);
  }
  const admin = apps.find((r) => r.inputs.domain === 'admin.anico.online');
  assert.deepEqual(
    admin?.inputs.policies[0].includes,
    members.administratorEmails.map((email: string) => ({ email: { email } })),
  );
  const dev = apps.find((r) => r.inputs.domain === 'dev.anico.online');
  assert.equal(dev?.inputs.policies[0].decision, 'deny');
  assert.equal(
    apps.some((r) => r.inputs.domain === 'anico.online'),
    false,
  );
  assert.deepEqual(
    resources
      .filter((r) => r.type.endsWith(':DnsRecord'))
      .map((r) => r.inputs.name),
    ['admin.anico.online'],
  );
});
