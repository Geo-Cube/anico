import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { breedersRouter } from '../../src/modules/breeders/http/breeders-router.js';
import { MyAccountSchema } from '@anico/shared-schemas';
import { inMemoryBreeders } from '../support/in-memory.js';
import { getMyAccountHandler } from '../../src/modules/breeders/http/get-my-account-handler.js';
import type { FileStorage } from '../../src/modules/breeders/domain/ports.js';
import { Readable } from 'node:stream';

const files: FileStorage = {
  async save() {
    return 'file-123';
  },

  async open(fileReference) {
    if (fileReference !== 'file-123') {
      return null;
    }

    return {
      stream: Readable.from([]),
      size: 0,
      contentType: 'application/pdf',
    };
  },

  async delete() {
    // Doplň.
  },

  async getMetadata(fileReference) {
    if (fileReference !== 'file-123') {
      return null;
    }
    return { contentType: 'application/pdf' };
  },
};

describe('GET /breeders/me', () => {
  it('returns the current breeder account', async () => {
    const repository = inMemoryBreeders();
    const app = express();

    const resolveCurrentBreeder = async () => ({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    app.use(
      '/breeders',
      breedersRouter({
        repository,
        resolveCurrentBreeder,
        files,
      }),
    );

    const response = await request(app).get('/breeders/me');
    MyAccountSchema.parse(response.body);
    expect(response.status).toBe(200);
    expect(response.body.accountState).toBe('NOT_SUBMITTED');
    expect(response.body.breederId).toBe('user-123');
    expect(response.body.isVerified).toBe(false);
  });

  it('returns updated account state after verification submission', async () => {
    const repository = inMemoryBreeders();
    const app = express();

    const resolveCurrentBreeder = async () => ({
      breederId: 'user-123',
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
    });

    app.use(
      '/breeders',
      breedersRouter({
        repository,
        resolveCurrentBreeder,
        files,
      }),
    );

    const firstResponse = await request(app).get('/breeders/me');
    expect(firstResponse.status).toBe(200);
    expect(firstResponse.body.accountState).toBe('NOT_SUBMITTED');

    const submitted = await repository.submitVerification('user-123', {
      firstName: 'Jan',
      lastName: 'Novák',
      emailAddress: 'jan@example.com',
      breedingStationName: 'Stanice U Nováků',
      breedingStationNumber: '123456',
      breedingStationCertificate: {
        fileName: 'certifikat.pdf',
        fileReference: 'file-123',
      },
    });
    expect(submitted).not.toBeNull();

    const secondResponse = await request(app).get('/breeders/me');
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body.accountState).toBe('PENDING');
    MyAccountSchema.parse(secondResponse.body);

    expect(
      secondResponse.body.verificationRequest.breedingStationCertificate,
    ).not.toHaveProperty('fileReference');
  });
});
