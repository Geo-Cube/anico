import { MyAccountSchema } from '@anico/shared-schemas';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { breederHeaders, takeOverAndSubmit } from '../support/api.js';
import { testApp } from '../support/app.js';

describe('PATCH /breeders/me', () => {
  it('provisions identity and updates only requested fields before submission', async () => {
    const { app, breeders } = testApp();
    const response = await request(app)
      .patch('/breeders/me')
      .set(breederHeaders('b1'))
      .send({ firstName: ' Žofie ', emailAddress: 'zofie@example.test' });
    expect(response.status).toBe(200);
    MyAccountSchema.parse(response.body);
    expect(response.body).toMatchObject({
      breederId: 'b1',
      accountState: 'NOT_SUBMITTED',
      firstName: 'Žofie',
      lastName: 'Chovatel',
      emailAddress: 'zofie@example.test',
      breedingStationName: null,
      breedingStationNumber: null,
    });
    expect((await breeders.findByBreederId('b1'))?.firstName).toBe('Žofie');
    const second = await request(app)
      .patch('/breeders/me')
      .set(breederHeaders('b1'))
      .send({ lastName: 'Čápová' });
    expect(second.status).toBe(200);
    expect(second.body.firstName).toBe('Žofie');
    expect(second.body.lastName).toBe('Čápová');
  });

  it.each(['PENDING', 'RETURNED', 'APPROVED', 'REJECTED'] as const)(
    'rejects edits in %s without changing stored data',
    async (status) => {
      const { app, breeders } = testApp();
      const requestId = await takeOverAndSubmit(app, 'b1');
      if (status !== 'PENDING') {
        await breeders.decideVerification(requestId, {
          revision: 1,
          reviewedBy: 'admin',
          reviewedAt: new Date(),
          ...(status === 'RETURNED'
            ? { decision: status, returnReason: 'Doplnit' }
            : status === 'REJECTED'
              ? { decision: status, rejectionReason: 'Neplatný doklad' }
              : { decision: status }),
        });
      }
      const before = await breeders.findByBreederId('b1');
      const response = await request(app)
        .patch('/breeders/me')
        .set(breederHeaders('b1'))
        .send({ firstName: 'Změněno' });
      expect(response.status).toBe(409);
      expect(response.body.current.accountState).toBe(status);
      expect(await breeders.findByBreederId('b1')).toEqual(before);
    },
  );

  it.each([
    {},
    { breederId: 'foreign' },
    { isVerified: true },
    { breedingStationName: 'Stanice' },
    { breedingStationNumber: '123' },
    { unknown: 'x' },
    { firstName: '' },
    { lastName: ' ' },
    { emailAddress: 'invalid' },
    { firstName: null },
    { firstName: 'a'.repeat(101) },
    { lastName: 'a'.repeat(101) },
    { firstName: 'Jan', isVerified: true },
  ])('rejects invalid or forbidden fields: %j', async (body) => {
    const { app, breeders } = testApp();
    const response = await request(app)
      .patch('/breeders/me')
      .set(breederHeaders('b1'))
      .send(body);
    expect(response.status).toBe(400);
    expect(await breeders.findByBreederId('b1')).toBeNull();
  });

  it('requires identity', async () => {
    const { app } = testApp();
    const response = await request(app)
      .patch('/breeders/me')
      .send({ firstName: 'Jan' });
    expect(response.status).toBe(401);
  });
});
