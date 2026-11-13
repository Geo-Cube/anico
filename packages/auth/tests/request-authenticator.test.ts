import { randomUUID } from 'node:crypto';
import express from 'express';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { requestAuthenticator } from '../src/index.js';
import { testIdentity } from '../src/testing.js';

const issuer = 'https://identity.example.test';
const audience = 'animal-service';
let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;
let privateJwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)) };
  privateJwk = { ...(await exportJWK(pair.privateKey)) };
});

const localEnv = (keys: unknown[] = [publicJwk]): NodeJS.ProcessEnv => ({
  APP_ENV: 'dev',
  HOST: '127.0.0.1',
  NODE_ENV: 'development',
  AUTH_JWKS_JSON: JSON.stringify({ keys }),
  AUTH_ISSUER: issuer,
  AUTH_AUDIENCE: audience,
});

describe('requestAuthenticator', () => {
  it('lokální JWKS v loopback dev režimu ověří podepsanou identitu', async () => {
    const authenticate = requestAuthenticator(localEnv());
    expect(authenticate).toBeDefined();
    const identity = testIdentity();
    const token = await new SignJWT({ identity })
      .setProtectedHeader({ alg: 'ES256', typ: 'anico-identity+jwt' })
      .setSubject(identity.userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('30s')
      .setJti(randomUUID())
      .sign(privateKey);
    const server = express().get('/', authenticate!, (req, res) => {
      res.json(req.auth);
    });
    const ok = await request(server).get('/').set('x-anico-identity', token);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(identity);
    const missing = await request(server).get('/');
    expect(missing.status).toBe(401);
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['APP_ENV mimo dev', { APP_ENV: 'local' }],
    ['HOST mimo 127.0.0.1', { HOST: '0.0.0.0' }],
    ['HOST localhost', { HOST: 'localhost' }],
  ])('lokální JWKS odmítne: %s', (_, override) => {
    expect(() => requestAuthenticator({ ...localEnv(), ...override })).toThrow(
      'Local identity keys require loopback development mode',
    );
  });

  it.each([
    ['privátní klíč', () => [privateJwk]],
    ['prázdná sada', () => []],
    ['jiná křivka', () => [{ ...publicJwk, crv: 'P-384' }]],
    ['jiný typ klíče', () => [{ ...publicJwk, kty: 'RSA' }]],
    ['null položka', () => [null]],
  ])('lokální JWKS odmítne %s bez prozrazení hodnot', (_, keys) => {
    let message = '';
    try {
      requestAuthenticator(localEnv(keys()));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('Invalid public identity keys; values hidden');
    expect(message).not.toContain(String(privateJwk.d));
  });

  it('odmítne nevalidní JSON v AUTH_JWKS_JSON', () => {
    expect(() =>
      requestAuthenticator({ ...localEnv(), AUTH_JWKS_JSON: '{not json' }),
    ).toThrow('Invalid public identity keys; values hidden');
  });

  it('odmítne současně AUTH_JWKS_JSON i AUTH_JWKS_URL', () => {
    expect(() =>
      requestAuthenticator({
        ...localEnv(),
        AUTH_JWKS_URL: 'https://identity.example.test/jwks.json',
      }),
    ).toThrow('Invalid identity configuration');
  });

  it.each(['AUTH_ISSUER', 'AUTH_AUDIENCE'])('odmítne chybějící %s', (name) => {
    const env = {
      NODE_ENV: 'production',
      APP_ENV: 'prod',
      AUTH_JWKS_URL: 'https://identity.example.test/jwks.json',
      AUTH_ISSUER: issuer,
      AUTH_AUDIENCE: audience,
    };
    delete env[name as keyof typeof env];
    expect(() => requestAuthenticator(env)).toThrow(
      'Invalid identity configuration',
    );
  });

  it('vzdálené JWKS v produkci vytvoří middleware', () => {
    expect(
      requestAuthenticator({
        NODE_ENV: 'production',
        APP_ENV: 'prod',
        AUTH_JWKS_URL: 'https://identity.example.test/jwks.json',
        AUTH_ISSUER: issuer,
        AUTH_AUDIENCE: audience,
      }),
    ).toBeTypeOf('function');
  });

  it.each([
    ['produkce bez APP_ENV', { NODE_ENV: 'production' }],
    ['produkce s APP_ENV=prod', { NODE_ENV: 'production', APP_ENV: 'prod' }],
    ['sdílený dev', { NODE_ENV: 'development', APP_ENV: 'dev' }],
  ])('bez JWKS selže: %s', (_, env) => {
    expect(() => requestAuthenticator(env)).toThrow(
      'API requires identity configuration',
    );
  });

  it.each([
    ['lokální vývoj', { NODE_ENV: 'development', APP_ENV: 'local' }],
    [
      'produkční build v kontejneru APP_ENV=local',
      { NODE_ENV: 'production', APP_ENV: 'local' },
    ],
    ['test', { NODE_ENV: 'test' }],
  ])('bez JWKS vrátí undefined: %s', (_, env) => {
    expect(requestAuthenticator(env)).toBeUndefined();
  });
});
