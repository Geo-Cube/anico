import type { Express } from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { serviceApp } from '../support/app.js';
import type { Breeder } from '../../src/modules/breeders/domain/breeder.js';
import { gridFsFileStorage } from '../../src/modules/breeders/infrastructure/gridfs-file-storage.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import {
  PDF,
  PNG,
  adminHeaders,
  breederHeaders,
  fixtureAuthenticate,
  submit,
  takeOverAndSubmit,
} from '../support/api.js';
import { decideRequest } from '../support/qa.js';

/**
 * Nález z review PR #32: rozhodnutí načtené před vrácením a opravou nesmí
 * schválit novou, dosud neposouzenou verzi podání (MongoDB + GridFS přes HTTP).
 */
describe('zastaralé rozhodnutí po opravě vrácené žádosti (MongoDB)', () => {
  let mongod: MongoMemoryServer;
  let connection: Connection;
  let app: Express;
  const notifyDecision = vi.fn<(breeder: Breeder) => Promise<void>>(
    async () => undefined,
  );

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    connection = await createConnection(
      mongod.getUri('anico_breeder_stale_decision'),
    ).asPromise();
    const repository = mongooseBreederRepository(connection);
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );
    app = serviceApp({
      connection,
      breeders: repository,
      files: gridFsFileStorage(connection),
      notifier: { notifyDecision },
      authenticate: fixtureAuthenticate,
    });
  });

  afterAll(async () => {
    await connection?.close();
    await mongod?.stop();
  });

  it('admin A schválí ze starého detailu -> 409 s aktuální revizí, nic se nezmění; schválení aktuální revize projde', async () => {
    const id = await takeOverAndSubmit(app, 'b1', {
      file: { content: PDF, fileName: 'old-cert.pdf' },
    });

    // admin A načte detail se starým certifikátem
    const loaded = await request(app)
      .get(`/verification-requests/${id}`)
      .set(adminHeaders('admin-a'))
      .expect(200);
    expect(loaded.body).toMatchObject({
      status: 'PENDING',
      revision: 1,
      breedingStationCertificate: { fileName: 'old-cert.pdf' },
    });

    // admin B žádost vrátí, chovatel ji opraví s novým certifikátem
    await decideRequest(
      app,
      id,
      { decision: 'RETURNED', revision: 1, returnReason: 'Nečitelné' },
      'admin-b',
    ).expect(200);
    const corrected = await submit(app, breederHeaders('b1'), {
      file: { content: PNG, fileName: 'new-cert.png' },
    }).expect(201);
    expect(corrected.body.verificationRequest).toMatchObject({
      status: 'PENDING',
      revision: 2,
    });
    notifyDecision.mockClear();

    // admin A rozhodne podle starého detailu
    const stale = await decideRequest(
      app,
      id,
      { decision: 'APPROVED', revision: loaded.body.revision },
      'admin-a',
    );
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: 'Verification revision mismatch',
      current: {
        id,
        status: 'PENDING',
        revision: 2,
        breedingStationCertificate: { fileName: 'new-cert.png' },
        breeder: { isVerified: false },
      },
    });
    const stored = await connection
      .db!.collection('breeders')
      .findOne({ breederId: 'b1' });
    expect(stored?.isVerified).toBe(false);
    expect(stored?.verificationRequest).toMatchObject({
      status: 'PENDING',
      revision: 2,
      reviewedBy: null,
    });
    expect(stored?.verificationRequest.reviewHistory).toHaveLength(1);
    expect(notifyDecision).not.toHaveBeenCalled();

    // po posouzení aktuální revize schválení projde
    const approved = await decideRequest(
      app,
      id,
      { decision: 'APPROVED', revision: stale.body.current.revision },
      'admin-a',
    );
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      revision: 2,
      breeder: { isVerified: true },
    });
    expect(
      approved.body.reviewHistory.map(
        (review: {
          decision: string;
          revision: number;
          reviewedBy: string;
        }) => [review.decision, review.revision, review.reviewedBy],
      ),
    ).toEqual([
      ['RETURNED', 1, 'admin-b'],
      ['APPROVED', 2, 'admin-a'],
    ]);
    expect(notifyDecision).toHaveBeenCalledOnce();
  });
});
