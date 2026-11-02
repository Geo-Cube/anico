import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { createIdentityVerifier, requireAuth, requireRole } from '@anico/auth';
import express from 'express';
import { createApp } from '../../src/app.js';
import { appointInitialOwner } from '../../src/modules/auth/infrastructure/appoint-owner.js';
import { mongoAuthRepository } from '../../src/modules/auth/infrastructure/repository.js';
import {
  createAuthService,
  hash,
} from '../../src/modules/auth/application/auth.js';
import { authRouter } from '../../src/modules/auth/http/router.js';
import { identitySigner } from '../../src/modules/auth/infrastructure/signer.js';
import type {
  ProviderClient,
  Provider,
} from '../../src/modules/auth/domain/auth.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations, loadSeed } from '../../src/database/registry.js';
import { exportPKCS8 } from 'jose';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function firstCookie(response: { headers: Record<string, unknown> }): string {
  const values = response.headers['set-cookie'];
  if (!Array.isArray(values) || typeof values[0] !== 'string')
    throw new Error('Missing cookie');
  return values[0].split(';')[0]!;
}

describe('auth HTTP, sessions, authorization and MongoDB', () => {
  let mongo: MongoMemoryServer, connection: Connection, folder: string;
  let app: ReturnType<typeof createApp>,
    repo: ReturnType<typeof mongoAuthRepository>;
  let signer: Awaited<ReturnType<typeof identitySigner>>;
  let modules: ReturnType<typeof authRouter>;
  let now = new Date();
  const origin = 'https://dev.example.test',
    gatewayKey = 'test-gateway-secret';
  let provider: Provider = 'google',
    subject = 'first-user';
  const fake: ProviderClient = {
    async authorize(input) {
      return 'https://provider.example.test/login?state=' + input.state;
    },
    async exchange() {
      return {
        provider,
        issuer: 'https://' + provider + '.example.test',
        subject,
        givenName: 'Test',
        familyName: 'User',
        email: 'test@example.test',
      };
    },
  };
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('auth_test'))
      .asPromise();
    folder = await mkdtemp(join(tmpdir(), 'anico-auth-'));
    const keys = await generateKeyPair('ES256', { extractable: true });
    await writeFile(
      join(folder, 'key.pem'),
      await exportPKCS8(keys.privateKey),
      { mode: 0o600 },
    );
    signer = await identitySigner(
      join(folder, 'key.pem'),
      'https://auth.example.test',
      'anico-api-test',
    );
  });
  beforeEach(async () => {
    await connection.dropDatabase();
    await migrateDatabase(connection, await loadMigrations());
    now = new Date();
    provider = 'google';
    subject = 'first-user';
    repo = mongoAuthRepository(connection);
    const service = createAuthService({
      repository: repo,
      providers: { google: fake, microsoft: fake, apple: fake },
      publicOrigin: origin,
      sessionSeconds: 3600,
      now: () => now,
    });
    modules = authRouter({
      service,
      signer,
      publicOrigin: origin,
      gatewayKey,
      sessionSeconds: 3600,
    });
    app = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
      modules,
    });
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });
  async function login(which: Provider = 'google', user = 'first-user') {
    provider = which;
    subject = user;
    const start = await request(app)
      .get('/login/' + which)
      .expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const browser = firstCookie(start);
    const finish = await request(app)
      .get(`/login/${which}/callback`)
      .query({ state, code: 'test-code' })
      .set('Cookie', browser)
      .expect(303);
    const cookie = firstCookie(finish);
    const session = await request(app)
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    return {
      cookie,
      identity: session.body.identity,
      csrf: session.body.csrfToken,
      browser,
      state,
    };
  }
  it.each(['google', 'microsoft', 'apple'] as const)(
    'registers %s as breeder and never merges matching email across issuers',
    async (which) => {
      const first = await login(which);
      expect(first.identity.roles).toEqual(['breeder']);
      const repeated = await login(which);
      expect(repeated.identity.userId).toBe(first.identity.userId);
      expect(await connection.db!.collection('users').countDocuments()).toBe(1);
      const second = await login(which === 'google' ? 'microsoft' : 'google');
      expect(second.identity.userId).not.toBe(first.identity.userId);
      expect(
        (
          await connection
            .db!.collection('users')
            .findOne({ userId: first.identity.userId })
        )?.registration.status,
      ).toBe('pending');
    },
  );
  it('requires browser binding, consumes each callback once and rejects expired attempts', async () => {
    const start = await request(app).get('/login/google');
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const browser = firstCookie(start);
    await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'x' })
      .expect(401);
    await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'x' })
      .set('Cookie', browser)
      .expect(303);
    await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'x' })
      .set('Cookie', browser)
      .expect(401);
    const stale = await request(app).get('/login/google');
    const staleState = new URL(stale.headers.location!).searchParams.get(
      'state',
    )!;
    now = new Date(now.getTime() + 601000);
    await request(app)
      .get('/login/google/callback')
      .query({ state: staleState, code: 'x' })
      .set('Cookie', firstCookie(stale))
      .expect(401);
  });
  it('requires CSRF and immediately revokes logged-out sessions while keeping other sessions active', async () => {
    const one = await login(),
      two = await login();
    await request(app).post('/logout').set('Cookie', one.cookie).expect(403);
    await request(app)
      .post('/logout')
      .set('Cookie', one.cookie)
      .set('Origin', 'https://evil.example.test')
      .set('x-csrf-token', one.csrf)
      .expect(403);
    await request(app)
      .post('/logout')
      .set('Cookie', one.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', one.csrf)
      .expect(204);
    await request(app).get('/session').set('Cookie', one.cookie).expect(401);
    await request(app).get('/session').set('Cookie', two.cookie).expect(200);
    now = new Date(now.getTime() + 3601000);
    await request(app).get('/session').set('Cookie', two.cookie).expect(401);
  });
  it('only owner appoints admins, records audit and cannot promote another owner via role payload', async () => {
    const breeder = await login('google', 'breeder'),
      owner = await login('google', 'owner');
    await request(app)
      .put(`/users/${breeder.identity.userId}/admin`)
      .set('Cookie', breeder.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', breeder.csrf)
      .send({ admin: true })
      .expect(403);
    await connection
      .db!.collection('users')
      .updateOne(
        { userId: owner.identity.userId },
        { $addToSet: { roles: 'owner' } },
      );
    await request(app)
      .put(`/users/${breeder.identity.userId}/admin`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', owner.csrf)
      .send({ admin: true, roles: ['owner'] })
      .expect(400);
    const changed = await request(app)
      .put(`/users/${breeder.identity.userId}/admin`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', owner.csrf)
      .send({ admin: true })
      .expect(200);
    expect(changed.body.identity.roles).toContain('admin');
    expect(
      (
        await connection
          .db!.collection('users')
          .findOne({ userId: breeder.identity.userId })
      )?.roleAudit[0].actorId,
    ).toBe(owner.identity.userId);
    await request(app)
      .put(`/users/${owner.identity.userId}/admin`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .set('x-csrf-token', owner.csrf)
      .send({ admin: false })
      .expect(404);
  });
  it('gateway requires its credential and CSRF for unsafe methods; services reject spoofed headers and wrong JWT audience', async () => {
    const loginResult = await login();
    await request(app)
      .get('/internal/verify')
      .set('Cookie', loginResult.cookie)
      .expect(401);
    await request(app)
      .get('/internal/verify')
      .set('Cookie', loginResult.cookie)
      .set('x-anico-gateway-key', gatewayKey)
      .set('x-forwarded-method', 'POST')
      .expect(403);
    const verifyResponse = await request(app)
      .get('/internal/verify')
      .set('Cookie', loginResult.cookie)
      .set('x-anico-gateway-key', gatewayKey)
      .set('x-forwarded-method', 'GET')
      .expect(204);
    await request(app)
      .get('/internal/verify')
      .set('Cookie', loginResult.cookie)
      .set('x-anico-gateway-key', 'wrong')
      .set('x-forwarded-method', 'GET')
      .expect(401);
    const token = verifyResponse.headers['x-anico-identity']!;
    expect(token).toBeTruthy();
    const verify = createIdentityVerifier({
      key: createLocalJWKSet(signer.jwks),
      issuer: 'https://auth.example.test',
      audience: 'anico-api-test',
    });
    expect(await verify(token)).toEqual(loginResult.identity);
    const backend = express()
      .get('/private', requireAuth(verify), (_req, res) =>
        res.json({ ok: true }),
      )
      .get(
        '/admin',
        requireAuth(verify),
        requireRole('admin', 'owner'),
        (_req, res) => res.sendStatus(204),
      );
    await request(backend)
      .get('/private')
      .set('x-user-id', loginResult.identity.userId)
      .expect(401);
    await request(backend)
      .get('/private')
      .set('x-anico-identity', token)
      .expect(200);
    await request(backend)
      .get('/admin')
      .set('x-anico-identity', token)
      .expect(403);
    const wrong = createIdentityVerifier({
      key: createLocalJWKSet(signer.jwks),
      issuer: 'https://auth.example.test',
      audience: 'another-api',
    });
    await expect(wrong(token)).rejects.toThrow();
    await connection
      .db!.collection('users')
      .updateOne(
        { userId: loginResult.identity.userId },
        { $set: { status: 'disabled' } },
      );
    await request(app)
      .get('/session')
      .set('Cookie', loginResult.cookie)
      .expect(401);
  });
  it('keeps session cookies, OAuth codes and internal identity tokens out of HTTP logs', async () => {
    const loginResult = await login();
    const lines: string[] = [];
    const logged = createApp({
      logger: pino(
        { level: 'info' },
        {
          write(line: string) {
            lines.push(line);
          },
        },
      ),
      isReady: () => true,
      modules,
    });
    const response = await request(logged)
      .get('/internal/verify?code=private-authorization-code')
      .set('Cookie', loginResult.cookie)
      .set('x-anico-gateway-key', gatewayKey)
      .set('x-forwarded-method', 'GET')
      .expect(204);
    const text = lines.join('');
    expect(text).not.toContain(loginResult.cookie.split('=')[1]);
    expect(text).not.toContain(gatewayKey);
    expect(text).not.toContain(response.headers['x-anico-identity']);
    expect(text).not.toContain('private-authorization-code');
  });
  it('operator bootstrap appoints exactly one real owner and refuses seeded or unconfirmed accounts', async () => {
    const seed = await loadSeed();
    await seed(connection);
    const fixture = '00000000-0000-4000-8000-000000000003';
    await expect(
      appointInitialOwner(connection, fixture, fixture),
    ).rejects.toThrow();
    const real = await login('google', 'initial-owner');
    await expect(
      appointInitialOwner(connection, real.identity.userId, 'wrong'),
    ).rejects.toThrow();
    await appointInitialOwner(
      connection,
      real.identity.userId,
      real.identity.userId,
    );
    expect((await repo.user(real.identity.userId))?.roles).toContain('owner');
    const other = await login('google', 'second');
    await expect(
      appointInitialOwner(
        connection,
        other.identity.userId,
        other.identity.userId,
      ),
    ).rejects.toThrow();
  });
  it('seed is repeatable and has no real identities or usable sessions; bearer session tokens are hashed in storage', async () => {
    const seed = await loadSeed();
    await seed(connection);
    await seed(connection);
    expect(
      await connection
        .db!.collection('users')
        .countDocuments({ fixture: true }),
    ).toBe(3);
    expect(
      await connection
        .db!.collection('users')
        .countDocuments({ fixture: true, issuer: { $exists: true } }),
    ).toBe(0);
    const signed = await login();
    const session = await connection
      .db!.collection('sessions')
      .findOne({ userId: signed.identity.userId });
    const raw = decodeURIComponent(signed.cookie.split('=')[1]!);
    expect(String(session!._id)).toBe(hash(raw));
    expect(String(session!._id)).not.toBe(raw);
    await request(app)
      .get('/session')
      .set('x-user-id', randomUUID())
      .expect(401);
  });
});
