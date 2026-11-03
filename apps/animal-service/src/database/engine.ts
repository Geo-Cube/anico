import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import {
  DatabaseTaskError,
  requireReset,
  requireSeed,
  type DatabaseTarget,
} from './policy.js';

export const HISTORY = '_anico_migrations';
export const LOCKS = '_anico_migration_lock';
const LOCK_ID = 'maintenance';
const writeConcern = { w: 'majority', j: true, wtimeoutMS: 10_000 } as const;
interface History {
  _id: string;
  checksum: string;
  state: 'running' | 'applied' | 'failed';
  startedAt: Date;
  appliedAt?: Date;
}
interface Lock {
  _id: string;
  owner: string;
  startedAt: Date;
}
export interface Migration {
  id: string;
  checksum: string;
  up: (connection: Connection) => Promise<void>;
}
export type Seed = (connection: Connection) => Promise<void>;

function database(connection: Connection) {
  if (!connection.db)
    throw new DatabaseTaskError(
      'NOT_CONNECTED',
      'Database connection is not ready',
    );
  return connection.db;
}

function ordered(migrations: Migration[]) {
  const sorted = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  if (
    new Set(sorted.map((item) => item.id)).size !== sorted.length ||
    sorted.some(
      (item) =>
        !/^\d{14}-[a-z0-9-]+$/.test(item.id) ||
        !/^[a-f0-9]{64}$/.test(item.checksum),
    )
  )
    throw new DatabaseTaskError(
      'INVALID_MIGRATIONS',
      'Migration IDs must be unique timestamped names with SHA-256 checksums',
    );
  return sorted;
}

async function withLock<T>(connection: Connection, action: () => Promise<T>) {
  const locks = database(connection).collection<Lock>(LOCKS, { writeConcern });
  const owner = randomUUID();
  try {
    await locks.insertOne({ _id: LOCK_ID, owner, startedAt: new Date() });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error &&
      'code' in error &&
      error.code === 11000
    )
      throw new DatabaseTaskError(
        'DATABASE_BUSY',
        'Another database operation owns the lock; inspect db:status',
      );
    throw new DatabaseTaskError(
      'LOCK_FAILED',
      'Cannot acquire database lock; details hidden',
    );
  }
  try {
    return await action();
  } finally {
    await locks.deleteOne({ _id: LOCK_ID, owner });
  }
}

async function migrateLocked(
  connection: Connection,
  migrations: Migration[],
  retry?: string,
  resetting = false,
) {
  const history = database(connection).collection<History>(HISTORY, {
    writeConcern,
  });
  const rows = await history.find().toArray();
  if (!resetting && rows.some((row) => row._id === '_reset'))
    throw new DatabaseTaskError(
      'RESET_INCOMPLETE',
      'An interrupted personal reset must be completed with db:reset',
    );
  const sorted = ordered(migrations);
  const known = new Map(sorted.map((item) => [item.id, item]));
  const byId = new Map(
    rows.filter((row) => row._id !== '_reset').map((row) => [row._id, row]),
  );
  for (const row of byId.values()) {
    if (!known.has(row._id))
      throw new DatabaseTaskError(
        'UNKNOWN_MIGRATION',
        'Database contains a migration absent from this checkout; use the matching code',
      );
    if (
      known.get(row._id)!.checksum !== row.checksum &&
      (row.state === 'applied' || retry !== row._id)
    )
      throw new DatabaseTaskError(
        'CHECKSUM_CHANGED',
        `Migration ${row._id} was edited; applied migrations are immutable and unfinished edits require explicit retry`,
      );
  }
  if (
    retry &&
    (!known.has(retry) ||
      !byId.has(retry) ||
      byId.get(retry)!.state === 'applied')
  )
    throw new DatabaseTaskError(
      'INVALID_RETRY',
      'Retry must name an existing unfinished migration',
    );
  let pending = false;
  for (const item of sorted) {
    const row = byId.get(item.id);
    if (row?.state === 'applied') {
      if (pending)
        throw new DatabaseTaskError(
          'OUT_OF_ORDER',
          'A new migration was inserted before an already applied migration',
        );
    } else {
      pending = true;
      if (row && retry !== item.id)
        throw new DatabaseTaskError(
          'MIGRATION_UNFINISHED',
          `Migration ${item.id} is unfinished; inspect partial changes before an explicit --retry`,
        );
    }
  }
  const applied: string[] = [];
  for (const item of sorted) {
    if (byId.get(item.id)?.state === 'applied') continue;
    await history.replaceOne(
      { _id: item.id },
      {
        checksum: item.checksum,
        state: 'running',
        startedAt: new Date(),
      },
      { upsert: true },
    );
    try {
      await item.up(connection);
      await history.updateOne(
        { _id: item.id },
        { $set: { state: 'applied', appliedAt: new Date() } },
      );
      applied.push(item.id);
    } catch {
      await history.updateOne({ _id: item.id }, { $set: { state: 'failed' } });
      throw new DatabaseTaskError(
        'MIGRATION_FAILED',
        `Migration ${item.id} failed; private details hidden; inspect data before retrying`,
      );
    }
  }
  return applied;
}

