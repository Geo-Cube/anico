/**
 * auth-service → backendy: identita podepsaná skutečným signerem auth-service
 * (`/internal/verify`, jak ji volá gateway) projde `@anico/auth` s JWKS ze skutečného
 * `/.well-known/jwks.json`; nesouhlas issueru, audience, typu nebo klíče je odmítnut.
 */
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import {
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  generateKeyPair,
  importPKCS8,
  SignJWT,
  type JWTPayload,
} from 'jose';
import { createIdentityVerifier, requestAuthenticator } from '@anico/auth';
import { SessionSchema, type Identity } from '@anico/shared-schemas';
import { AUDIENCE, ISSUER, startStack, type Stack } from '../support/stack.js';

let stack: Stack;
let identity: Identity;
let cookie: string;

/** Token, který gateway dostane z forwardAuth a předá backendu. */
async function gatewayToken() {
  const response = await fetch(`${stack.authUrl}/internal/verify`, {
    headers: {
      cookie,
      'x-anico-gateway-key': stack.gatewayKey,
      'x-forwarded-method': 'GET',
    },
  });
  expect(response.status).toBe(204);
  return response.headers.get('x-anico-identity')!;
}
/** Tentýž obsah tokenu, podepsaný jinak (hlavička, klíč). */
async function resigned(
  token: string,
  key: CryptoKey,
  header: { typ: string; kid?: string },
) {
  return new SignJWT(decodeJwt(token) as JWTPayload)
    .setProtectedHeader({ alg: 'ES256', ...header })
    .sign(key);
}
/** Middleware z env jako v server.ts backendu, za ním vrácení `req.auth`. */
async function backend(env: NodeJS.ProcessEnv) {
  const authenticate = requestAuthenticator(env);
  if (!authenticate) throw new Error('Authenticator disabled');
  const app = express();
  app.use(authenticate);
  app.get('/whoami', (req, res) => res.json(req.auth));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whoami`;
  return {
    call: (token: string) =>
      fetch(url, { headers: { 'x-anico-identity': token } }),
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    },
  };
}

beforeAll(async () => {
  stack = await startStack();
  const browser = await stack.login('overena', { role: 'admin' });
  cookie = browser.header();
  const session = await fetch(`${stack.authUrl}/session`, {
    headers: { cookie },
  });
  identity = SessionSchema.parse(await session.json()).identity;
});
afterAll(async () => {
  await stack?.close();
});

describe('identita z auth-service v backendech', () => {
  it('verifier s veřejným JWKS z auth-service vrátí identitu relace včetně rolí', async () => {
    const verify = createIdentityVerifier({
      key: createRemoteJWKSet(new URL(stack.jwksUrl)),
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    expect(await verify(await gatewayToken())).toEqual(identity);
    expect(identity.roles.toSorted()).toEqual(['admin', 'breeder']);
  });

  it('breeder-service (AUTH_JWKS_URL) přijme token přímo z forwardAuth', async () => {
    const response = await fetch(`${stack.breederUrl}/breeders/me`, {
      headers: { 'x-anico-identity': await gatewayToken() },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      breederId: identity.userId,
      accountState: 'NOT_SUBMITTED',
    });
  });

  it('lokální režim AUTH_JWKS_JSON přijme obsah skutečného jwks.json (bez soukromé části klíče)', async () => {
    const jwks = await (await fetch(stack.jwksUrl)).text();
    const local = await backend({
      AUTH_JWKS_JSON: jwks,
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: AUDIENCE,
      APP_ENV: 'dev',
      HOST: '127.0.0.1',
    });
    try {
      const response = await local.call(await gatewayToken());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(identity);
    } finally {
      await local.close();
    }
  });

  it.each([
    ['audience', { AUTH_ISSUER: ISSUER, AUTH_AUDIENCE: 'anico-api-prod' }],
    [
      'issuer',
      {
        AUTH_ISSUER: 'https://jiny.example.test/api/auth',
        AUTH_AUDIENCE: AUDIENCE,
      },
    ],
  ])('nesouhlasí-li %s, backend token odmítne (401)', async (_name, claims) => {
    const other = await backend({ AUTH_JWKS_URL: stack.jwksUrl, ...claims });
    try {
      const response = await other.call(await gatewayToken());
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Invalid identity' });
    } finally {
      await other.close();
    }
  });

  it('podpis klíčem auth-service s jiným typem tokenu nebo cizím klíčem je odmítnut', async () => {
    const service = await backend({
      AUTH_JWKS_URL: stack.jwksUrl,
      AUTH_ISSUER: ISSUER,
      AUTH_AUDIENCE: AUDIENCE,
    });
    try {
      const token = await gatewayToken();
      const { kid } = decodeProtectedHeader(token);
      const signingKey = await importPKCS8(
        await readFile(stack.signingKeyFile, 'utf8'),
        'ES256',
      );
      // kontrola: přepodepsání týmž klíčem a typem projde, odmítnutí tedy působí jen změna
      const same = await resigned(token, signingKey, {
        typ: 'anico-identity+jwt',
        kid: kid!,
      });
      expect((await service.call(same)).status).toBe(200);
      const plainJwt = await resigned(token, signingKey, {
        typ: 'JWT',
        kid: kid!,
      });
      expect((await service.call(plainJwt)).status).toBe(401);
      const { privateKey } = await generateKeyPair('ES256');
      const foreign = await resigned(token, privateKey, {
        typ: 'anico-identity+jwt',
        kid: kid!,
      });
      expect((await service.call(foreign)).status).toBe(401);
    } finally {
      await service.close();
    }
  });
});
