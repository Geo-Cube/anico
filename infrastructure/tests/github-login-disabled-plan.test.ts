import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectGitHubLogin } from './inspect-github-login.js';

test('GitHub rollback preserves the provider and restores email-only application login', async () => {
  const { resources, plan } = await inspectGitHubLogin(false);
  assert.ok(plan.github);
  const apps = resources.filter((r) =>
    r.type.endsWith(':ZeroTrustAccessApplication'),
  );
  for (const app of apps) {
    assert.deepEqual(app.inputs.allowedIdps, ['anico-email-login-id']);
    assert.equal(app.inputs.autoRedirectToIdentity, true);
  }
});
