import { readFile } from 'node:fs/promises';
import mongoose from 'mongoose';
import { databaseOptions } from './options.js';
import {
  DatabaseTaskError,
  databaseTarget,
  requireReset,
  requireSeed,
} from './policy.js';
import { loadMigrations, loadSeed, createMigration } from './registry.js';
import {
  migrateDatabase,
  migrationStatus,
  resetDatabase,
  seedDatabase,
  unlockDatabase,
} from './engine.js';

const connection = mongoose.createConnection();
try {
  const options = databaseOptions(process.argv.slice(2));
  if (options.command === 'new') {
    console.log(`Created migrations/${await createMigration(options.name!)}`);
  } else {
    const uri =
      process.env.MONGODB_URI ??
      (process.env.MONGODB_URI_FILE
        ? (await readFile(process.env.MONGODB_URI_FILE, 'utf8')).trim()
        : undefined);
    if (!uri)
      throw new DatabaseTaskError(
        'MISSING_URI',
        'Set MONGODB_URI or MONGODB_URI_FILE; private values are never printed',
      );
    const target = databaseTarget(uri, process.env);
    // Reject destructive commands before connecting, not just before writing.
    if (options.command === 'reset') requireReset(target, options.confirm);
    if (options.command === 'seed') requireSeed(target, options.shared);
    await connection.openUri(uri, {
      serverSelectionTimeoutMS: 10000,
      autoIndex: false,
      autoCreate: false,
    });
    const migrations = await loadMigrations();
    switch (options.command) {
      case 'status':
        console.log(
          JSON.stringify(
            await migrationStatus(connection, migrations),
            null,
            2,
          ),
        );
        break;
      case 'migrate':
        console.log(
          JSON.stringify({
            applied: await migrateDatabase(
              connection,
              migrations,
              options.retry,
            ),
          }),
        );
        break;
      case 'seed':
        await seedDatabase(
          connection,
          migrations,
          await loadSeed(),
          target,
          options.shared,
        );
        console.log(
          'Development seed completed; existing fixture edits preserved.',
        );
        break;
      case 'reset':
        await resetDatabase(
          connection,
          migrations,
          await loadSeed(),
          target,
          options.confirm,
        );
        console.log('Personal database reset, migrated and seeded.');
        break;
      case 'unlock':
        await unlockDatabase(connection, options.owner!, options.confirm!);
        console.log(
          'Matching lock removed. Inspect unfinished migration state before retrying.',
        );
        break;
    }
  }
} catch (error) {
  console.error(
    error instanceof DatabaseTaskError
      ? `${error.code}: ${error.message}`
      : 'DATABASE_TASK_FAILED: database operation failed; credentials and driver details suppressed',
  );
  process.exitCode = 1;
} finally {
  await connection.close().catch(() => undefined);
}
