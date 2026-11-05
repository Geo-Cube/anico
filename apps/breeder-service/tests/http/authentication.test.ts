import { testIdentity } from '@anico/auth/testing';
import { MyAccountSchema } from '@anico/shared-schemas';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { PDF, submit, validFields } from '../support/api.js';
import { inMemoryBreeders, inMemoryFiles } from '../support/in-memory.js';
import { signedAuth } from '../support/signed-auth.js';
import { binary } from '../support/qa.js';

async function authenticatedApp() {
  const auth = await signedAuth();
  const breeders = inMemoryBreeders();
  const files = inMemoryFiles();
  const app = createApp({
    logger: pino({ level: 'silent' }),
    isReady: () => true,
    breeders,
    files,
    notifier: { notifyDecision: async () => undefined },
    authenticate: auth.authenticate,
  });
  return { app, breeders, files, ...auth };
}

describe('real @anico/auth HTTP boundary', () => {
  it('keeps health public and rejects missing, forged and x-user-only credentials', async () => {
    const { app, files } = await authenticatedApp();
    await request(app).get('/health').expect(200);
    await request(app).get('/ready').expect(200);
    const forged = await signedAuth();
    const variants = [
      {},
      { 'x-anico-identity': 'not.a.jwt' },
      await forged.headers(testIdentity({ roles: ['admin'] })),
      {
        'x-user-id': 'spoofed',
        'x-user-roles': 'owner',
        'x-user-email': 'spoof@example.test',
      },
    ];
    for (const headers of variants) {
      for (const path of [
        '/breeders/me',
        '/verification-requests',
        '/breeders/me/verification-request/certificate',
      ]) {
        await request(app).get(path).set(headers).expect(401);
      }
    }
    expect(files.size()).toBe(0);
  });

  it('requires req.auth even when no authenticator was configured', async () => {
    const app = createApp({
      logger: pino({ level: 'silent' }),
      isReady: () => true,
      breeders: inMemoryBreeders(),
      files: inMemoryFiles(),
      notifier: { notifyDecision: async () => undefined },
    });
    await request(app).get('/health').expect(200);
    await request(app)
      .get('/breeders/me')
      .set('x-user-id', 'spoof')
      .expect(401);
    await request(app)
      .get('/verification-requests')
      .set('x-user-roles', 'admin')
      .expect(401);
  });

  it('authorizes breeder, admin and owner using only signed roles', async () => {
    const { app, headers } = await authenticatedApp();
    const breeder = await headers(testIdentity());
    await request(app)
      .get('/verification-requests')
      .set(breeder)
      .set('x-user-roles', 'admin')
      .expect(403);
    for (const role of ['admin', 'owner'] as const) {
      await request(app)
        .get('/verification-requests')
        .set(await headers(testIdentity({ roles: [role] })))
        .expect(200);
    }
  });

  it('preserves nullable identity profile until a valid submission fills it', async () => {
    const { app, headers } = await authenticatedApp();
    const identity = testIdentity({
      givenName: null,
      familyName: null,
      email: null,
    });
    const credentials = await headers(identity);
    const initial = await request(app)
      .get('/breeders/me')
      .set(credentials)
      .expect(200);
    MyAccountSchema.parse(initial.body);
    expect(initial.body).toMatchObject({
      breederId: identity.userId,
      firstName: null,
      lastName: null,
      emailAddress: null,
      accountState: 'NOT_SUBMITTED',
    });
    await submit(app, credentials, {
      fields: { ...validFields(), firstName: '' },
    }).expect(400);
    await submit(app, credentials).expect(201);
    const submitted = await request(app)
      .get('/breeders/me')
      .set(credentials)
      .expect(200);
    MyAccountSchema.parse(submitted.body);
    expect(submitted.body).toMatchObject({
      ...validFields(),
      accountState: 'PENDING',
    });
  });

  it('isolates own certificates and does not accept spoofed owner or admin headers', async () => {
    const { app, headers } = await authenticatedApp();
    const owner = testIdentity();
    const other = testIdentity();
    const ownHeaders = await headers(owner);
    const otherHeaders = await headers(other);
    await request(app).get('/breeders/me').set(ownHeaders).expect(200);
    const created = await submit(app, ownHeaders).expect(201);
    const id = created.body.verificationRequest.id as string;
    await request(app).get('/breeders/me').set(otherHeaders).expect(200);
    const own = await request(app)
      .get('/breeders/me/verification-request/certificate')
      .set(ownHeaders)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(own.body).toEqual(PDF);
    await request(app)
      .get(
        `/breeders/me/verification-request/certificate?breederId=${owner.userId}`,
      )
      .set(otherHeaders)
      .set('x-user-id', owner.userId)
      .expect(404);
    await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(otherHeaders)
      .set('x-user-roles', 'admin')
      .expect(403);
    await request(app)
      .get(`/verification-requests/${id}/certificate`)
      .set(await headers(testIdentity({ roles: ['owner'] })))
      .expect(200);
  });
});
