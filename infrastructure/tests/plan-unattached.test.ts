import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectPlan } from './inspect-plan.js';

test('looks up the existing server and creates only an unattached firewall', async () => {
  const { resources, lookups, program } = await inspectPlan(false);
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0]?.inputs.id, 171254722);
  assert.deepEqual(
    resources.map((resource) => resource.type),
    ['hcloud:index/firewall:Firewall'],
  );
  assert.equal(program.firewallAttached, false);
  assert.equal(program.attachmentId, null);
});
