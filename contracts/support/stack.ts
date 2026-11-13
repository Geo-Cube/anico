import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import mongoose, { type Connection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { pino } from 'pino';
import { exportPKCS8, generateKeyPair } from 'jose';
import { requestAuthenticator } from '@anico/auth';
import {
  SessionSchema,
  type BreederVerifiedEvent,
} from '@anico/shared-schemas';
import { startTestMongo } from '../../scripts/start-test-mongo.mjs';
// auth-service – skládá se jako modules/index.ts, jen s falešným OIDC providerem
import { createApp as createAuthApp } from '../../apps/auth-service/src/app.js';
import { createAuthService } from '../../apps/auth-service/src/modules/auth/application/auth.js';
import { createTestAccountService } from '../../apps/auth-service/src/modules/auth/application/test-accounts.js';
import type {
  ExternalIdentity,
  Provider,
  ProviderClient,
} from '../../apps/auth-service/src/modules/auth/domain/auth.js';
import { authRouter } from '../../apps/auth-service/src/modules/auth/http/router.js';
import { appointInitialOwner } from '../../apps/auth-service/src/modules/auth/infrastructure/appoint-owner.js';
import { mongoAuthRepository } from '../../apps/auth-service/src/modules/auth/infrastructure/repository.js';
import { identitySigner } from '../../apps/auth-service/src/modules/auth/infrastructure/signer.js';
import { mongoTestAccountRepository } from '../../apps/auth-service/src/modules/auth/infrastructure/test-account-repository.js';
import { migrateDatabase as migrateAuth } from '../../apps/auth-service/src/database/engine.js';
import { loadMigrations as authMigrations } from '../../apps/auth-service/src/database/registry.js';
// breeder-service – stejné adaptéry jako server.ts
import { createApp as createBreederApp } from '../../apps/breeder-service/src/app.js';
import { createModules as breederModules } from '../../apps/breeder-service/src/modules/index.js';
import { gridFsFileStorage } from '../../apps/breeder-service/src/modules/breeders/infrastructure/gridfs-file-storage.js';
import { loggingDecisionNotifier } from '../../apps/breeder-service/src/modules/breeders/infrastructure/logging-decision-notifier.js';
import { mongooseBreederRepository } from '../../apps/breeder-service/src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import { migrateDatabase as migrateBreeder } from '../../apps/breeder-service/src/database/engine.js';
import { loadMigrations as breederMigrations } from '../../apps/breeder-service/src/database/registry.js';
// animal-service – stejné adaptéry jako server.ts
import { createApp as createAnimalApp } from '../../apps/animal-service/src/app.js';
import { createModules as animalModules } from '../../apps/animal-service/src/modules/index.js';
import { mongoVerifiedBreeders } from '../../apps/animal-service/src/modules/animal/infrastructure/verified-breeders.js';
import { migrateDatabase as migrateAnimal } from '../../apps/animal-service/src/database/engine.js';
import { loadMigrations as animalMigrations } from '../../apps/animal-service/src/database/registry.js';

/** Veřejný origin aplikace; prohlížeč i gateway jsou na něm (same-origin `/api`). */
export const PUBLIC_ORIGIN = 'https://anico.contract.test';
export const ISSUER = `${PUBLIC_ORIGIN}/api/auth`;
export const AUDIENCE = 'anico-api-contract';
const SESSION_COOKIE = '__Host-anico-session';

/** Hostitelé, na které frontend (`startConnection`) pustí přesměrování k providerovi. */
const PROVIDER_HOSTS: Record<'google' | 'microsoft', string> = {
  google: 'accounts.google.com',
  microsoft: 'login.microsoftonline.com',
};

async function listen(app: Express) {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
}

/** Skutečný `fetch`; testy jím nahrazují globální `fetch` prohlížeče, gateway ne. */
const upstreamFetch = globalThis.fetch;

interface VerifiedBreederProjection {
  isVerified(breederId: string): Promise<boolean>;
  project(event: BreederVerifiedEvent): Promise<void>;
}

/** Cookie úložiště jednoho prohlížeče (jen `name=value`; atributy řeší auth-service). */
export class Browser {
  readonly cookies = new Map<string, string>();
  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  store(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0]!;
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      if (!value || /;\s*max-age=0(?:;|$)/i.test(line))
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

/** Prohlížeč s relací přihlášeného uživatele. */
export type SignedInBrowser = Browser & { userId: string };

export interface Stack {
  /** Náhrada `fetch` prohlížeče: same-origin cesty `/api/...` přes emulovanou gateway. */
  fetch: typeof fetch;
  /** Prohlížeč, jehož cookies `fetch` právě posílá. */
  use(browser: Browser): void;
  /** Skutečné přihlášení přes `/login/:provider` a callback (falešný OIDC provider). */
  login(
    name: string,
    options?: { role?: 'owner' | 'admin'; provider?: 'google' | 'microsoft' },
  ): Promise<SignedInBrowser>;
  /** Dokončí provider callback po `startConnection` (propojení účtu). */
  completeProviderLogin(
    provider: 'google' | 'microsoft',
    providerUrl: string,
    name: string,
  ): Promise<Response>;
  /** Přímé adresy služeb (za gateway); backendy čekají hlavičku `x-anico-identity`. */
  authUrl: string;
  breederUrl: string;
  animalUrl: string;
  jwksUrl: string;
  gatewayKey: string;
  signingKeyFile: string;
  connections: { auth: Connection; breeder: Connection; animal: Connection };
  /** Projekce ověřených chovatelů v animal-service (tatáž, kterou plní consumer). */
  animal: { verification: VerifiedBreederProjection };
  close(): Promise<void>;
}

/**
 * Celá trojice služeb nad jednou MongoDB (oddělené databáze) složená z jejich
 * vlastních modulů, s gateway podle Traefik `anico-session` (forwardAuth na
 * `/internal/verify`, `authResponseHeaders: X-Anico-Identity`, odebraná cookie).
 */
export async function startStack(): Promise<Stack> {
  const logger = pino({ level: 'silent' });
  const mongo = await startTestMongo(new MongoMemoryServer());
  const servers: Server[] = [];
  const folder = await mkdtemp(join(tmpdir(), 'anico-contracts-'));
  const open = async (name: string) =>
    mongoose
      .createConnection(mongo.getUri(`anico_${name}_contract`))
      .asPromise();
  const connections = {
    auth: await open('auth'),
    breeder: await open('breeder'),
    animal: await open('animal'),
  };
  try {
    await migrateAuth(connections.auth, await authMigrations());
    await migrateBreeder(connections.breeder, await breederMigrations());
    await migrateAnimal(connections.animal, await animalMigrations());

    // auth-service
    const signingKeyFile = join(folder, 'signing-key.pem');
    const keys = await generateKeyPair('ES256', { extractable: true });
    await writeFile(signingKeyFile, await exportPKCS8(keys.privateKey), {
      mode: 0o600,
    });
    const gatewayKey = randomBytes(32).toString('base64url');
    const subjects: Record<string, string> = {};
    const fakeProvider = (
      provider: 'google' | 'microsoft',
    ): ProviderClient => ({
      async authorize(input) {
        return `https://${PROVIDER_HOSTS[provider]}/authorize?${new URLSearchParams({ state: input.state })}`;
      },
      async exchange(input): Promise<ExternalIdentity> {
        const subject = subjects[input.state];
        if (!subject) throw new Error('Unknown login attempt');
        return {
          provider,
          issuer: `https://${PROVIDER_HOSTS[provider]}`,
          subject,
          givenName: 'Jana',
          familyName: subject,
          email: `${subject}@example.test`,
        };
      },
    });
    const providers: Partial<Record<Provider, ProviderClient>> = {
      google: fakeProvider('google'),
      microsoft: fakeProvider('microsoft'),
    };
    const repository = mongoAuthRepository(connections.auth);
    const sessionSeconds = 3600;
    const service = createAuthService({
      repository,
      providers,
      publicOrigin: PUBLIC_ORIGIN,
      sessionSeconds,
      testAccountsEnabled: true,
    });
    const auth = await listen(
      createAuthApp({
        logger,
        isReady: () => true,
        modules: authRouter({
          service,
          signer: await identitySigner(signingKeyFile, ISSUER, AUDIENCE),
          publicOrigin: PUBLIC_ORIGIN,
          gatewayKey,
          sessionSeconds,
          testAccounts: createTestAccountService({
            auth: service,
            users: repository,
            repository: mongoTestAccountRepository(connections.auth),
            sessionSeconds,
          }),
        }),
      }),
    );
    servers.push(auth.server);
    const jwksUrl = `${auth.url}/.well-known/jwks.json`;
    // Backendy na devu: AUTH_JWKS_URL na interní auth-service, sdílený issuer a audience.
    const identityEnv = {
      AUTH_JWKS_URL: jwksUrl,
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: AUDIENCE,
    };

    // breeder-service
    const breederAuthenticate = requestAuthenticator(identityEnv);
    const breederRouter = breederModules(connections.breeder, {
      repository: mongooseBreederRepository(connections.breeder),
      files: gridFsFileStorage(connections.breeder),
      notifier: loggingDecisionNotifier(logger),
      logger,
    });
    await Promise.all(
      Object.values(connections.breeder.models).map((model) => model.init()),
    );
    const breeder = await listen(
      createBreederApp({
        logger,
        modules: breederRouter,
        ...(breederAuthenticate ? { authenticate: breederAuthenticate } : {}),
        isReady: () => true,
      }),
    );
    servers.push(breeder.server);

    // animal-service
    const verification = mongoVerifiedBreeders(connections.animal);
    const animalAuthenticate = requestAuthenticator(identityEnv);
    const animal = await listen(
      createAnimalApp({
        logger,
        ...(animalAuthenticate ? { authenticate: animalAuthenticate } : {}),
        modules: animalModules(connections.animal, { logger, verification }),
        isReady: () => true,
      }),
    );
    servers.push(animal.server);

    const routes = [
      { prefix: '/api/auth', target: auth.url, session: false },
      { prefix: '/api/breeder', target: breeder.url, session: true },
      { prefix: '/api/animal', target: animal.url, session: true },
    ];
    let current = new Browser();
    const gatewayFetch = async (
      input: string | URL | Request,
      init: RequestInit = {},
    ): Promise<Response> => {
      // Absolutní adresy volají služby mezi sebou (např. jose stahuje JWKS) – mimo prohlížeč.
      if (typeof input !== 'string' || !input.startsWith('/'))
        return upstreamFetch(input, init);
      const url = new URL(input, PUBLIC_ORIGIN);
      const route = routes.find(
        ({ prefix }) =>
          url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      );
      if (!route) return Response.json({ error: 'Not found' }, { status: 404 });
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      // Prohlížeč: cookies a Origin u mutací; gateway hlavičku identity nikdy nepřevezme.
      headers.delete('x-anico-identity');
      if (!['GET', 'HEAD'].includes(method))
        headers.set('origin', PUBLIC_ORIGIN);
      const cookie = current.header();
      if (route.session) {
        const verify = await upstreamFetch(`${auth.url}/internal/verify`, {
          headers: {
            ...(cookie ? { cookie } : {}),
            ...(headers.get('origin')
              ? { origin: headers.get('origin')! }
              : {}),
            ...(headers.get('x-csrf-token')
              ? { 'x-csrf-token': headers.get('x-csrf-token')! }
              : {}),
            'x-anico-gateway-key': gatewayKey,
            'x-forwarded-method': method,
          },
        });
        if (!verify.ok) return verify;
        headers.set(
          'x-anico-identity',
          verify.headers.get('x-anico-identity')!,
        );
      } else if (cookie) headers.set('cookie', cookie);
      const path = url.pathname.slice(route.prefix.length) || '/';
      const response = await upstreamFetch(
        `${route.target}${path}${url.search}`,
        {
          ...init,
          method,
          headers,
        },
      );
      current.store(response);
      return response;
    };

    const login: Stack['login'] = async (name, options = {}) => {
      const browser: SignedInBrowser = Object.assign(new Browser(), {
        userId: '',
      });
      current = browser;
      const provider = options.provider ?? 'google';
      const start = await gatewayFetch(`/api/auth/login/${provider}`, {
        redirect: 'manual',
      });
      const finish = await completeProviderLogin(
        provider,
        start.headers.get('location')!,
        name,
      );
      if (finish.status !== 303 || !browser.cookies.has(SESSION_COOKIE))
        throw new Error(`Login failed with ${finish.status}`);
      const session = SessionSchema.parse(
        await (await gatewayFetch('/api/auth/session')).json(),
      );
      browser.userId = session.identity.userId;
      if (options.role === 'owner')
        await appointInitialOwner(
          connections.auth,
          browser.userId,
          browser.userId,
        );
      if (options.role === 'admin') {
        const owner = await ownerBrowser();
        current = owner.browser;
        const granted = await gatewayFetch(
          `/api/auth/users/${browser.userId}/admin`,
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': owner.csrfToken,
            },
            body: JSON.stringify({ admin: true }),
          },
        );
        if (granted.status !== 200) throw new Error('Admin grant failed');
        current = browser;
      }
      return browser;
    };
    let owner: { browser: Browser; csrfToken: string } | undefined;
    async function ownerBrowser() {
      if (owner) return owner;
      const browser = await login('vlastnik', { role: 'owner' });
      const session = SessionSchema.parse(
        await (await gatewayFetch('/api/auth/session')).json(),
      );
      owner = { browser, csrfToken: session.csrfToken };
      return owner;
    }
    async function completeProviderLogin(
      provider: 'google' | 'microsoft',
      providerUrl: string,
      name: string,
    ) {
      const state = new URL(providerUrl).searchParams.get('state')!;
      subjects[state] = name;
      return gatewayFetch(
        `/api/auth/login/${provider}/callback?${new URLSearchParams({ state, code: 'code' })}`,
        { redirect: 'manual' },
      );
    }

    return {
      fetch: gatewayFetch as typeof fetch,
      use(browser) {
        current = browser;
      },
      login,
      completeProviderLogin,
      authUrl: auth.url,
      breederUrl: breeder.url,
      animalUrl: animal.url,
      jwksUrl,
      gatewayKey,
      signingKeyFile,
      connections,
      animal: { verification },
      async close() {
        await Promise.all(servers.map(closeServer));
        await Promise.all(Object.values(connections).map((c) => c.close()));
        await mongo.stop();
        await rm(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.all(servers.map(closeServer));
    await Promise.all(Object.values(connections).map((c) => c.close()));
    await mongo.stop();
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
