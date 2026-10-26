import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foundationConfigSchema } from '../src/config.js';

const base = { serverId: 171254722, sshCidrs: ['8.8.8.8/32'] };

test('leaves the firewall unattached unless explicitly configured', () => {
  const settings = foundationConfigSchema.parse(base);
  assert.equal(settings.attachFirewall, false);
  assert.equal(settings.sshPort, 22);
});

test('accepts an explicit attachment and a custom SSH port', () => {
  const settings = foundationConfigSchema.parse({
    ...base,
    attachFirewall: true,
    sshPort: 2222,
  });
  assert.equal(settings.attachFirewall, true);
  assert.equal(settings.sshPort, 2222);
});

test('requires a real server ID and at least one SSH network', () => {
  for (const input of [
    { ...base, serverId: 0 },
    { ...base, serverId: -1 },
    { ...base, serverId: 1.5 },
    { ...base, sshCidrs: [] },
  ]) {
    assert.equal(foundationConfigSchema.safeParse(input).success, false);
  }
});

test('rejects public SSH access, malformed CIDRs and unchanged examples', () => {
  for (const cidr of [
    '0.0.0.0/0',
    '::/0',
    '8.8.8.8',
    '8.8.8.8/33',
    '192.0.2.10/32',
    '198.51.100.10/32',
    '203.0.113.10/32',
    '2001:db8::1/128',
  ]) {
    assert.equal(
      foundationConfigSchema.safeParse({ ...base, sshCidrs: [cidr] }).success,
      false,
      cidr,
    );
  }
});

test('accepts an IPv6 host network', () => {
  assert.equal(
    foundationConfigSchema.safeParse({
      ...base,
      sshCidrs: ['2606:4700:4700::1111/128'],
    }).success,
    true,
  );
});

test('rejects invalid SSH ports and unexpected settings', () => {
  for (const input of [
    { ...base, sshPort: 0 },
    { ...base, sshPort: 65536 },
    { ...base, attachFirewall: 'true' },
    { ...base, rebuild: true },
  ]) {
    assert.equal(foundationConfigSchema.safeParse(input).success, false);
  }
});
