import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { prepareApplicationEnvironments } from '../src/application-environments.js';

const settings: unknown = JSON.parse(
  readFileSync(new URL('../applications.json', import.meta.url), 'utf8'),
);

test('dev and prod use optimized images with separate environment identity', () => {
  const result = prepareApplicationEnvironments(settings);
  assert.equal(result.environments.dev?.variables.NODE_ENV, 'production');
  assert.equal(result.environments.prod?.variables.NODE_ENV, 'production');
  assert.equal(result.environments.dev?.variables.APP_ENV, 'dev');
  assert.equal(result.environments.prod?.variables.APP_ENV, 'prod');
});

test('private values cannot leak from dev into production', () => {
  const result = prepareApplicationEnvironments(settings, {
    dev: { MONGODB_URI: 'mongodb://dev-only/db', FEATURE_FLAG: 'enabled' },
    prod: { MONGODB_URI: 'mongodb://prod-only/db' },
  });
  assert.equal(
    result.environments.dev?.variables.MONGODB_URI,
    'mongodb://dev-only/db',
  );
  assert.equal(
    result.environments.prod?.variables.MONGODB_URI,
    'mongodb://prod-only/db',
  );
  assert.equal(result.environments.prod?.variables.FEATURE_FLAG, undefined);
});

test('unsafe keys and unexpected environment names are rejected', () => {
  assert.throws(() =>
    prepareApplicationEnvironments(settings, {
      dev: { 'INVALID\nKEY': 'value' },
    }),
  );
  assert.throws(() =>
    prepareApplicationEnvironments(settings, { staging: {} }),
  );
});

test('runtime identity and log levels stay validated', () => {
  for (const variables of [
    { NODE_ENV: 'development' },
    { APP_ENV: 'prod' },
    { LOG_LEVEL: 'verbose' },
  ]) {
    assert.throws(() =>
      prepareApplicationEnvironments(settings, { dev: variables }),
    );
  }
});
