import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { authConfiguration } from '../../src/config.js';
import { createAuthService } from '../../src/modules/auth/application/auth.js';
import { createTestAccountService } from '../../src/modules/auth/application/test-accounts.js';
import type { ProviderClient } from '../../src/modules/auth/domain/auth.js';
import { authRouter } from '../../src/modules/auth/http/router.js';
import { appointInitialOwner } from '../../src/modules/auth/infrastructure/appoint-owner.js';
import { mongoAuthRepository } from '../../src/modules/auth/infrastructure/repository.js';
import { identitySigner } from '../../src/modules/auth/infrastructure/signer.js';
import { mongoTestAccountRepository } from '../../src/modules/auth/infrastructure/test-account-repository.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const origin = 'https://dev.example.test';
const gatewayKey = 'test-gateway-secret';

/** `name=value` pairs of all Set-Cookie headers, keyed by cookie name. */
function setCookies(response: { headers: Record<string, unknown> }) {
  const values = response.headers['set-cookie'];
  const list = Array.isArray(values) ? (values as string[]) : [];
  return Object.fromEntries(
    list.map((value) => {
      const pair = value.split(';')[0]!;
      return [pair.slice(0, pair.indexOf('=')), pair];
    }),
  );
}

describe('dev test accounts: create, switch, return and logout', () => {
  let mongo: MongoMemoryServer, connection: Connection, folder: string;
  let signer: Awaited<ReturnType<typeof identitySigner>>;
  let app: ReturnType<typeof createApp>;
  let subject = 'admin';
  const fake: ProviderClient = {
    async authorize(input) {
      return 'https://provider.example.test/login?state=' + input.state;
    },
    async exchange() {
      return {
        provider: 'google',
        issuer: 'https://google.example.test',
        subject,
        givenName: 'Skutečný',
        familyName: subject,
        email: `${subject}@example.test`,
      };
    },
  };
  function build(enabled: boolean) {
    const repository = mongoAuthRepository(connection);
    const service = createAuthService({
      repository,
      providers: { google: fake },
      publicOrigin: origin,
      sessionSeconds: 3600,
      testAccountsEnabled: enabled,
    });
    app = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
      modules: authRouter({
        service,
        signer,
        publicOrigin: origin,
        gatewayKey,
        sessionSeconds: 3600,
        ...(enabled
          ? {
              testAccounts: createTestAccountService({
                auth: service,
                users: repository,
                repository: mongoTestAccountRepository(connection),
                sessionSeconds: 3600,
              }),
            }
          : {}),
      }),
    });
  }
  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(mongo.getUri('auth_test_accounts'))
      .asPromise();
    folder = await mkdtemp(join(tmpdir(), 'anico-auth-test-accounts-'));
    const keys = await generateKeyPair('ES256', { extractable: true });
    await writeFile(
      join(folder, 'key.pem'),
      await exportPKCS8(keys.privateKey),
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
    build(true);
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });

  /** Real Google login; `role` is granted directly as the owner bootstrap would. */
  async function login(name: string, role?: 'admin' | 'owner') {
    subject = name;
    const start = await request(app).get('/login/google').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const finish = await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'code' })
      .set('Cookie', setCookies(start)['__Host-anico-login']!)
      .expect(303);
    const cookie = setCookies(finish)['__Host-anico-session']!;
    const first = await request(app).get('/session').set('Cookie', cookie);
    const userId: string = first.body.identity.userId;
    if (role === 'owner') await appointInitialOwner(connection, userId, userId);
    if (role === 'admin')
      await connection
        .db!.collection('users')
        .updateOne({ userId }, { $addToSet: { roles: 'admin' } });
    return browser(cookie);
  }
  /** Browser cookie jar holding the session and the optional return cookie. */
  async function browser(session: string, returning?: string) {
    const cookie = returning ? `${session}; ${returning}` : session;
    const current = await request(app).get('/session').set('Cookie', cookie);
    return {
      cookie,
      session,
      returning,
      current,
      csrf: current.body.csrfToken,
    };
  }
  type Browser = Awaited<ReturnType<typeof browser>>;
  const mutate = (jar: Browser, path: string, body?: object) => {
    const call = request(app)
      .post(path)
      .set('Cookie', jar.cookie)
      .set('Origin', origin)
      .set('X-CSRF-Token', jar.csrf);
    return body ? call.send(body) : call;
  };
  async function createAccount(jar: Browser, body: object = {}) {
    const created = await mutate(jar, '/test-accounts', {
      givenName: 'Testovací',
      familyName: 'Chovatel',
      ...body,
    }).expect(201);
    return created.body.identity.userId as string;
  }
  async function switchTo(jar: Browser, userId: string) {
    const response = await mutate(
      jar,
      `/test-accounts/${userId}/session`,
    ).expect(204);
    const cookies = setCookies(response);
    return browser(
      cookies['__Host-anico-session']!,
      cookies['__Host-anico-return'] ?? jar.returning,
    );
  }
  const verify = (jar: Browser) =>
    request(app)
      .get('/internal/verify')
      .set('Cookie', jar.cookie)
      .set('X-Anico-Gateway-Key', gatewayKey)
      .set('X-Forwarded-Method', 'GET');

  it('admin switches into a breeder test account, backends get its identity and the admin returns to the own session', async () => {
    const admin = await login('admin', 'admin');
    expect(admin.current.body.canUseTestAccounts).toBe(true);
    const userId = await createAccount(admin);
    const stored = await connection.db!.collection('users').findOne({ userId });
    expect(stored).toMatchObject({
      roles: ['breeder'],
      email: `tester-${userId.slice(0, 8)}@anico.test`,
      registration: { status: 'pending', event: { data: { userId } } },
    });
    expect(stored).not.toHaveProperty('identities');

    const tester = await switchTo(admin, userId);
    expect(tester.current.body).toMatchObject({
      identity: { userId, roles: ['breeder'] },
      canManageAccounts: false,
      canUseTestAccounts: true,
      testAccountActor: { userId: admin.current.body.identity.userId },
    });
    const signed = await verify(tester).expect(204);
    const payload = decodeJwt(signed.headers['x-anico-identity']!);
    expect(payload.identity).toMatchObject({ userId, roles: ['breeder'] });

    const back = await mutate(tester, '/test-accounts/return').expect(204);
    const cookies = setCookies(back);
    expect(cookies['__Host-anico-session']).toBe(admin.session);
    expect(cookies['__Host-anico-return']).toBe('__Host-anico-return=');
    const own = await request(app)
      .get('/session')
      .set('Cookie', admin.session)
      .expect(200);
    expect(own.body.identity.userId).toBe(admin.current.body.identity.userId);
    expect(own.body).not.toHaveProperty('testAccountActor');
    await request(app)
      .get('/session')
      .set('Cookie', tester.session)
      .expect(401);
  });

  it('switching between test accounts keeps one way back and revokes the previous test session', async () => {
    const admin = await login('admin', 'admin');
    const first = await switchTo(admin, await createAccount(admin));
    const secondId = await createAccount(first, { givenName: 'Druhý' });
    const second = await switchTo(first, secondId);
    expect(second.returning).toBe(first.returning);
    expect(second.current.body.identity.userId).toBe(secondId);
    await request(app).get('/session').set('Cookie', first.session).expect(401);
    const back = await mutate(second, '/test-accounts/return').expect(204);
    expect(setCookies(back)['__Host-anico-session']).toBe(admin.session);
  });

  it('only admin/owner may use test accounts and only the owner may create a test admin', async () => {
    const breeder = await login('breeder');
    expect(breeder.current.body.canUseTestAccounts).toBe(false);
    await request(app)
      .get('/test-accounts')
      .set('Cookie', breeder.cookie)
      .expect(403, { error: 'TEST_ACCOUNTS_FORBIDDEN' });
    await mutate(breeder, '/test-accounts', {
      givenName: 'A',
      familyName: 'B',
    }).expect(403);

    const admin = await login('admin', 'admin');
    await mutate(admin, '/test-accounts', {
      givenName: 'A',
      familyName: 'B',
      admin: true,
    }).expect(403, { error: 'OWNER_REQUIRED' });
    // Real accounts are never switch targets.
    await mutate(
      admin,
      `/test-accounts/${breeder.current.body.identity.userId}/session`,
    ).expect(404, { error: 'TEST_ACCOUNT_NOT_FOUND' });
    await request(app)
      .post(`/test-accounts/${await createAccount(admin)}/session`)
      .set('Cookie', admin.cookie)
      .set('Origin', origin)
      .expect(403, { error: 'CSRF_REJECTED' });

    const owner = await login('owner', 'owner');
    const testAdmin = await createAccount(owner, { admin: true });
    const listed = await request(app)
      .get('/test-accounts')
      .set('Cookie', owner.cookie)
      .expect(200);
    expect(listed.body.accounts[0]).toMatchObject({
      identity: { userId: testAdmin, roles: ['breeder', 'admin'] },
      createdBy: owner.current.body.identity.userId,
    });
    expect(listed.body.accounts).toHaveLength(2);
  });

  it('inside a test session the real actor decides, so a demoted admin loses access immediately', async () => {
    const owner = await login('owner', 'owner');
    const testAdmin = await switchTo(
      owner,
      await createAccount(owner, { admin: true }),
    );
    // The actor (owner) decides, not the test admin identity itself.
    expect(testAdmin.current.body.canUseTestAccounts).toBe(true);

    const admin = await login('admin', 'admin');
    const tester = await switchTo(admin, await createAccount(admin));
    await connection
      .db!.collection<{ userId: string; roles: string[] }>('users')
      .updateOne(
        { userId: admin.current.body.identity.userId },
        { $pull: { roles: 'admin' } },
      );
    const after = await request(app)
      .get('/session')
      .set('Cookie', tester.cookie)
      .expect(200);
    expect(after.body.canUseTestAccounts).toBe(false);
    await request(app)
      .get('/test-accounts')
      .set('Cookie', tester.cookie)
      .expect(403);
  });

  it('logout from a test account ends the own session too; a fresh login drops the way back', async () => {
    const admin = await login('admin', 'admin');
    const tester = await switchTo(admin, await createAccount(admin));
    const out = await mutate(tester, '/logout').expect(204);
    expect(setCookies(out)['__Host-anico-return']).toBe('__Host-anico-return=');
    await request(app)
      .get('/session')
      .set('Cookie', tester.session)
      .expect(401);
    await request(app).get('/session').set('Cookie', admin.session).expect(401);

    const again = await login('admin');
    const next = await switchTo(again, await createAccount(again));
    subject = 'admin';
    const start = await request(app).get('/login/google').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const relogin = await request(app)
      .get('/login/google/callback')
      .query({ state, code: 'code' })
      .set(
        'Cookie',
        `${next.cookie}; ${setCookies(start)['__Host-anico-login']}`,
      )
      .expect(303);
    expect(setCookies(relogin)['__Host-anico-return']).toBe(
      '__Host-anico-return=',
    );
    await request(app).get('/session').set('Cookie', again.session).expect(401);
  });

  it('test sessions cannot link a provider and return requires the matching return cookie', async () => {
    const admin = await login('admin', 'admin');
    const tester = await switchTo(admin, await createAccount(admin));
    await request(app)
      .post('/connections/google')
      .set('Cookie', tester.session)
      .set('Origin', origin)
      .set('X-CSRF-Token', tester.csrf)
      .expect(401, { error: 'RECENT_LOGIN_REQUIRED' });
    const withoutReturn = await browser(tester.session);
    await mutate(withoutReturn, '/test-accounts/return').expect(401, {
      error: 'RETURN_SESSION_MISMATCH',
    });
    await mutate(admin, '/test-accounts/return').expect(409);
  });

  it('when the feature is off the routes do not exist and existing test sessions stop working', async () => {
    const admin = await login('admin', 'admin');
    const tester = await switchTo(admin, await createAccount(admin));
    build(false);
    await request(app)
      .get('/test-accounts')
      .set('Cookie', admin.cookie)
      .expect(404);
    await request(app)
      .get('/session')
      .set('Cookie', tester.session)
      .expect(401, {
        error: 'ACCOUNT_DISABLED',
      });
    await verify(tester).expect(401);
    const own = await request(app)
      .get('/session')
      .set('Cookie', admin.session)
      .expect(200);
    expect(own.body).not.toHaveProperty('canUseTestAccounts');
  });

  it('is configurable only in the dev environment', () => {
    expect(() =>
      authConfiguration({
        AUTH_TEST_ACCOUNTS_ENABLED: 'true',
        APP_ENV: 'prod',
      }),
    ).toThrow('only in the dev');
    expect(
      authConfiguration({ AUTH_TEST_ACCOUNTS_ENABLED: 'true', APP_ENV: 'dev' })
        .AUTH_TEST_ACCOUNTS_ENABLED,
    ).toBe('true');
  });
});
