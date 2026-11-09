import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import mongoose, { type Connection } from 'mongoose';
import { pino } from 'pino';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportPKCS8, createLocalJWKSet } from 'jose';
import { createIdentityVerifier, requestAuthenticator } from '@anico/auth';
import { createApp } from '../../src/app.js';
import { authConfiguration } from '../../src/config.js';
import {
  createAuthService,
  hash,
} from '../../src/modules/auth/application/auth.js';
import { createDevelopmentAuthService } from '../../src/modules/auth/application/development.js';
import { mongoAuthRepository } from '../../src/modules/auth/infrastructure/repository.js';
import { mongoDevelopmentRepository } from '../../src/modules/auth/infrastructure/development-repository.js';
import { identitySigner } from '../../src/modules/auth/infrastructure/signer.js';
import { authRouter } from '../../src/modules/auth/http/router.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const origin = 'https://dev.example.test',
  callback = 'http://127.0.0.1:49152/callback';
const verifier = 'v'.repeat(43),
  state = 's'.repeat(43),
  gatewayKey = 'test-gateway-key';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const firstCookie = (r: request.Response) =>
  String(r.headers['set-cookie']![0]).split(';')[0]!;
describe('local development authorization and PKCE', () => {
  let mongo: MongoMemoryServer, connection: Connection, folder: string;
  let app: ReturnType<typeof createApp>,
    auth: ReturnType<typeof createAuthService>;
  let signer: Awaited<ReturnType<typeof identitySigner>>;
  let now = new Date();
  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('development_auth_test'))
      .asPromise();
    folder = await mkdtemp(join(tmpdir(), 'anico-development-auth-'));
    const keys = await generateKeyPair('ES256', { extractable: true });
    await writeFile(
      join(folder, 'key.pem'),
      await exportPKCS8(keys.privateKey),
    );
    signer = await identitySigner(
      join(folder, 'key.pem'),
      origin + '/api/auth',
      'anico-api-dev',
    );
  });
  beforeEach(async () => {
    await connection.dropDatabase();
    await migrateDatabase(connection, await loadMigrations());
    now = new Date();
    const users = mongoAuthRepository(connection);
    auth = createAuthService({
      repository: users,
      publicOrigin: origin,
      sessionSeconds: 3600,
      now: () => now,
      providers: {
        google: {
          async authorize(input) {
            return 'https://idp.example.test/login?state=' + input.state;
          },
          async exchange() {
            return {
              provider: 'google',
              issuer: 'https://accounts.google.com',
              subject: 'developer',
              email: 'developer@example.test',
              givenName: 'Example',
              familyName: 'Developer',
            };
          },
        },
      },
    });
    const development = createDevelopmentAuthService({
      auth,
      users,
      repository: mongoDevelopmentRepository(connection),
      sessionSeconds: 3600,
      now: () => now,
    });
    app = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
      modules: authRouter({
        service: auth,
        development,
        signer,
        publicOrigin: origin,
        gatewayKey,
        sessionSeconds: 3600,
      }),
    });
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });
  async function login(returnTo?: string) {
    const start = await request(app)
      .get('/login/google')
      .query(returnTo ? { returnTo } : {})
      .expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state');
    const finish = await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'test-code' })
      .set('Cookie', firstCookie(start))
      .expect(303);
    const cookie = firstCookie(finish);
    const current = await request(app)
      .get('/session')
      .set('Cookie', cookie)
      .expect(200);
    return {
      cookie,
      csrf: current.body.csrfToken,
      userId: current.body.identity.userId,
      finish,
    };
  }
  function begin(overrides = {}) {
    return request(app)
      .get('/development/authorize')
      .query({
        client_id: 'anico-local-development',
        response_type: 'code',
        redirect_uri: callback,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        ...overrides,
      });
  }
  function approve(
    signed: Awaited<ReturnType<typeof login>>,
    id: string,
    decision = 'allow',
  ) {
    return request(app)
      .post('/development/approve')
      .set('Cookie', signed.cookie)
      .set('Origin', origin)
      .type('form')
      .send({ request: id, csrfToken: signed.csrf, decision });
  }
  async function code(signed: Awaited<ReturnType<typeof login>>) {
    const start = await begin();
    expect(start.status).toBe(303);
    const id = new URL(start.headers.location!, origin).searchParams.get(
      'request',
    )!;
    const consent = await request(app)
      .get(start.headers.location!.replace('/api/auth', ''))
      .set('Cookie', signed.cookie)
      .expect(200);
    expect(consent.text).toContain('Povolit místní vývoj');
    expect(consent.headers['referrer-policy']).toBe('strict-origin');
    expect(consent.headers['content-security-policy']).toContain(
      "form-action 'self' http://127.0.0.1:49152;",
    );
    const approved = await approve(signed, id);
    expect(approved.status).toBe(303);
    const redirect = new URL(approved.headers.location!);
    expect(redirect.searchParams.get('state')).toBe(state);
    return redirect.searchParams.get('code')!;
  }
  const exchange = (code: string, overrides = {}) =>
    request(app)
      .post('/development/token')
      .send({
        client_id: 'anico-local-development',
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: callback,
        ...overrides,
      });
  const developmentRequest = (
    path: string,
    token: string,
    requestOrigin = new URL(callback).origin,
  ) =>
    request(app)
      .get(path)
      .set('X-Anico-Development-Token', token)
      .set('Origin', requestOrigin);
  it('returns one-use codes, stores hashed sessions and exposes the same identity without browser JWTs', async () => {
    const signed = await login();
    const grant = await exchange(await code(signed)).expect(200);
    const token = grant.body.access_token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant.body.token_type).toBe('Bearer');
    const current = await developmentRequest('/session', token).expect(200);
    expect(current.body.identity.userId).toBe(signed.userId);
    expect(current.body.canManageAccounts).toBe(false);
    const stored = await connection
      .db!.collection('development_sessions')
      .findOne({ userId: signed.userId });
    expect(String(stored!._id)).toBe(hash(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const jwt = await request(app)
      .post('/development/identity')
      .set('X-Anico-Development-Token', token)
      .set('Origin', new URL(callback).origin)
      .expect(200);
    const verify = createIdentityVerifier({
      key: createLocalJWKSet(signer.jwks),
      issuer: origin + '/api/auth',
      audience: 'anico-api-dev',
    });
    expect((await verify(jwt.body.identityToken)).userId).toBe(signed.userId);
    expect(JSON.stringify(current.body)).not.toContain(jwt.body.identityToken);
    const forward = await developmentRequest('/internal/verify', token)
      .set('X-Anico-Gateway-Key', gatewayKey)
      .set('X-Forwarded-Method', 'POST')
      .expect(204);
    expect((await verify(forward.headers['x-anico-identity']!)).userId).toBe(
      signed.userId,
    );
    await request(app)
      .post('/connections/microsoft')
      .set('X-Anico-Development-Token', token)
      .expect(403);
  });
  it('does not redeem intercepted codes with a wrong verifier or redirect and consumes a correct code exactly once', async () => {
    const signed = await login();
    const value = await code(signed);
    await exchange(value, { code_verifier: 'x'.repeat(43) }).expect(401);
    await exchange(value, {
      redirect_uri: 'http://127.0.0.1:49153/callback',
    }).expect(401);
    const results = await Promise.all([exchange(value), exchange(value)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    await exchange(value).expect(401);
  });
  it('requires original app login, CSRF and exact Origin before explicit approval', async () => {
    const signed = await login();
    const start = await begin();
    const id = new URL(start.headers.location!, origin).searchParams.get(
      'request',
    )!;
    await request(app)
      .get('/development/consent')
      .query({ request: id })
      .expect(200)
      .expect((r) => expect(r.text).toContain('Přihlásit přes Google'));
    await request(app)
      .post('/development/approve')
      .type('form')
      .send({ request: id, csrfToken: signed.csrf, decision: 'allow' })
      .expect(401);
    await request(app)
      .post('/development/approve')
      .set('Cookie', signed.cookie)
      .set('Origin', 'https://attacker.example.test')
      .type('form')
      .send({ request: id, csrfToken: signed.csrf, decision: 'allow' })
      .expect(403);
    for (const originHeader of [undefined, 'null']) {
      const submission = request(app)
        .post('/development/approve')
        .set('Cookie', signed.cookie);
      if (originHeader) submission.set('Origin', originHeader);
      await submission
        .type('form')
        .send({ request: id, csrfToken: signed.csrf, decision: 'allow' })
        .expect(403);
    }
    await request(app)
      .post('/development/approve')
      .set('Cookie', signed.cookie)
      .set('Origin', origin)
      .type('form')
      .send({ request: id, csrfToken: 'wrong', decision: 'allow' })
      .expect(403);
    const denied = await approve(signed, id, 'deny');
    expect(new URL(denied.headers.location!).searchParams.get('error')).toBe(
      'access_denied',
    );
    expect(
      await connection.db!.collection('development_codes').countDocuments(),
    ).toBe(0);
    await approve(signed, id).expect(401);
  });
  it('rejects unsafe callback URLs, downgraded PKCE and arbitrary login return URLs', async () => {
    for (const value of [
      'https://attacker.example.test/callback',
      'http://localhost:49152/callback',
      'http://127.0.0.1.evil.test:49152/callback',
      'http://user:pass@127.0.0.1:49152/callback',
      callback + '?evil=1',
      callback + '#fragment',
      'http://127.0.0.1:80/callback',
      'http://127.0.0.1:49152/elsewhere',
    ])
      await begin({ redirect_uri: value }).expect(400);
    await begin({ code_challenge_method: 'plain' }).expect(400);
    await begin({ state: 'short' }).expect(400);
    await begin({ provider: 'microsoft' }).expect(503);
    await request(app)
      .get('/login/google')
      .query({ returnTo: 'https://attacker.example.test' })
      .expect(400);
  });
  it('preserves the pending consent across a real app login callback', async () => {
    const start = await begin({ provider: 'google' }).expect(303);
    const loginUrl = new URL(start.headers.location!, origin);
    const returnTo = loginUrl.searchParams.get('returnTo')!;
    const signed = await login(returnTo);
    expect(signed.finish.headers.location).toBe(origin + returnTo);
    const consent = await request(app)
      .get(returnTo.replace('/api/auth', ''))
      .set('Cookie', signed.cookie)
      .expect(200);
    expect(consent.text).toContain('127.0.0.1:49152');
  });
  it('checks expiry explicitly and refuses code exchange after app logout or disabling the account', async () => {
    const signed = await login();
    const old = await code(signed);
    now = new Date(now.getTime() + 60001);
    await exchange(old).expect(401);
    const revoked = await code(signed);
    await request(app)
      .post('/logout')
      .set('Cookie', signed.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', signed.csrf)
      .expect(204);
    await exchange(revoked).expect(401);
    const fresh = await login();
    const disabled = await code(fresh);
    await connection
      .db!.collection('users')
      .updateOne({ userId: fresh.userId }, { $set: { status: 'disabled' } });
    await exchange(disabled).expect(401);
  });
  it('binds native sessions to loopback Origin, refreshes roles and revokes only that development session', async () => {
    const signed = await login();
    const token = (await exchange(await code(signed))).body.access_token;
    await developmentRequest(
      '/session',
      token,
      'https://attacker.example.test',
    ).expect(403);
    await request(app)
      .get('/session')
      .set('X-Anico-Development-Token', token)
      .expect(403);
    await connection
      .db!.collection('users')
      .updateOne({ userId: signed.userId }, { $addToSet: { roles: 'owner' } });
    expect(
      (await developmentRequest('/session', token)).body.identity.roles,
    ).toContain('owner');
    await request(app)
      .post('/development/logout')
      .set('X-Anico-Development-Token', token)
      .set('Origin', new URL(callback).origin)
      .expect(204);
    await developmentRequest('/session', token).expect(401);
    await request(app).get('/session').set('Cookie', signed.cookie).expect(200);
    const again = (await exchange(await code(signed))).body.access_token;
    now = new Date(now.getTime() + 3600001);
    await developmentRequest('/session', again).expect(401);
  });
  it('lets a native token use the shared logout and owner actions without CSRF, but only from its loopback Origin', async () => {
    const signed = await login();
    await connection
      .db!.collection('users')
      .updateOne({ userId: signed.userId }, { $addToSet: { roles: 'owner' } });
    const token = (await exchange(await code(signed))).body.access_token;
    const target = await mongoAuthRepository(connection).register({
      provider: 'google',
      issuer: 'https://accounts.google.com',
      subject: 'colleague',
      givenName: null,
      familyName: null,
      email: null,
    });
    const appoint = (requestOrigin: string) =>
      request(app)
        .put(`/users/${target.userId}/admin`)
        .set('X-Anico-Development-Token', token)
        .set('Origin', requestOrigin)
        .send({ admin: true });
    await appoint('https://attacker.example.test').expect(403);
    const appointed = await appoint(new URL(callback).origin).expect(200);
    expect(appointed.body.identity.roles).toContain('admin');

    const logout = (requestOrigin: string) =>
      request(app)
        .post('/logout')
        .set('X-Anico-Development-Token', token)
        .set('Origin', requestOrigin);
    await logout('https://attacker.example.test').expect(403);
    await developmentRequest('/session', token).expect(200);
    const loggedOut = await logout(new URL(callback).origin).expect(204);
    // Nativní odhlášení nesmí sahat na cookies prohlížeče.
    expect(loggedOut.headers['set-cookie']).toBeUndefined();
    await developmentRequest('/session', token).expect(401);
    await request(app).get('/session').set('Cookie', signed.cookie).expect(200);
  });
  it('caps development sessions at eight hours even when the authorizing app session lasts longer', async () => {
    const signed = await login();
    await connection
      .db!.collection('sessions')
      .updateMany(
        { userId: signed.userId },
        { $set: { expiresAt: new Date(now.getTime() + 43200000) } },
      );
    const value = await code(signed);
    const service = createDevelopmentAuthService({
      auth,
      users: mongoAuthRepository(connection),
      repository: mongoDevelopmentRepository(connection),
      sessionSeconds: 86400,
      now: () => now,
    });
    const grant = await service.exchange(value, verifier, callback);
    expect(grant.expiresAt.getTime() - now.getTime()).toBe(28800000);
  });
  it('requires explicit dev configuration and fails closed without backend identity settings', async () => {
    expect(() =>
      authConfiguration({ AUTH_DEVELOPMENT_ENABLED: 'true', APP_ENV: 'prod' }),
    ).toThrow('only in the dev');
    expect(() => requestAuthenticator({ NODE_ENV: 'production' })).toThrow();
    expect(() => requestAuthenticator({ APP_ENV: 'dev' })).toThrow();
    expect(requestAuthenticator({ APP_ENV: 'local' })).toBeUndefined();
    const keys = JSON.stringify(signer.jwks);
    expect(
      requestAuthenticator({
        NODE_ENV: 'development',
        APP_ENV: 'dev',
        HOST: '127.0.0.1',
        AUTH_JWKS_JSON: keys,
        AUTH_ISSUER: origin + '/api/auth',
        AUTH_AUDIENCE: 'anico-api-dev',
      }),
    ).toBeTypeOf('function');
    expect(() =>
      requestAuthenticator({
        NODE_ENV: 'production',
        APP_ENV: 'dev',
        HOST: '127.0.0.1',
        AUTH_JWKS_JSON: keys,
        AUTH_ISSUER: origin,
        AUTH_AUDIENCE: 'test',
      }),
    ).toThrow('loopback');
  });
});
