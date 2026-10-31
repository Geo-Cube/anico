import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  databaseCredentialsSchema,
  reconcileDatabaseCredentials,
} from '../src/dev-database.js';

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
