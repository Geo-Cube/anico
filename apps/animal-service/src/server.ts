import mongoose from 'mongoose';
import { pino } from 'pino';
import { z } from 'zod';
import { createApp } from './app.js';
import { migrateDatabase } from './database/engine.js';
import { loadMigrations } from './database/registry.js';
import { databaseTarget } from './database/policy.js';

const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1', '::']).default('127.0.0.1'),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    MIGRATE_ON_START: z.enum(['true', 'false']).default('false'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .parse(process.env);

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'animal-service' },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

const connection = mongoose.createConnection();

try {
  await connection.openUri(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });
  if (env.MIGRATE_ON_START === 'true') {
    try {
      databaseTarget(env.MONGODB_URI, process.env);
      const applied = await migrateDatabase(connection, await loadMigrations());
      logger.info(
        { applied },
        'Database migrations verified before HTTP startup',
      );
    } catch {
      throw new Error(
        'Database migrations failed; inspect db:status before retrying',
      );
    }
  }
  let stopping = false;
  const app = createApp({
    logger,
    isReady: () => !stopping && connection.readyState === 1,
  });
  const server = app.listen(env.PORT, env.HOST, () =>
    logger.info({ port: env.PORT }, 'Server listening'),
  );
  server.on('error', (error) => {
    logger.fatal({ err: error }, 'HTTP server failed');
    void shutdown(1);
  });

  async function shutdown(code: number) {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    try {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await connection.close();
      logger.info('Server stopped');
      process.exitCode = code;
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      await connection.close().catch(() => undefined);
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  }

  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
} catch {
  logger.fatal(
    'Startup failed; inspect database connectivity and migration status. Private details suppressed.',
  );
  await connection.close();
  process.exitCode = 1;
}
