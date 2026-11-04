import { afterAll, beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, type Connection } from 'mongoose';
import type { Submission } from '../../src/modules/breeders/domain/breeder.js';
import type { BreederRepository } from '../../src/modules/breeders/domain/ports.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';

describe('mongooseBreederRepository', () => {
  it('creates a new breeder in MongoDB', async () => {
    const mongod = await MongoMemoryServer.create();

    try {
      const connection = await createConnection(mongod.getUri()).asPromise();

      try {
        const repository = mongooseBreederRepository(connection);

        const breeder = await repository.provision({
          breederId: 'user-123',
          firstName: 'Jan',
          lastName: 'Novák',
          emailAddress: 'jan@example.com',
        });

        expect(breeder.breederId).toBe('user-123');
        expect(breeder.isVerified).toBe(false);
        expect(breeder.verificationRequest).toBeNull();

        const savedBreeder = await repository.findByBreederId('user-123');

        expect(savedBreeder).not.toBeNull();
        expect(savedBreeder?.firstName).toBe('Jan');
      } finally {
        await connection.close();
      }
    } finally {
      await mongod.stop();
    }
  });

  it('does not overwrite an existing breeder', async () => {
    const mongod = await MongoMemoryServer.create();

    try {
      const connection = await createConnection(mongod.getUri()).asPromise();

      try {
        const repository = mongooseBreederRepository(connection);

        const first = await repository.provision({
          breederId: 'user-123',
          firstName: 'Jan',
          lastName: 'Novák',
          emailAddress: 'jan@example.com',
        });

        const second = await repository.provision({
          breederId: 'user-123',
          firstName: 'Petr',
          lastName: 'Novák',
          emailAddress: 'petr@example.com',
        });

        expect(first.firstName).toBe('Jan');
        expect(second.firstName).toBe('Jan');
        expect(second.breederId).toBe('user-123');
        expect(second.emailAddress).toBe('jan@example.com');

        const count = await connection.collection('breeders').countDocuments({
          breederId: 'user-123',
        });

        expect(count).toBe(1);
      } finally {
        await connection.close();
      }
    } finally {
      await mongod.stop();
    }
  });

  it('handles concurrent breeder provisioning', async () => {
    const mongod = await MongoMemoryServer.create();

    try {
      const connection = await createConnection(mongod.getUri()).asPromise();

      try {
        const repository = mongooseBreederRepository(connection);
        await connection.model('Breeder').init();

        const input = {
          breederId: 'user-123',
          firstName: 'Jan',
          lastName: 'Novák',
          emailAddress: 'jan@example.com',
        };

        const results = await Promise.all([
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
          repository.provision(input),
        ]);

        expect(results).toHaveLength(15);

        const savedBreeder = await repository.findByBreederId('user-123');

        expect(savedBreeder).not.toBeNull();
        expect(savedBreeder?.firstName).toBe('Jan');

        const count = await connection.collection('breeders').countDocuments({
          breederId: 'user-123',
        });

        expect(count).toBe(1);
      } finally {
        await connection.close();
      }
    } finally {
      await mongod.stop();
    }
  });

  describe('verification workflow', () => {
    let mongod: MongoMemoryServer;
    let connection: Connection;
    let repository: BreederRepository;

    const submission = (n = 1): Submission => ({
      firstName: `Jan${n}`,
      lastName: 'Novák',
      emailAddress: `jan${n}@example.com`,
      breedingStationName: `Stanice ${n}`,
      breedingStationNumber: `00${n}`,
      breedingStationCertificate: {
        fileName: 'cert.pdf',
        fileReference: `ref-${n}`,
      },
    });

    const provision = (breederId: string) =>
      repository.provision({
        breederId,
        firstName: 'X',
        lastName: 'Y',
        emailAddress: 'x@example.com',
      });

    const approve = (requestId: string, reviewedBy = 'admin-1') =>
      repository.decideVerification(requestId, {
        decision: 'APPROVED',
        reviewedBy,
        reviewedAt: new Date(),
      });

    const reject = (requestId: string, reviewedBy = 'admin-2') =>
      repository.decideVerification(requestId, {
        decision: 'REJECTED',
        rejectionReason: 'Nečitelné',
        reviewedBy,
        reviewedAt: new Date(),
      });

    async function submitted(breederId: string, n = 1) {
      await provision(breederId);
      const breeder = await repository.submitVerification(
        breederId,
        submission(n),
      );
      return breeder!.verificationRequest!.requestId;
    }

    beforeAll(async () => {
      mongod = await MongoMemoryServer.create();
      connection = await createConnection(mongod.getUri()).asPromise();
      repository = mongooseBreederRepository(connection);
      await Promise.all(
        Object.values(connection.models).map((model) => model.init()),
      );
    });

    afterAll(async () => {
      await connection.close();
      await mongod.stop();
    });

    beforeEach(async () => {
      await connection.collection('breeders').deleteMany({});
    });

    it('stores profile, station and PENDING request in one document', async () => {
      await provision('b1');
      const before = Date.now();
      const breeder = await repository.submitVerification('b1', submission());

      expect(breeder).not.toBeNull();
      expect(breeder?.firstName).toBe('Jan1');
      expect(breeder?.emailAddress).toBe('jan1@example.com');
      expect(breeder?.breedingStationName).toBe('Stanice 1');
      expect(breeder?.hasBreedingStation).toBe(true);
      expect(breeder?.isVerified).toBe(false);
      expect(breeder?.verificationRequest).toMatchObject({
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        breedingStationCertificate: {
          fileName: 'cert.pdf',
          fileReference: 'ref-1',
        },
      });
      expect(breeder?.verificationRequest?.requestId).toMatch(/^[a-f0-9]{24}$/);
      expect(
        breeder?.verificationRequest?.submittedAt.getTime(),
      ).toBeGreaterThanOrEqual(before);

      const raw = await connection
        .collection('breeders')
        .findOne({ breederId: 'b1' });
      expect(raw?.hasBreedingStation).toBe(true);
    });

    it('second submit returns null and keeps the data', async () => {
      await provision('b1');
      const first = await repository.submitVerification('b1', submission(1));
      const second = await repository.submitVerification('b1', submission(2));

      expect(second).toBeNull();
      const stored = await repository.findByBreederId('b1');
      expect(stored).toEqual(first);
    });

    it('submit for unknown breeder returns null', async () => {
      expect(
        await repository.submitVerification('unknown', submission()),
      ).toBeNull();
    });

    it('concurrent submits produce exactly one success', async () => {
      await provision('b1');
      const results = await Promise.all([
        repository.submitVerification('b1', submission(1)),
        repository.submitVerification('b1', submission(2)),
        repository.submitVerification('b1', submission(3)),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);
    });

    it('approval sets status, reviewer, date and isVerified', async () => {
      const requestId = await submitted('b1');
      const breeder = await approve(requestId);

      expect(breeder?.isVerified).toBe(true);
      expect(breeder?.verificationRequest).toMatchObject({
        status: 'APPROVED',
        reviewedBy: 'admin-1',
        rejectionReason: null,
      });
      expect(breeder?.verificationRequest?.reviewedAt).toBeInstanceOf(Date);
    });

    it('rejection stores the reason and keeps isVerified false', async () => {
      const requestId = await submitted('b1');
      const breeder = await reject(requestId);

      expect(breeder?.isVerified).toBe(false);
      expect(breeder?.verificationRequest).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Nečitelné',
        reviewedBy: 'admin-2',
      });
    });

    it('second decision returns null and the first result stays', async () => {
      const requestId = await submitted('b1');
      const first = await approve(requestId);

      expect(await reject(requestId)).toBeNull();
      expect(await approve(requestId, 'admin-3')).toBeNull();
      expect(await repository.findByBreederId('b1')).toEqual(first);
    });

    it('concurrent decisions produce exactly one success and consistent isVerified', async () => {
      const requestId = await submitted('b1');
      const results = await Promise.all([
        approve(requestId),
        reject(requestId),
      ]);
      expect(results.filter((r) => r !== null)).toHaveLength(1);

      const stored = await repository.findByBreederId('b1');
      expect(stored?.isVerified).toBe(
        stored?.verificationRequest?.status === 'APPROVED',
      );
    });

    it('invalid or unknown request id returns null', async () => {
      expect(await approve('nevalidni')).toBeNull();
      expect(await approve('a'.repeat(24))).toBeNull();
    });

    it('lists the queue filtered by status, oldest first', async () => {
      const first = await submitted('b1', 1);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await submitted('b2', 2);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await submitted('b3', 3);
      await provision('b4'); // bez žádosti
      await approve(first);

      const all = await repository.listByVerificationStatus();
      expect(all.map((b) => b.breederId)).toEqual(['b1', 'b2', 'b3']);

      const pending = await repository.listByVerificationStatus('PENDING');
      expect(pending.map((b) => b.breederId)).toEqual(['b2', 'b3']);

      const approved = await repository.listByVerificationStatus('APPROVED');
      expect(approved.map((b) => b.breederId)).toEqual(['b1']);

      expect(await repository.listByVerificationStatus('REJECTED')).toEqual([]);
    });

    it('counts requests by status including zeros', async () => {
      expect(await repository.countByVerificationStatus()).toEqual({
        PENDING: 0,
        APPROVED: 0,
        REJECTED: 0,
      });

      const a = await submitted('b1', 1);
      await submitted('b2', 2);
      const c = await submitted('b3', 3);
      await provision('b4');
      await approve(a);
      await reject(c);

      expect(await repository.countByVerificationStatus()).toEqual({
        PENDING: 1,
        APPROVED: 1,
        REJECTED: 1,
      });
    });

    it('declares the expected indexes', async () => {
      const indexes = await connection.collection('breeders').indexes();
      const byKey = (key: Record<string, number>) =>
        indexes.find((i) => JSON.stringify(i.key) === JSON.stringify(key));

      expect(byKey({ breederId: 1 })?.unique).toBe(true);

      const requestIdIndex = byKey({ 'verificationRequest._id': 1 });
      expect(requestIdIndex?.unique).toBe(true);
      expect(requestIdIndex?.partialFilterExpression).toBeDefined();

      expect(
        byKey({
          'verificationRequest.status': 1,
          'verificationRequest.submittedAt': 1,
        }),
      ).toBeDefined();
    });
  });
});
