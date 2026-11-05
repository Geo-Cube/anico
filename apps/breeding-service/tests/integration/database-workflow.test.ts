import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection, Types } from 'mongoose';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HISTORY,
  LOCKS,
  migrateDatabase,
  migrationStatus,
  resetDatabase,
  seedDatabase,
  unlockDatabase,
  type Migration,
} from '../../src/database/engine.js';
import {
  createMigration,
  loadMigrations,
  loadSeed,
} from '../../src/database/registry.js';

function migration(
  up: Migration['up'],
  id = '20261031000200-example',
): Migration {
  return { id, checksum: createHash('sha256').update(id).digest('hex'), up };
}

describe('database lifecycle against isolated temporary MongoDB', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let sequence = 0;
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
  });
  beforeEach(async () => {
    connection = await mongoose
      .createConnection(mongo.getUri(), {
        dbName: `anico_breeding_test_${sequence++}`,
      })
      .asPromise();
  });
  afterEach(async () => {
    await connection.dropDatabase();
    await connection.close();
  });
  afterAll(async () => {
    await mongo.stop();
  });
  const target = () => ({
    database: connection.name,
    personal: true,
    sharedDev: false,
  });
  const history = () =>
    connection.db!.collection<{ _id: string; state: string; checksum: string }>(
      HISTORY,
    );
  const locks = () =>
    connection.db!.collection<{ _id: string; owner: string; startedAt: Date }>(
      LOCKS,
    );

  it('reports pending/applied migrations and runs each migration once', async () => {
    const change = migration(async (c) => {
      await c.db!.collection('probe').insertOne({ value: 1 });
    });
    expect(
      (await migrationStatus(connection, [change])).migrations[0]?.state,
    ).toBe('pending');
    expect(await migrateDatabase(connection, [change])).toEqual([change.id]);
    expect(await migrateDatabase(connection, [change])).toEqual([]);
    expect(await connection.db!.collection('probe').countDocuments()).toBe(1);
    expect(
      (await migrationStatus(connection, [change])).migrations[0]?.state,
    ).toBe('applied');
    expect(await locks().countDocuments()).toBe(0);
  });
  it('serializes migrations, seed and reset without stealing a held lock', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const finish = new Promise<void>((r) => {
      release = r;
    });
    const change = migration(async () => {
      entered();
      await finish;
    });
    const first = migrateDatabase(connection, [change]);
    await started;
    try {
      const owner = (await migrationStatus(connection, [change])).lock!.owner;
      await expect(migrateDatabase(connection, [change])).rejects.toMatchObject(
        { code: 'DATABASE_BUSY' },
      );
      await expect(
        seedDatabase(connection, [], async () => {}, target()),
      ).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
      await expect(
        resetDatabase(
          connection,
          [],
          async () => {},
          target(),
          connection.name,
        ),
      ).rejects.toMatchObject({ code: 'DATABASE_BUSY' });
      expect((await migrationStatus(connection, [change])).lock!.owner).toBe(
        owner,
      );
    } finally {
      release();
      await first;
    }
  });
  it('rejects checksum edits, unknown history and insertion before applied migrations', async () => {
    const change = migration(async () => {});
    await migrateDatabase(connection, [change]);
    await expect(
      migrateDatabase(connection, [{ ...change, checksum: 'f'.repeat(64) }]),
    ).rejects.toMatchObject({ code: 'CHECKSUM_CHANGED' });
    expect(
      (
        await migrationStatus(connection, [
          { ...change, checksum: 'f'.repeat(64) },
        ])
      ).migrations[0]?.checksumMatches,
    ).toBe(false);
    await expect(migrateDatabase(connection, [])).rejects.toMatchObject({
      code: 'UNKNOWN_MIGRATION',
    });
    expect((await migrationStatus(connection, [])).unknown).toHaveLength(1);
    await expect(
      migrateDatabase(connection, [
        migration(async () => {}, '20261031000100-earlier'),
        change,
      ]),
    ).rejects.toMatchObject({ code: 'OUT_OF_ORDER' });
  });
  it('records partial failure, hides error details and requires an explicit idempotent retry', async () => {
    let broken = true;
    const change = migration(async (c) => {
      await c
        .db!.collection('probe')
        .updateOne({ key: 'one' }, { $set: { value: 1 } }, { upsert: true });
      if (broken) throw new Error('private-database-password');
    });
    await expect(migrateDatabase(connection, [change])).rejects.toThrow(
      /details hidden/,
    );
    expect(
      (await migrationStatus(connection, [change])).migrations[0]?.state,
    ).toBe('failed');
    expect(await locks().countDocuments()).toBe(0);
    await expect(migrateDatabase(connection, [change])).rejects.toMatchObject({
      code: 'MIGRATION_UNFINISHED',
    });
    await expect(
      migrateDatabase(connection, [change], 'missing'),
    ).rejects.toMatchObject({ code: 'INVALID_RETRY' });
    broken = false;
    const repaired = { ...change, checksum: 'f'.repeat(64) };
    await expect(migrateDatabase(connection, [repaired])).rejects.toMatchObject(
      {
        code: 'CHECKSUM_CHANGED',
      },
    );
    await migrateDatabase(connection, [repaired], change.id);
    expect(
      (await migrationStatus(connection, [repaired])).migrations[0],
    ).toMatchObject({ state: 'applied', checksumMatches: true });
    expect(await connection.db!.collection('probe').countDocuments()).toBe(1);
    await expect(
      migrateDatabase(connection, [repaired], change.id),
    ).rejects.toMatchObject({ code: 'INVALID_RETRY' });
    await expect(
      migrateDatabase(connection, [change], change.id),
    ).rejects.toMatchObject({ code: 'CHECKSUM_CHANGED' });
  });
  it('requires review of a running journal left after abrupt termination', async () => {
    const change = migration(async () => {});
    await history().insertOne({
      _id: change.id,
      checksum: change.checksum,
      state: 'running',
    });
    await expect(migrateDatabase(connection, [change])).rejects.toMatchObject({
      code: 'MIGRATION_UNFINISHED',
    });
    await migrateDatabase(connection, [change], change.id);
  });
  it('backs up missing timestamps without replacing existing values', async () => {
    const plans = connection.db!.collection('breedingplans');
    const id = new Types.ObjectId();
    const fixed = new Date('2020-01-01T00:00:00Z');
    await plans.insertMany([
      { _id: id, name: 'Legacy' },
      { name: 'Current', createdAt: fixed, updatedAt: fixed },
    ]);
    const changes = await loadMigrations();
    await migrateDatabase(connection, changes);
    const legacy = await plans.findOne({ _id: id });
    expect(legacy?.createdAt).toEqual(id.getTimestamp());
    expect(legacy?.updatedAt).toEqual(id.getTimestamp());
    expect((await plans.findOne({ name: 'Current' }))?.updatedAt).toEqual(
      fixed,
    );
    await changes[0]!.up(connection);
    expect(await plans.countDocuments()).toBe(2);
  });
  it('seeds idempotently, preserves user edits and refuses fixture ID collisions', async () => {
    const changes = await loadMigrations();
    const seed = await loadSeed();
    await seedDatabase(connection, changes, seed, target());
    await connection
      .db!.collection('breedingplans')
      .updateOne(
        { name: 'Ukázkový odchov A' },
        { $set: { name: 'My edited fixture' } },
      );
    await seedDatabase(connection, changes, seed, target());
    expect(
      await connection.db!.collection('breedingplans').countDocuments(),
    ).toBe(2);
    expect(
      await connection
        .db!.collection('breedingplans')
        .countDocuments({ name: 'My edited fixture' }),
    ).toBe(1);
    await connection.db!.collection('breedingplans').deleteMany({});
    await connection.db!.collection('breedingplans').insertOne({
      _id: new Types.ObjectId('a11c00000000000000000001'),
      name: 'Real record',
    });
    await expect(
      seedDatabase(connection, changes, seed, target()),
    ).rejects.toMatchObject({ code: 'SEED_FAILED' });
    expect(
      (
        await connection
          .db!.collection('breedingplans')
          .findOne({ name: 'Real record' })
      )?.name,
    ).toBe('Real record');
  });
  it('refuses destructive operations before acquiring a lock on a shared target', async () => {
    await expect(
      resetDatabase(
        connection,
        [],
        async () => {},
        { ...target(), personal: false, sharedDev: true },
        connection.name,
      ),
    ).rejects.toMatchObject({ code: 'RESET_FORBIDDEN' });
    await expect(
      resetDatabase(connection, [], async () => {}, target(), 'wrong'),
    ).rejects.toMatchObject({ code: 'RESET_FORBIDDEN' });
    await expect(
      seedDatabase(connection, [], async () => {}, {
        ...target(),
        personal: false,
        sharedDev: true,
      }),
    ).rejects.toMatchObject({ code: 'SEED_FORBIDDEN' });
    await expect(
      seedDatabase(connection, [], async () => {}, {
        ...target(),
        database: 'other',
      }),
    ).rejects.toMatchObject({ code: 'TARGET_MISMATCH' });
    expect(await locks().countDocuments()).toBe(0);
    await seedDatabase(
      connection,
      [],
      async () => {},
      { ...target(), personal: false, sharedDev: true },
      true,
    );
  });
  it('resets only its personal DB, reapplies migrations, seeds and preserves other DBs', async () => {
    const other = connection.getClient().db('anico_breeding_other');
    await other.collection('keep').insertOne({ value: 'untouched' });
    try {
      await connection.db!.collection('private_draft').insertOne({ value: 1 });
      await resetDatabase(
        connection,
        await loadMigrations(),
        await loadSeed(),
        target(),
        connection.name,
      );
      expect(
        await connection.db!.collection('private_draft').countDocuments(),
      ).toBe(0);
      expect(
        await connection.db!.collection('breedingplans').countDocuments(),
      ).toBe(2);
      expect(
        (await migrationStatus(connection, await loadMigrations()))
          .migrations[0]?.state,
      ).toBe('applied');
      expect(await other.collection('keep').countDocuments()).toBe(1);
    } finally {
      await other.dropDatabase();
    }
  });
  it('blocks regular migration after an interrupted reset until reset is completed', async () => {
    await expect(
      resetDatabase(
        connection,
        [],
        async () => {
          throw new Error('private');
        },
        target(),
        connection.name,
      ),
    ).rejects.toMatchObject({ code: 'RESET_FAILED' });
    await expect(migrateDatabase(connection, [])).rejects.toMatchObject({
      code: 'RESET_INCOMPLETE',
    });
    await resetDatabase(
      connection,
      [],
      async () => {},
      target(),
      connection.name,
    );
    expect((await migrationStatus(connection, [])).unknown).toEqual([]);
  });
  it('removes a stale lock only with matching owner and explicit DB confirmation', async () => {
    const owner = randomUUID();
    await locks().insertOne({
      _id: 'maintenance',
      owner,
      startedAt: new Date(),
    });
    await expect(
      unlockDatabase(connection, owner, 'wrong'),
    ).rejects.toMatchObject({ code: 'UNLOCK_FORBIDDEN' });
    await expect(
      unlockDatabase(connection, 'invalid', connection.name),
    ).rejects.toMatchObject({ code: 'UNLOCK_FORBIDDEN' });
    await expect(
      unlockDatabase(connection, randomUUID(), connection.name),
    ).rejects.toMatchObject({ code: 'LOCK_CHANGED' });
    await unlockDatabase(connection, owner, connection.name);
    expect(await locks().countDocuments()).toBe(0);
  });
  it('rejects duplicate IDs and malformed checksums without leaking locks', async () => {
    const change = migration(async () => {});
    for (const changes of [
      [change, change],
      [{ ...change, id: 'wrong' }],
      [{ ...change, checksum: 'wrong' }],
    ])
      await expect(migrateDatabase(connection, changes)).rejects.toMatchObject({
        code: 'INVALID_MIGRATIONS',
      });
    expect(await locks().countDocuments()).toBe(0);
  });
  it('generates migration stubs, normalizes CRLF checksums and rejects malformed modules', async () => {
    const path = await mkdtemp(join(tmpdir(), 'anico-migration-test-'));
    const folder = pathToFileURL(path + '/');
    try {
      const name = await createMigration(
        'add-field',
        folder,
        new Date('2026-10-31T12:00:00Z'),
      );
      expect(name).toBe('20261031120000-add-field.mjs');
      await expect(
        createMigration('not a safe name', folder),
      ).rejects.toMatchObject({ code: 'INVALID_NAME' });
      const first = await loadMigrations(folder);
      await expect(first[0]!.up(connection)).rejects.toThrow('not implemented');
      const contents = await readFile(new URL(name, folder), 'utf8');
      await writeFile(new URL(name, folder), contents.replace(/\n/g, '\r\n'));
      expect((await loadMigrations(folder))[0]!.checksum).toBe(
        first[0]!.checksum,
      );
      await writeFile(new URL('bad.mjs', folder), 'export const value=1;');
      await expect(loadMigrations(folder)).rejects.toMatchObject({
        code: 'INVALID_MIGRATIONS',
      });
      await rm(new URL('bad.mjs', folder));
      await writeFile(
        new URL('20261031130000-no-up.mjs', folder),
        'export const value=1;',
      );
      await expect(loadMigrations(folder)).rejects.toMatchObject({
        code: 'INVALID_MIGRATIONS',
      });
    } finally {
      await rm(path, { recursive: true, force: true });
    }
  });
});
