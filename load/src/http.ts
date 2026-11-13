import { createHash, createPublicKey, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { importPKCS8, SignJWT } from 'jose';
import {
  SESSION_COOKIE,
  type SeededSession,
  type SeededUser,
} from '@anico/e2e/sessions';
import type { StackInfo } from './stack.ts';

/** Účet se seedovanou relací (cookie platí přes gateway). */
export interface Account {
  user: SeededUser;
  session: SeededSession;
}

/**
 * Hlavičky požadavku přes gateway: cookie relace; mutace navíc `Origin`
 * a `X-CSRF-Token`, které forwardAuth (`/internal/verify`) vyžaduje.
 */
export function gatewayHeaders(
  info: StackInfo,
  account: Account,
  mutation: boolean,
): Record<string, string> {
  return {
    cookie: `${SESSION_COOKIE}=${account.session.token}`,
    ...(mutation
      ? { origin: info.baseUrl, 'x-csrf-token': account.session.csrfToken }
      : {}),
  };
}

/** Požadavek přes gateway (celá cesta včetně forwardAuth). */
export function gatewayFetch(
  info: StackInfo,
  account: Account,
  method: 'GET' | 'POST',
  path: string,
  body?: FormData | Record<string, unknown>,
) {
  const json = body !== undefined && !(body instanceof FormData);
  return fetch(`${info.baseUrl}${path}`, {
    method,
    headers: {
      ...gatewayHeaders(info, account, method !== 'GET'),
      ...(json ? { 'content-type': 'application/json' } : {}),
    },
    ...(body === undefined
      ? {}
      : { body: json ? JSON.stringify(body) : (body as FormData) }),
    signal: AbortSignal.timeout(30_000),
  });
}

/** Ověří status a tvar odpovědi sdíleným Zod schématem. */
export async function expectJson<T>(
  response: Response,
  status: number,
  schema: { parse(value: unknown): T },
  what: string,
): Promise<T> {
  const text = await response.text();
  if (response.status !== status)
    throw new Error(
      `${what}: očekáván HTTP ${status}, přišel ${response.status} ${text.slice(0, 300)}`,
    );
  return schema.parse(JSON.parse(text));
}

export interface IdentityTokens {
  /** Hlavička `x-anico-identity` daného účtu (vždy čerstvý token). */
  headers(user: SeededUser): Record<string, string>;
  close(): void;
}

/**
 * Podepsané identity pro přímá volání backendů (obchází gateway). Stejný klíč,
 * `kid`, typ, issuer a audience jako auth-service (`signer.ts`); backend
 * přijme token nejvýše 30 s starý, proto se všechny tokeny přepodepisují
 * každých 10 s a scénáře čtou vždy aktuální hodnotu synchronně.
 */
export async function identityTokens(
  info: StackInfo,
  users: SeededUser[],
): Promise<IdentityTokens> {
  const pem = await readFile(info.signingKeyFile, 'utf8');
  const key = await importPKCS8(pem, 'ES256');
  const spki = createPublicKey(pem)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const kid = createHash('sha256').update(spki).digest('base64url');
  const tokens = new Map<string, string>();
  const refresh = async () => {
    await Promise.all(
      users.map(async (user) => {
        const identity = {
          userId: user.userId,
          givenName: user.givenName,
          familyName: user.familyName,
          email: user.email,
          roles: user.roles,
        };
        tokens.set(
          user.userId,
          await new SignJWT({ identity })
            .setProtectedHeader({
              alg: 'ES256',
              typ: 'anico-identity+jwt',
              kid,
            })
            .setSubject(user.userId)
            .setIssuer(info.issuer)
            .setAudience(info.audience)
            .setIssuedAt()
            .setExpirationTime('30s')
            .setJti(randomUUID())
            .sign(key),
        );
      }),
    );
  };
  await refresh();
  const timer = setInterval(() => void refresh(), 10_000);
  timer.unref();
  return {
    headers(user) {
      const token = tokens.get(user.userId);
      if (!token) throw new Error(`Chybí token pro ${user.userId}`);
      return { 'x-anico-identity': token };
    },
    close() {
      clearInterval(timer);
    },
  };
}

/** Spustí `task` pro všechny položky s omezeným souběhem. */
export async function inPool<T, R>(
  items: readonly T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index]!, index);
      }
    }),
  );
  return results;
}
