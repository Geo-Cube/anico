import { randomUUID } from 'node:crypto';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createIdentityVerifier, type Identity } from '../src/index.js';
import { testIdentity } from '../src/testing.js';

const issuer = 'https://identity.example.test';
const audience = 'breeder-service';
let privateKey: CryptoKey;
let verify: (token: string) => Promise<Identity>;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  verify = createIdentityVerifier({
    key: createLocalJWKSet({ keys: [{ ...jwk, alg: 'ES256' }] }),
    issuer,
    audience,
  });
});

type SignOptions = {
  payload?: JWTPayload;
  sub?: string;
  typ?: string;
  issuer?: string;
  audience?: string;
  iat?: number;
  exp?: number;
  jti?: string | null;
  key?: CryptoKey;
  alg?: string;
};

const now = () => Math.floor(Date.now() / 1000);

async function sign(options: SignOptions = {}) {
  const identity = testIdentity();
  const payload = options.payload ?? { identity };
  const jwt = new SignJWT(payload)
    .setProtectedHeader({
      alg: options.alg ?? 'ES256',
      typ: options.typ ?? 'anico-identity+jwt',
    })
    .setSubject(options.sub ?? identity.userId)
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt(options.iat ?? now())
    .setExpirationTime(options.exp ?? now() + 30);
  if (options.jti !== null) jwt.setJti(options.jti ?? randomUUID());
  return { identity, token: await jwt.sign(options.key ?? privateKey) };
}

describe('createIdentityVerifier', () => {
  it('vrátí identitu z platného tokenu', async () => {
    const { identity, token } = await sign();
    await expect(verify(token)).resolves.toEqual(identity);
  });

  it.each([
    ['jiný typ tokenu', { typ: 'JWT' }],
    ['jiný vydavatel', { issuer: 'https://evil.example.test' }],
    ['jiné publikum', { audience: 'animal-service' }],
    ['chybějící jti', { jti: null }],
  ] satisfies [string, SignOptions][])('odmítne %s', async (_, options) => {
    const { token } = await sign(options);
    await expect(verify(token)).rejects.toThrow();
  });

  it('odmítne jiný algoritmus podpisu', async () => {
    const { privateKey: rsKey } = await generateKeyPair('RS256');
    const { token } = await sign({ alg: 'RS256', key: rsKey });
    await expect(verify(token)).rejects.toThrow();
  });

  it('odmítne podpis cizím klíčem ES256', async () => {
    const { privateKey: foreign } = await generateKeyPair('ES256');
    const { token } = await sign({ key: foreign });
    await expect(verify(token)).rejects.toThrow();
  });

  it('odmítne expirovaný token mimo toleranci, na hraně tolerance přijme', async () => {
    const expired = await sign({ iat: now() - 10, exp: now() - 5 });
    await expect(verify(expired.token)).rejects.toThrow();
    const edge = await sign({ iat: now() - 10, exp: now() - 1 });
    await expect(verify(edge.token)).resolves.toEqual(edge.identity);
  });

  it('odmítne token starší než 30 s i s platným exp', async () => {
    const { token } = await sign({ iat: now() - 40, exp: now() + 60 });
    await expect(verify(token)).rejects.toThrow();
  });

  it('odmítne token vydaný v budoucnosti mimo toleranci hodin', async () => {
    const { token } = await sign({ iat: now() + 10, exp: now() + 40 });
    await expect(verify(token)).rejects.toThrow();
  });

  it('odmítne sub, který neodpovídá identity.userId', async () => {
    const { token } = await sign({ sub: randomUUID() });
    await expect(verify(token)).rejects.toThrow('Identity subject mismatch');
  });

  it('odmítne token bez identity claimu', async () => {
    const { token } = await sign({ payload: {} });
    await expect(verify(token)).rejects.toThrow();
  });

  it.each([
    ['neznámé pole', { isVerified: true }],
    ['neznámá role', { roles: ['root'] }],
    ['duplicitní role', { roles: ['admin', 'admin'] }],
  ])('odmítne neplatný identity claim: %s', async (_, override) => {
    const identity = { ...testIdentity(), ...override };
    const { token } = await sign({
      payload: { identity },
      sub: identity.userId,
    });
    await expect(verify(token)).rejects.toThrow();
  });
});
