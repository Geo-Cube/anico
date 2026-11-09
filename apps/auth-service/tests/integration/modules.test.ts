import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import { pino } from 'pino';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { exportPKCS8, generateKeyPair } from 'jose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { createModules } from '../../src/modules/index.js';

describe('auth module composition from process configuration', () => {
  let mongo: MongoMemoryServer, connection: Connection, folder: string;
  const gatewayKey = 'g'.repeat(43);

  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('auth_modules_test'))
      .asPromise();
    folder = await mkdtemp(join(tmpdir(), 'anico-auth-modules-'));
    const keys = await generateKeyPair('ES256', { extractable: true });
    await writeFile(
      join(folder, 'signing-key.pem'),
      await exportPKCS8(keys.privateKey),
      { mode: 0o600 },
    );
    // Soubor s klíčem končí novým řádkem jako po `echo`; ten se nepočítá.
    await writeFile(join(folder, 'gateway-key'), gatewayKey + '\n', {
      mode: 0o600,
    });
  });
  beforeEach(() => {
    // Žádná konfigurace z prostředí vývojáře nesmí ovlivnit výsledek.
    for (const key of Object.keys(process.env))
      if (/^(AUTH_|GOOGLE_|MICROSOFT_|APPLE_)|^APP_ENV$/.test(key))
        vi.stubEnv(key, undefined);
    vi.stubEnv('AUTH_SIGNING_KEY_FILE', join(folder, 'signing-key.pem'));
    vi.stubEnv('AUTH_GATEWAY_KEY_FILE', join(folder, 'gateway-key'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
    await rm(folder, { recursive: true, force: true });
  });

  async function providerFile(content: string) {
    const file = join(folder, 'providers.env');
    await writeFile(file, content, { mode: 0o600 });
    vi.stubEnv('AUTH_PROVIDER_ENV_FILE', file);
  }
  async function app() {
    return createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
      modules: await createModules(connection),
    });
  }

  it('refuses a provider secret file that tries to set anything besides provider credentials', async () => {
    await providerFile(
      'GOOGLE_CLIENT_ID=id\nGOOGLE_CLIENT_SECRET=secret\nAUTH_DEVELOPMENT_ENABLED=true\n',
    );
    await expect(createModules(connection)).rejects.toThrow(
      'Invalid provider secret file',
    );
  });

  it('refuses incomplete provider credentials without echoing them', async () => {
    await providerFile('GOOGLE_CLIENT_ID=client-id-value\n');
    const failure = createModules(connection);
    await expect(failure).rejects.toThrow(
      'Provider configuration is incomplete',
    );
    await expect(failure).rejects.not.toThrow('client-id-value');
  });

  it.each([
    ['too short', 'short-key'],
    ['containing unsafe characters', 'g'.repeat(42) + ' x'],
    ['empty', '\n'],
  ])('refuses a gateway key file %s', async (_label, content) => {
    const file = join(folder, 'bad-gateway-key');
    await writeFile(file, content, { mode: 0o600 });
    vi.stubEnv('AUTH_GATEWAY_KEY_FILE', file);
    await expect(createModules(connection)).rejects.toThrow(
      'Invalid gateway key file',
    );
  });

  it.each([
    'AUTH_PROVIDER_ENV_FILE',
    'AUTH_GATEWAY_KEY_FILE',
    'AUTH_SIGNING_KEY_FILE',
  ])('fails to start when %s points to a missing file', async (key) => {
    vi.stubEnv(key, join(folder, 'missing'));
    await expect(createModules(connection)).rejects.toThrow(/ENOENT/);
  });

  it('offers only providers with credentials and keeps development and test-account routes closed by default', async () => {
    await providerFile('GOOGLE_CLIENT_ID=id\nGOOGLE_CLIENT_SECRET=secret\n');
    // Poskytovatele lze doplnit i z prostředí; soubor s klíčem Apple se čte až
    // při přihlášení.
    vi.stubEnv('APPLE_CLIENT_ID', 'online.anico.web');
    vi.stubEnv('APPLE_TEAM_ID', 'TEAM');
    vi.stubEnv('APPLE_KEY_ID', 'KEY');
    vi.stubEnv('APPLE_KEY_FILE', join(folder, 'apple-key.p8'));
    const server = await app();
    await request(server)
      .get('/providers')
      .expect(200, { providers: ['google', 'apple'] });
    await request(server)
      .get('/login/microsoft')
      .expect(503, { error: 'PROVIDER_NOT_CONFIGURED' });
    // Přihlášení rozběhnuté před odebráním poskytovatele skončí na stránce.
    await request(server)
      .get('/login/microsoft/callback')
      .query({ state: 's'.repeat(43), code: 'x' })
      .set('Cookie', 'anico-local-login=' + 'b'.repeat(43))
      .expect(303)
      .expect(
        'Location',
        'http://127.0.0.1:5173/prihlaseni?error=PROVIDER_UNAVAILABLE',
      );
    // Apple vyžaduje form_post se SameSite=None cookie, tedy HTTPS původ.
    await request(server)
      .get('/login/apple')
      .expect(503, { error: 'APPLE_REQUIRES_HTTPS' });
    const jwks = await request(server)
      .get('/.well-known/jwks.json')
      .expect(200);
    expect(jwks.body.keys).toEqual([
      expect.objectContaining({ alg: 'ES256', use: 'sig', kty: 'EC' }),
    ]);
    expect(jwks.body.keys[0]).not.toHaveProperty('d');

    await request(server)
      .get('/development/authorize')
      .expect(404, { error: 'Not found' });
    await request(server)
      .get('/test-accounts')
      .expect(404, { error: 'Not found' });
    await request(server)
      .get('/session')
      .set('X-Anico-Development-Token', 'a'.repeat(43))
      .expect(401, { error: 'DEVELOPMENT_LOGIN_UNAVAILABLE' });

    // Klíč brány se čte ze souboru: cizí hodnota neprojde, správná postoupí
    // až k ověření přihlášení.
    await request(server)
      .get('/internal/verify')
      .set('X-Anico-Gateway-Key', 'h'.repeat(43))
      .expect(401, { error: 'GATEWAY_REQUIRED' });
    await request(server)
      .get('/internal/verify')
      .set('X-Anico-Gateway-Key', gatewayKey)
      .expect(401, { error: 'AUTHENTICATION_REQUIRED' });
  });

  it('opens development and test-account routes only when explicitly enabled in the dev environment', async () => {
    vi.stubEnv('APP_ENV', 'dev');
    vi.stubEnv('AUTH_DEVELOPMENT_ENABLED', 'true');
    const development = await app();
    await request(development)
      .get('/development/authorize')
      .expect(400, { error: 'Invalid request' });
    await request(development).get('/test-accounts').expect(404);
    await request(development).get('/providers').expect(200, { providers: [] });

    vi.stubEnv('AUTH_DEVELOPMENT_ENABLED', 'false');
    vi.stubEnv('AUTH_TEST_ACCOUNTS_ENABLED', 'true');
    vi.stubEnv('MICROSOFT_CLIENT_ID', 'id');
    vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'secret');
    const testAccounts = await app();
    await request(testAccounts)
      .get('/providers')
      .expect(200, { providers: ['microsoft'] });
    await request(testAccounts)
      .get('/test-accounts')
      .expect(401, { error: 'AUTHENTICATION_REQUIRED' });
    await request(testAccounts).get('/development/authorize').expect(404);
  });
});
