import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  remoteDevelopmentConfig,
  redactRemoteLog,
} from '../remote-dev-config.mjs';

const settings = { hostname: 'db-dev.anico.online', localPort: 27018 };
const valid =
  'MONGODB_URI=mongodb://dev_example:example-only@127.0.0.1:27018/anico_breeding_example?authSource=anico_breeding_example\nPORT=3000';
test('remote dev keeps apps local and passes credentials only as runtime environment', () => {
  const result = remoteDevelopmentConfig(
    valid + '\nHOST=0.0.0.0\nNODE_ENV=production',
    settings,
  );
  assert.equal(result.env.HOST, '127.0.0.1');
  assert.equal(result.env.NODE_ENV, 'development');
  assert.equal(result.database, 'anico_breeding_example');
});
test('direct servers, root accounts and shared app databases are rejected', () => {
  for (const invalid of [
    valid.replace('127.0.0.1', 'example.com'),
    valid.replace('dev_example:', 'anico_root:'),
    valid.replaceAll('anico_breeding_example', 'anico_breeding'),
    valid.replace('27018', '27017'),
    valid.replace('authSource=anico_breeding_example', 'authSource=admin'),
  ])
    assert.throws(() => remoteDevelopmentConfig(invalid, settings));
});
test('conflicting ports and unexpected endpoints are rejected', () => {
  assert.throws(() =>
    remoteDevelopmentConfig(valid.replace('3000', '27018'), settings),
  );
  assert.throws(() =>
    remoteDevelopmentConfig(valid, { ...settings, hostname: 'example.com' }),
  );
});
test('errors do not expose MongoDB connection strings', () => {
  assert.equal(
    redactRemoteLog('Failed mongodb://user:example@localhost/db'),
    'Failed [MongoDB URI hidden]',
  );
  assert.equal(
    redactRemoteLog(
      'https://db-dev.anico.online/cdn-cgi/access/cli?token=example-only',
    ),
    '[Cloudflare login opened in browser; private parameters hidden]',
  );
});

test('database commands allow only named tasks and explicit recovery flags', async () => {
  const { remoteArguments } = await import('../remote-dev-config.mjs');
  assert.equal(remoteArguments([]).command, undefined);
  assert.equal(remoteArguments(['--check']).check, true);
  assert.equal(
    remoteArguments(['--db=migrate', '--use-running-tunnel']).reuse,
    true,
  );
  assert.deepEqual(
    remoteArguments(['--db', 'migrate', '--retry', 'migration-id']).extra,
    ['--retry', 'migration-id'],
  );
  assert.deepEqual(
    remoteArguments(['--db=reset', '--confirm=anico_breeding_example']).extra,
    ['--confirm', 'anico_breeding_example'],
  );
  assert.deepEqual(
    remoteArguments(['--db=unlock', '--owner', 'owner-id', '--confirm', 'db'])
      .extra,
    ['--confirm', 'db', '--owner', 'owner-id'],
  );
  for (const args of [
    ['--db=drop'],
    ['--db=migrate', '--check'],
    ['--db'],
    ['--check=true'],
    ['--db=migrate', '--db=status'],
    ['--use-running-tunnel'],
    ['--db=reset'],
    ['--db=reset', '--confirm', 'db', '--use-running-tunnel'],
    ['--db=status', '--retry', 'id'],
    ['--db=status', '--owner', 'id'],
    ['--db=seed', '--confirm', 'db'],
    ['--db=seed', '--shared'],
    ['--db=unlock'],
  ])
    assert.throws(() => remoteArguments(args));
});
