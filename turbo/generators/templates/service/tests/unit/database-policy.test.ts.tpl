import { describe, expect, it } from 'vitest';
import {
  databaseTarget,
  requireReset,
  requireSeed,
} from '../../src/database/policy.js';
import { databaseOptions } from '../../src/database/options.js';

const uri =
  'mongodb://dev_example:example-only@127.0.0.1:27018/__DATABASE___example?authSource=__DATABASE___example';
const development = { NODE_ENV: 'development' };

describe('database command boundaries', () => {
  it('allows confirmed personal remote and explicitly named local DB resets', () => {
    const target = databaseTarget(uri, development);
    expect(() => requireReset(target, target.database)).not.toThrow();
    expect(() => requireSeed(target)).not.toThrow();
    const local = databaseTarget(
      'mongodb://localhost:27017/__DATABASE___local',
      development,
    );
    expect(local.personal).toBe(true);
  });
  it('rejects resets of shared/prod DBs, mismatched accounts, direct servers and wrong confirmations', () => {
    for (const value of [
      'mongodb://127.0.0.1:27017/__DATABASE__',
      uri.replace('dev_example:', '__DATABASE___dev_app:'),
      uri.replace('127.0.0.1', 'example.com'),
      uri.replace('27018', '27017'),
    ])
      expect(() =>
        requireReset(
          databaseTarget(value, development),
          '__DATABASE___example',
        ),
      ).toThrow();
    expect(() =>
      requireReset(databaseTarget(uri, development), 'wrong_database'),
    ).toThrow();
    for (const env of [{ NODE_ENV: 'production' }, { APP_ENV: 'prod' }])
      expect(() =>
        requireReset(databaseTarget(uri, env), '__DATABASE___example'),
      ).toThrow();
  });
  it('never turns shared dev seeding into permission to reset it', () => {
    const shared = databaseTarget(
      'mongodb://__DATABASE___dev_app:example-only@anico-dev-mongodb:27017/__DATABASE__?authSource=__DATABASE__',
      { NODE_ENV: 'production', APP_ENV: 'dev' },
    );
    expect(() => requireSeed(shared)).toThrow();
    expect(() => requireSeed(shared, true)).not.toThrow();
    expect(() => requireReset(shared, '__DATABASE__')).toThrow();
    const prod = databaseTarget(
      'mongodb://__DATABASE___prod_app:example-only@anico-prod-mongodb:27017/__DATABASE__?authSource=__DATABASE__',
      { NODE_ENV: 'production', APP_ENV: 'prod' },
    );
    expect(() => requireSeed(prod, true)).toThrow();
  });
  it('refuses root, other services, admin authSource and malformed URIs', () => {
    for (const value of [
      'not-a-uri',
      'https://example.com/__DATABASE__',
      uri.replace('__DATABASE___example', 'admin'),
      uri.replace('dev_example:', 'anico_root:'),
      uri.replace('authSource=__DATABASE___example', 'authSource=admin'),
    ])
      expect(() => databaseTarget(value, development)).toThrow();
  });
  it('parses only explicit supported commands and compatible options', () => {
    expect(
      databaseOptions(['migrate', '--retry', '20261031000100-example']).retry,
    ).toBe('20261031000100-example');
    expect(databaseOptions(['seed', '--shared']).shared).toBe(true);
    expect(
      databaseOptions(['reset', '--confirm=__DATABASE___example']).confirm,
    ).toBe('__DATABASE___example');
    expect(
      databaseOptions(['unlock', '--owner', 'owner', '--confirm', 'db']).owner,
    ).toBe('owner');
    expect(databaseOptions(['new', 'add-field']).name).toBe('add-field');
    expect(databaseOptions(['status']).command).toBe('status');
    for (const args of [
      [],
      ['drop'],
      ['reset'],
      ['unlock'],
      ['new'],
      ['status', 'extra'],
      ['status', '--shared'],
      ['seed', '--retry', 'id'],
      ['status', '--owner', 'id'],
      ['migrate', '--confirm', 'db'],
      ['status', '--unknown'],
    ])
      expect(() => databaseOptions(args)).toThrow();
  });
});
