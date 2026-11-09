import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection, Types } from 'mongoose';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { HISTORY } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function start(uri: string, port: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'dev',
      MONGODB_URI: uri,
      MIGRATE_ON_START: 'true',
      HOST: '127.0.0.1',
      PORT: String(port),
      AUTH_JWKS_JSON: '',
      AUTH_JWKS_URL: 'http://127.0.0.1:1/api/auth/.well-known/jwks.json',
      AUTH_ISSUER: 'anico-startup-test',
      AUTH_AUDIENCE: 'anico-api',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (value) => {
    output += value.toString();
  });
  child.stderr!.on('data', (value) => {
    output += value.toString();
  });
  /** Čeká na skutečný signál procesu („Server listening“), ne na odhadnutý čas; `false` při ukončení. */
  const listening = new Promise<boolean>((resolve) => {
    child.stdout!.on('data', () => {
      if (output.includes('Server listening')) resolve(true);
    });
    child.once('exit', () => resolve(false));
  });
  return { child, output: () => output, listening };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit');
  child.kill('SIGTERM');
  await exit;
}

describe('migration gate before actual HTTP startup', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri(), {
        dbName: 'anico_breeding_startup_test',
      })
      .asPromise();
  });
  afterAll(async () => {
    await connection.close();
    await mongo.stop();
  });
  // Dva skutečné starty přes tsx: na CI pod coverage trvá každý i přes 5 s.
  it(
    'finishes migrations before readiness and refuses an unfinished migration on restart',
    { timeout: 60_000 },
    async () => {
      const id = new Types.ObjectId();
      await connection
        .db!.collection('breedingplans')
        .insertOne({ _id: id, name: 'Legacy plan' });
      const port = await freePort();
      const uri = mongo.getUri('anico_breeding_startup_test');
      const running = start(uri, port);
      try {
        expect(await running.listening, running.output()).toBe(true);
        expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(
          200,
        );
        expect(
          (await fetch(`http://127.0.0.1:${port}/api/breeding-plans`)).status,
        ).toBe(401);
        expect(
          (
            await connection
              .db!.collection('breedingplans')
              .findOne({ _id: id })
          )?.createdAt,
        ).toEqual(id.getTimestamp());
        const change = (await loadMigrations())[0]!;
        const history = connection.db!.collection<{
          _id: string;
          state: string;
        }>(HISTORY);
        expect((await history.findOne({ _id: change.id }))?.state).toBe(
          'applied',
        );
        await stop(running.child);
        await history.updateOne(
          { _id: change.id },
          { $set: { state: 'failed' } },
        );
        const blocked = start(uri, port);
        try {
          const [code] = await once(blocked.child, 'exit');
          expect(code).toBe(1);
          expect(blocked.output()).toContain('Database migrations failed');
          expect(blocked.output()).not.toContain(uri);
          await expect(
            fetch(`http://127.0.0.1:${port}/ready`, {
              signal: AbortSignal.timeout(1000),
            }),
          ).rejects.toThrow();
        } finally {
          await stop(blocked.child);
        }
      } finally {
        await stop(running.child);
      }
    },
  );
});
