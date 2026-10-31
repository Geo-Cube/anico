import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  databaseCredentialsSchema,
  reconcileDatabaseCredentials,
  databaseProvisioningAccounts,
  discoverDatabaseServices,
} from '../src/dev-database.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const members = [
  { login: 'Example-One', email: 'one@example.com' },
  { login: 'Example-Two', email: 'two@example.com' },
];
function passwords() {
  let counter = 0;
  return () => (++counter).toString(16).padStart(64, '0');
}
test('every developer and deployed dev app receive separate accounts and databases', () => {
  const result = reconcileDatabaseCredentials(members, undefined, passwords());
  assert.equal(result.app.database, 'anico_breeding');
  assert.deepEqual(
    result.developers.map((member) => member.database),
    ['anico_breeding_example_one', 'anico_breeding_example_two'],
  );
  assert.equal(
    new Set([
      result.root.password,
      result.app.password,
      ...result.developers.map((member) => member.password),
    ]).size,
    4,
  );
});
test('repeated provisioning preserves passwords and database identifiers', () => {
  const first = reconcileDatabaseCredentials(members, undefined, passwords());
  assert.deepEqual(
    reconcileDatabaseCredentials(members, first, () => {
      throw new Error('Must not regenerate passwords');
    }),
    first,
  );
});
test('removed developers are deactivated without deleting their data definitions', () => {
  const first = reconcileDatabaseCredentials(members, undefined, passwords());
  const next = reconcileDatabaseCredentials([members[0]], first, passwords());
  assert.equal(next.developers[1]?.active, false);
  assert.equal(next.developers[1]?.password, first.developers[1]?.password);
});
test('duplicates and moving a workspace to another database are rejected', () => {
  assert.throws(() =>
    reconcileDatabaseCredentials(
      [members[0], members[0]],
      undefined,
      passwords(),
    ),
  );
  const first = reconcileDatabaseCredentials(members, undefined, passwords());
  first.developers[0]!.database = 'anico_breeding_production';
  assert.throws(() => databaseCredentialsSchema.parse(first));
});

test('one stable account receives only its own service databases; app permissions stay unchanged', () => {
  const credentials = reconcileDatabaseCredentials(
    members,
    undefined,
    passwords(),
  );
  const accounts = databaseProvisioningAccounts(credentials, [
    'breeding-service',
    'auth-service',
  ]);
  assert.deepEqual(accounts[0]?.databases, ['anico_breeding']);
  assert.deepEqual(accounts[1]?.databases, [
    'anico_auth_example_one',
    'anico_breeding_example_one',
  ]);
  assert.deepEqual(accounts[2]?.databases, [
    'anico_auth_example_two',
    'anico_breeding_example_two',
  ]);
  assert.equal(accounts[1]?.database, credentials.developers[0]?.database);
  assert.equal(accounts[1]?.password, credentials.developers[0]?.password);
  assert.equal(accounts[1]?.username, credentials.developers[0]?.username);
  assert.ok(!('email' in accounts[1]!));
  assert.throws(() =>
    databaseProvisioningAccounts(credentials, ['auth-service']),
  );
  assert.throws(() =>
    databaseProvisioningAccounts(credentials, [
      'breeding-service',
      '../admin-service',
    ]),
  );
  assert.throws(() =>
    databaseProvisioningAccounts(credentials, [
      'breeding-service',
      'breeding-service',
    ]),
  );
});

test('provisioning discovers MongoDB service manifests, excluding frontend and temporary scaffolding', () => {
  const root = mkdtempSync(join(tmpdir(), 'anico-service-discovery-'));
  try {
    for (const name of [
      'breeding-service',
      'auth-service',
      'frontend',
      '.anico-scaffold-test',
    ]) {
      const folder = join(root, 'apps', name);
      mkdirSync(folder, { recursive: true });
      if (name.startsWith('.')) continue;
      writeFileSync(
        join(folder, 'package.json'),
        JSON.stringify({
          name: `@anico/${name}`,
          dependencies:
            name === 'frontend' ? { react: '*' } : { mongoose: '*' },
        }),
      );
    }
    assert.deepEqual(discoverDatabaseServices(root), [
      'auth-service',
      'breeding-service',
    ]);
    mkdirSync(join(root, 'infrastructure'));
    writeFileSync(
      join(root, 'infrastructure/dev-database-services.json'),
      JSON.stringify(['animal-service', 'auth-service', 'breeding-service']),
    );
    assert.deepEqual(discoverDatabaseServices(root), [
      'animal-service',
      'auth-service',
      'breeding-service',
    ]);
    writeFileSync(
      join(root, 'apps/auth-service/package.json'),
      JSON.stringify({
        name: '@anico/wrong-service',
        dependencies: { mongoose: '*' },
      }),
    );
    assert.throws(() => discoverDatabaseServices(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