export async function migrationStatus(
  connection: Connection,
  migrations: Migration[],
) {
  const db = database(connection);
  const rows = await db
    .collection<History>(HISTORY)
    .find()
    .sort({ _id: 1 })
    .toArray();
  const known = new Map(ordered(migrations).map((item) => [item.id, item]));
  const previous = new Map(rows.map((row) => [row._id, row]));
  return {
    database: db.databaseName,
    lock: await db.collection<Lock>(LOCKS).findOne({ _id: LOCK_ID }),
    migrations: [...known.values()].map((item) => ({
      id: item.id,
      state: previous.get(item.id)?.state ?? 'pending',
      checksumMatches:
        !previous.has(item.id) ||
        previous.get(item.id)!.checksum === item.checksum,
    })),
    unknown: rows
      .filter((row) => !known.has(row._id))
      .map((row) => ({ id: row._id, state: row.state })),
  };
}

export function migrateDatabase(
  connection: Connection,
  migrations: Migration[],
  retry?: string,
) {
  return withLock(connection, () =>
    migrateLocked(connection, migrations, retry),
  );
}

function matchTarget(connection: Connection, target: DatabaseTarget) {
  if (database(connection).databaseName !== target.database)
    throw new DatabaseTaskError(
      'TARGET_MISMATCH',
      'Connected database differs from the validated target',
    );
}

export async function seedDatabase(
  connection: Connection,
  migrations: Migration[],
  seed: Seed,
  target: DatabaseTarget,
  shared = false,
) {
  matchTarget(connection, target);
  requireSeed(target, shared);
  return withLock(connection, async () => {
    await migrateLocked(connection, migrations);
    try {
      await seed(connection);
    } catch {
      throw new DatabaseTaskError(
        'SEED_FAILED',
        'Seed failed; details hidden; idempotent seed may be repeated',
      );
    }
  });
}

export async function resetDatabase(
  connection: Connection,
  migrations: Migration[],
  seed: Seed,
  target: DatabaseTarget,
  confirmation?: string,
) {
  matchTarget(connection, target);
  requireReset(target, confirmation);
  return withLock(connection, async () => {
    const db = database(connection);
    const history = db.collection<History>(HISTORY, { writeConcern });
    await history.replaceOne(
      { _id: '_reset' },
      { checksum: '', state: 'running', startedAt: new Date() },
      { upsert: true },
    );
    try {
      const collections = await db
        .listCollections({}, { nameOnly: true })
        .toArray();
      for (const item of collections) {
        if (
          [HISTORY, LOCKS].includes(item.name) ||
          item.name.startsWith('system.')
        )
          continue;
        await db.dropCollection(item.name);
      }
      await history.deleteMany({ _id: { $ne: '_reset' } });
      await migrateLocked(connection, migrations, undefined, true);
      await seed(connection);
      await history.deleteOne({ _id: '_reset' });
    } catch {
      await history.updateOne({ _id: '_reset' }, { $set: { state: 'failed' } });
      throw new DatabaseTaskError(
        'RESET_FAILED',
        'Personal reset was interrupted; inspect and repeat the explicit reset',
      );
    }
  });
}

export async function unlockDatabase(
  connection: Connection,
  owner: string,
  confirmation: string,
) {
  if (
    confirmation !== database(connection).databaseName ||
    !/^[a-f0-9-]{36}$/.test(owner)
  )
    throw new DatabaseTaskError(
      'UNLOCK_FORBIDDEN',
      'Unlock requires the exact database name and lock owner from db:status',
    );
  const result = await database(connection)
    .collection<Lock>(LOCKS, { writeConcern })
    .deleteOne({ _id: LOCK_ID, owner });
  if (result.deletedCount !== 1)
    throw new DatabaseTaskError(
      'LOCK_CHANGED',
      'Lock owner changed or no matching lock exists',
    );
}
