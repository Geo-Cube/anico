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
