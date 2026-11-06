import { MyAccountSchema } from '@anico/shared-schemas';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  breederHeaders,
  identityHeaders,
  takeOverAndSubmit,
} from '../support/api.js';
import { testApp } from '../support/app.js';

describe('GET /breeders/me', () => {
  it('returns 401 without identity headers', async () => {
    const { app } = testApp();
    const response = await request(app).get('/breeders/me');
    expect(response.status).toBe(401);
  });

  it('takes over the account from identity and returns NOT_SUBMITTED', async () => {
    const { app, breeders } = testApp();
    const response = await request(app)
      .get('/breeders/me')
      .set(breederHeaders('user-123'));

    expect(response.status).toBe(200);
    MyAccountSchema.parse(response.body);
    expect(response.body).toMatchObject({
      accountState: 'NOT_SUBMITTED',
      breederId: 'user-123',
      emailAddress: 'user-123@example.test',
      isVerified: false,
      breedingStationName: null,
      verificationRequest: null,
    });
    expect(await breeders.findByBreederId('user-123')).not.toBeNull();
  });

  it('preserves Unicode names and ignores a breederId in the query', async () => {
    const { app } = testApp();
    const response = await request(app)
      .get('/breeders/me?breederId=someone-else')
      .set(
        identityHeaders('user-1', { firstName: 'Žofie', lastName: 'Čápová' }),
      );
    expect(response.body.breederId).toBe('user-1');
    expect(response.body.firstName).toBe('Žofie');
  });

  it('does not overwrite the stored profile when identity changes', async () => {
    const { app } = testApp();
    await request(app).get('/breeders/me').set(breederHeaders('user-1'));
    const second = await request(app)
      .get('/breeders/me')
      .set(identityHeaders('user-1', { firstName: 'Jiný' }));
    expect(second.body.firstName).toBe('Test');
  });

  it('shows PENDING state after submission without exposing fileReference', async () => {
    const { app } = testApp();
    await takeOverAndSubmit(app, 'user-123');

    const response = await request(app)
      .get('/breeders/me')
      .set(breederHeaders('user-123'));
    expect(response.status).toBe(200);
    MyAccountSchema.parse(response.body);
    expect(response.body.accountState).toBe('PENDING');
    expect(
      response.body.verificationRequest.breedingStationCertificate,
    ).toEqual({ fileName: 'certifikát.pdf', contentType: 'application/pdf' });
    expect(JSON.stringify(response.body)).not.toContain('fileReference');
  });

  it('fails with 500 and no details when the certificate file is missing', async () => {
    const { app, breeders, files } = testApp();
    await takeOverAndSubmit(app, 'user-123');
    const stored = await breeders.findByBreederId('user-123');
    await files.delete(
      stored!.verificationRequest!.breedingStationCertificate.fileReference,
    );

    const response = await request(app)
      .get('/breeders/me')
      .set(breederHeaders('user-123'));
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });
});
