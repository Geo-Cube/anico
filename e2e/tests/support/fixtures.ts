import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { importPKCS8, SignJWT } from 'jose';
import { MongoClient } from 'mongodb';
import {
  createSession,
  SESSION_COOKIE,
  type SeedRole,
} from '../../stack/sessions.ts';

export { expect };

/** Hodnoty, které globalSetup předává workerům přes `process.env`. */
export function stackEnv(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Chybí ${name}; spouštějte testy přes \`playwright test\``);
  return value;
}

export interface Identity {
  userId: string;
  givenName: string | null;
  familyName: string | null;
  email: string | null;
  roles: Array<'breeder' | 'admin' | 'owner'>;
}

/**
 * Platně podepsaná identita (stejný klíč, kid, issuer a audience jako
 * auth-service). Slouží jen k ověření, že ji gateway z klientského požadavku
 * zahodí.
 */
export async function forgeIdentityToken(identity: Identity) {
  const pem = await readFile(stackEnv('E2E_SIGNING_KEY_FILE'), 'utf8');
  const spki = createPublicKey(pem)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  return new SignJWT({ identity })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'anico-identity+jwt',
      kid: createHash('sha256').update(spki).digest('base64url'),
    })
    .setSubject(identity.userId)
    .setIssuer(stackEnv('E2E_ISSUER'))
    .setAudience(stackEnv('E2E_AUDIENCE'))
    .setIssuedAt()
    .setExpirationTime('30s')
    .setJti(randomUUID())
    .sign(await importPKCS8(pem, 'ES256'));
}

const logDirectory = join(import.meta.dirname, '..', '..', 'stack-logs');

export const test = base.extend<
  {
    /**
     * Nový prohlížečový kontext s vlastní relací seedovaného účtu
     * (`owner` = vlastník, `admin` = administrátor).
     */
    signIn: (role: SeedRole) => Promise<Page>;
    serviceLogsOnFailure: void;
  },
  { authDatabase: MongoClient }
>({
  baseURL: async ({}, use) => use(stackEnv('E2E_BASE_URL')),
  authDatabase: [
    async ({}, use) => {
      const client = await MongoClient.connect(
        stackEnv('E2E_AUTH_DATABASE_URI'),
      );
      await use(client);
      await client.close();
    },
    { scope: 'worker' },
  ],
  signIn: async (
    { browser, authDatabase, baseURL, locale, timezoneId, viewport },
    use,
  ) => {
    const contexts: BrowserContext[] = [];
    await use(async (role) => {
      const session = await createSession(
        authDatabase,
        stackEnv(role === 'owner' ? 'E2E_OWNER_USER_ID' : 'E2E_ADMIN_USER_ID'),
      );
      const context = await browser.newContext({
        baseURL: baseURL!,
        viewport,
        ...(locale ? { locale } : {}),
        ...(timezoneId ? { timezoneId } : {}),
      });
      contexts.push(context);
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: session.token,
          url: baseURL!,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
  // Při selhání přiloží konec logů služeb (pino JSON) k výsledku testu.
  serviceLogsOnFailure: [
    async ({}, use, testInfo) => {
      await use();
      if (testInfo.status === testInfo.expectedStatus) return;
      for (const file of await readdir(logDirectory).catch(() => [])) {
        const lines = (await readFile(join(logDirectory, file), 'utf8')).split(
          '\n',
        );
        await testInfo.attach(file, {
          body: lines.slice(-300).join('\n'),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
});
