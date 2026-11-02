import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as pulumi from '@pulumi/pulumi';
import { inspectGitHubLogin } from './inspect-github-login.js';

test('GitHub-only mode removes OTP without broadening allowlists or publishing dev/production', async () => {
  const { resources, plan, members } = await inspectGitHubLogin(true, true);
  for (const name of ['anico-dev-access', 'anico-administration-access']) {
    const app = resources.find((r) => r.name === name)!;
    assert.deepEqual(app.inputs.allowedIdps, ['anico-github-login-id']);
    assert.equal(app.inputs.autoRedirectToIdentity, true);
  }
  assert.equal(await pulumi.isSecret(plan.administration.policies), true);
  const admin = resources.find(
    (r) => r.name === 'anico-administration-access',
  )!;
  assert.deepEqual(
    admin.inputs.policies[0].includes,
    members.administratorEmails.map((email) => ({ email: { email } })),
  );
  assert.equal(
    resources.some((r) => r.inputs.type === 'saas'),
    false,
  );
  assert.deepEqual(
    resources
      .filter((r) => r.type.endsWith(':DnsRecord'))
      .map((r) => r.inputs.name),
    ['admin.anico.online'],
  );
});
