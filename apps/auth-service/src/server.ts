import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
if (process.env.MONGODB_URI_FILE)
  process.env.MONGODB_URI = readFileSync(
    process.env.MONGODB_URI_FILE,
    'utf8',
  ).trim();
if (process.env.AUTH_TRUSTED_PROXY_CIDRS_FILE)
  process.env.AUTH_TRUSTED_PROXY_CIDRS = readFileSync(
    process.env.AUTH_TRUSTED_PROXY_CIDRS_FILE,
    'utf8',
  ).trim();
import { pino } from 'pino';
import { z } from 'zod';
import { createApp } from './app.js';
import { createModules } from './modules/index.js';
import { migrateDatabase } from './database/engine.js';
import { loadMigrations } from './database/registry.js';
import { databaseTarget } from './database/policy.js';
import { configuredRegistrationPublisher } from './modules/auth/infrastructure/nats-registration-publisher.js';
import { mongoRegistrationOutbox } from './modules/auth/infrastructure/registration-outbox.js';
import { registrationDispatcher } from './modules/auth/application/registration-dispatcher.js';
import { apiDocsEnabled } from './openapi/docs-router.js';
import { closeObservability, initObservability } from './observability.js';

const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    HOST: z.enum(['127.0.0.1', '0.0.0.0', '::1', '::']).default('127.0.0.1'),
    MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
    AUTH_TRUSTED_PROXY_CIDRS: z
      .string()
      .default('')
      .transform((value) =>
        value ? value.split(',').map((cidr) => cidr.trim()) : [],
      )
      .pipe(
        z.array(
          z
            .union([z.cidrv4(), z.cidrv6()])
            .refine((cidr) => !cidr.endsWith('/0')),
        ),
      ),
    MIGRATE_ON_START: z.enum(['true', 'false']).default('false'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SENTRY_DSN: z.union([z.literal(''), z.url()]).optional(),
    SENTRY_RELEASE: z.string().optional(),
  })
  .parse(process.env);

initObservability({
  dsn: env.SENTRY_DSN,
  environment: process.env.APP_ENV || 'local',
  release: env.SENTRY_RELEASE,
  service: 'auth-service',
  suppressErrorMessages: true,
});

const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'auth-service' },
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["cf-access-token"]',
    'req.headers["cf-access-jwt-assertion"]',
    'req.headers["cf-access-client-secret"]',
  ],
});

const connection = mongoose.createConnection();
let dispatcher: ReturnType<typeof registrationDispatcher> | undefined;

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
  const publisher = configuredRegistrationPublisher(process.env);
  if (publisher) {
    dispatcher = registrationDispatcher({
      outbox: mongoRegistrationOutbox(connection),
      publisher,
      logger,
    });
  }
  const app = createApp({
    logger,
    modules: await createModules(connection),
    apiDocs: apiDocsEnabled(process.env),
    trustedProxyCidrs: env.AUTH_TRUSTED_PROXY_CIDRS,
    isReady: () => !stopping && connection.readyState === 1,
  });
  const server = app.listen(env.PORT, env.HOST, () =>
    logger.info({ port: env.PORT }, 'Server listening'),
  );
  server.once('listening', () => dispatcher?.start());
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
      await dispatcher?.stop();
      await connection.close();
      logger.info('Server stopped');
      process.exitCode = code;
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      await dispatcher?.stop().catch(() => undefined);
      await connection.close().catch(() => undefined);
      process.exitCode = 1;
    } finally {
      await closeObservability(2_000);
      clearTimeout(timeout);
    }
  }

  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
} catch {
  logger.fatal(
    'Startup failed; inspect database connectivity and migration status. Private details suppressed.',
  );
  await closeObservability(2_000);
  await dispatcher?.stop().catch(() => undefined);
  await connection.close();
  process.exitCode = 1;
}
