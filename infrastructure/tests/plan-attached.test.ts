import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPlan } from './inspect-plan.js';

test('attaches the firewall to the existing server without managing its lifecycle', async () => {
  const { resources } = await inspectPlan(true);
  assert.equal(resources.length, 2);
  const attachment = resources.find(
    (resource) =>
      resource.type === 'hcloud:index/firewallAttachment:FirewallAttachment',
  );
  assert.ok(attachment);
  assert.deepEqual(attachment.inputs.serverIds, [171254722]);
  assert.equal(attachment.inputs.firewallId, 42);
  assert.equal(
    resources.some(
      (resource) => resource.type === 'hcloud:index/server:Server',
    ),
    false,
  );
});
