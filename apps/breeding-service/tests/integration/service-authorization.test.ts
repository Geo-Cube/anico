import { beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import {
  assertResourceOwner,
  AuthorizationError,
  createIdentityVerifier,
  requireAuth,
  requireRole,
} from '@anico/auth';
import { testIdentity } from '@anico/auth/testing';
import type { Identity } from '@anico/shared-schemas';
import { createApp } from '../../src/app.js';

describe('service identity and ownership integration', () => {
  const ownerId = randomUUID();
  let app: ReturnType<typeof createApp>;
  let token: (identity: Identity) => Promise<string>;
  beforeAll(async () => {
    const keys = await generateKeyPair('ES256');
    const verify = createIdentityVerifier({
      key: createLocalJWKSet({
        keys: [
          {
            ...(await exportJWK(keys.publicKey)),
            alg: 'ES256',
            kid: 'integration',
          },
        ],
      }),
      issuer: 'https://auth.example.test',
      audience: 'service-test',
    });
    token = (identity) =>
      new SignJWT({ identity })
        .setProtectedHeader({
          alg: 'ES256',
          typ: 'anico-identity+jwt',
          kid: 'integration',
        })
        .setSubject(identity.userId)
        .setIssuer('https://auth.example.test')
        .setAudience('service-test')
        .setIssuedAt()
        .setExpirationTime('30s')
        .setJti(randomUUID())
        .sign(keys.privateKey);
    const modules = express.Router();
    modules.post('/owned', (req, res) => {
      // Loaded from the repository in a real service, not req.body.ownerId.
      assertResourceOwner(req.auth, ownerId);
      res.json({ userId: req.auth.userId });
    });
    modules.post('/moderate', requireRole('admin', 'owner'), (_req, res) =>
      res.sendStatus(204),
    );
    app = createApp({
      logger: pino({ level: 'silent' }),
      authenticate: requireAuth(verify),
      modules,
      health: { status: 'ok', service: 'breeding-service' },
      isReady: () => true,
      repository: {
        create: async () => {
          throw new Error('Not used');
        },
      },
    });
  });
  it('keeps health public but denies missing/forged identity even with x-user headers', async () => {
    await request(app).get('/health').expect(200);
    await request(app)
      .post('/owned')
      .set('x-user-id', ownerId)
      .set('x-user-roles', 'owner')
      .send({})
      .expect(401);
    await request(app)
      .post('/owned')
      .set('x-anico-identity', 'forged')
      .send({})
      .expect(401);
  });
  it('uses stored ownership and ignores requested owner/roles; admin has no implicit ownership bypass', async () => {
    const own = testIdentity({ userId: ownerId });
    const other = testIdentity();
    await request(app)
      .post('/owned')
      .set('x-anico-identity', await token(own))
      .send({ ownerId: other.userId })
      .expect(200);
    await request(app)
      .post('/owned')
      .set('x-anico-identity', await token(other))
      .send({ ownerId: other.userId, roles: ['owner'] })
      .expect(403);
    for (const role of ['admin', 'owner'] as const)
      await request(app)
        .post('/owned')
        .set('x-anico-identity', await token(testIdentity({ roles: [role] })))
        .send({})
        .expect(403);
  });
  it('requires explicitly allowed roles for administrative routes', async () => {
    await request(app)
      .post('/moderate')
      .set('x-anico-identity', await token(testIdentity()))
      .expect(403);
    for (const role of ['admin', 'owner'] as const)
      await request(app)
        .post('/moderate')
        .set('x-anico-identity', await token(testIdentity({ roles: [role] })))
        .expect(204);
  });
  it('lets a domain explicitly allow moderation and rejects an absent actor', () => {
    const admin = testIdentity({ roles: ['admin'] });
    expect(() =>
      assertResourceOwner(admin, ownerId, { allowRoles: ['admin', 'owner'] }),
    ).not.toThrow();
    try {
      assertResourceOwner(undefined, ownerId);
      throw new Error('Expected denial');
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).status).toBe(401);
    }
  });
});
