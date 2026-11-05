import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
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

    const giveBack = (
      requestId: string,
      reviewedBy = 'admin-3',
      returnReason = 'Doplňte',
    ) =>
      repository.decideVerification(requestId, {
        decision: 'RETURNED',
        returnReason,
        reviewedBy,
        reviewedAt: new Date(),
      });

    /** Oprava vycházející z aktuálně uloženého certifikátu (není-li zadán). */
    const resubmit = async (
      breederId: string,
      requestId: string,
      certificate: Submission['breedingStationCertificate'] | null = null,
      currentCertificateReference?: string,
    ) =>
      repository.resubmitVerification(breederId, requestId, {
        ...submission(9),
        breedingStationCertificate: certificate,
        currentCertificateReference:
          currentCertificateReference ??
          (await repository.findByBreederId(breederId))?.verificationRequest
            ?.breedingStationCertificate.fileReference ??
          'none',
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

    afterEach(() => {
      vi.useRealTimers();
    });

    /** Řízené hodiny jen pro Date (časovače driveru běží dál). */
    const at = (iso: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
    };

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
        returnReason: null,
        reviewHistory: [],
        breedingStationCertificate: {
          fileName: 'cert.pdf',
          fileReference: 'ref-1',
        },
      });
      expect(breeder?.verificationRequest?.requestId).toMatch(/^[a-f0-9]{24}$/);
      expect(
        breeder?.verificationRequest?.submittedAt.getTime(),
      ).toBeGreaterThanOrEqual(before);
      expect(breeder?.verificationRequest?.lastSubmittedAt).toEqual(
        breeder?.verificationRequest?.submittedAt,
      );

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
        returnReason: null,
      });
      expect(breeder?.verificationRequest?.reviewedAt).toBeInstanceOf(Date);
      expect(breeder?.verificationRequest?.reviewHistory).toEqual([
        {
          decision: 'APPROVED',
          reviewedBy: 'admin-1',
          reviewedAt: breeder?.verificationRequest?.reviewedAt,
          reason: null,
        },
      ]);
    });

    it('rejection stores the reason and keeps isVerified false', async () => {
      const requestId = await submitted('b1');
      const breeder = await reject(requestId);

      expect(breeder?.isVerified).toBe(false);
      expect(breeder?.verificationRequest).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Nečitelné',
        returnReason: null,
        reviewedBy: 'admin-2',
        reviewHistory: [
          expect.objectContaining({
            decision: 'REJECTED',
            reviewedBy: 'admin-2',
            reason: 'Nečitelné',
          }),
        ],
      });
    });

    it('return stores the reason and history, keeps isVerified false and blocks further decisions', async () => {
      const requestId = await submitted('b1');
      const breeder = await giveBack(requestId);

      expect(breeder?.isVerified).toBe(false);
      expect(breeder?.verificationRequest).toMatchObject({
        status: 'RETURNED',
        returnReason: 'Doplňte',
        rejectionReason: null,
        reviewedBy: 'admin-3',
        reviewHistory: [
          expect.objectContaining({
            decision: 'RETURNED',
            reviewedBy: 'admin-3',
            reason: 'Doplňte',
          }),
        ],
      });
      expect(await approve(requestId)).toBeNull();
      expect(await giveBack(requestId, 'admin-4')).toBeNull();
      expect(await repository.findByBreederId('b1')).toEqual(breeder);
    });

    it('resubmission without a file keeps certificate, submittedAt and history', async () => {
      at('2026-03-01T08:00:00.000Z');
      const requestId = await submitted('b1');
      const returned = await giveBack(requestId);
      at('2026-03-02T08:00:00.000Z');

      const corrected = await resubmit('b1', requestId);

      expect(corrected?.firstName).toBe('Jan9');
      expect(corrected?.breedingStationName).toBe('Stanice 9');
      expect(corrected?.isVerified).toBe(false);
      const request = corrected!.verificationRequest!;
      expect(request).toMatchObject({
        requestId,
        status: 'PENDING',
        reviewedBy: null,
        reviewedAt: null,
        rejectionReason: null,
        returnReason: null,
        breedingStationCertificate: {
          fileName: 'cert.pdf',
          fileReference: 'ref-1',
        },
      });
      expect(request.submittedAt).toEqual(
        returned!.verificationRequest!.submittedAt,
      );
      expect(request.submittedAt).toEqual(new Date('2026-03-01T08:00:00.000Z'));
      expect(request.lastSubmittedAt).toEqual(
        new Date('2026-03-02T08:00:00.000Z'),
      );
      expect(request.reviewHistory).toEqual(
        returned!.verificationRequest!.reviewHistory,
      );
    });

    it('resubmission with a file replaces the certificate reference', async () => {
      const requestId = await submitted('b1');
      await giveBack(requestId);

      const corrected = await resubmit('b1', requestId, {
        fileName: 'novy.png',
        fileReference: 'ref-new',
      });

      expect(
        corrected?.verificationRequest?.breedingStationCertificate,
      ).toEqual({ fileName: 'novy.png', fileReference: 'ref-new' });
    });

    it('resubmission succeeds only for the RETURNED request of that breeder', async () => {
      const requestId = await submitted('b1');
      await submitted('b2', 2);

      expect(await resubmit('b1', requestId)).toBeNull(); // PENDING
      await giveBack(requestId);
      expect(await resubmit('b2', requestId)).toBeNull(); // cizí žádost
      expect(await resubmit('b1', 'a'.repeat(24))).toBeNull();
      expect(await resubmit('b1', 'nevalidni')).toBeNull();
      expect(await resubmit('b1', requestId)).not.toBeNull();
      expect(await resubmit('b1', requestId)).toBeNull(); // už PENDING

      const approvedId = await submitted('b3', 3);
      await approve(approvedId);
      expect(await resubmit('b3', approvedId)).toBeNull();
      const rejectedId = await submitted('b4', 4);
      await reject(rejectedId);
      expect(await resubmit('b4', rejectedId)).toBeNull();
    });

    it('resubmission based on a replaced certificate returns null and changes nothing', async () => {
      const requestId = await submitted('b1');
      await giveBack(requestId);
      const before = await repository.findByBreederId('b1');

      expect(
        await resubmit(
          'b1',
          requestId,
          { fileName: 'novy.pdf', fileReference: 'ref-new' },
          'ref-stale',
        ),
      ).toBeNull();
      expect(await resubmit('b1', requestId, null, 'ref-stale')).toBeNull();
      expect(await repository.findByBreederId('b1')).toEqual(before);
    });

    it('concurrent resubmissions produce exactly one success', async () => {
      const requestId = await submitted('b1');
      await giveBack(requestId);

      const results = await Promise.all([
        resubmit('b1', requestId, {
          fileName: 'a.pdf',
          fileReference: 'ref-a',
        }),
        resubmit('b1', requestId, {
          fileName: 'b.pdf',
          fileReference: 'ref-b',
        }),
        resubmit('b1', requestId, {
          fileName: 'c.pdf',
          fileReference: 'ref-c',
        }),
      ]);

      const winners = results.filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(
        (await repository.findByBreederId('b1'))?.verificationRequest
          ?.breedingStationCertificate,
      ).toEqual(winners[0]?.verificationRequest?.breedingStationCertificate);
    });

    it('concurrent return and approval produce exactly one decision in the history', async () => {
      const requestId = await submitted('b1');
      const results = await Promise.all([
        giveBack(requestId),
        approve(requestId),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      const stored = await repository.findByBreederId('b1');
      expect(stored?.verificationRequest?.reviewHistory).toHaveLength(1);
      expect(stored?.verificationRequest?.reviewHistory[0]?.decision).toBe(
        stored?.verificationRequest?.status,
      );
      expect(stored?.isVerified).toBe(
        stored?.verificationRequest?.status === 'APPROVED',
      );
    });

    it('keeps the history over two returns and the final approval, oldest first', async () => {
      const requestId = await submitted('b1');
      await giveBack(requestId, 'admin-1', 'první');
      await resubmit('b1', requestId);
      await giveBack(requestId, 'admin-2', 'druhý');
      await resubmit('b1', requestId);
      const approved = await approve(requestId, 'admin-3');

      expect(approved?.isVerified).toBe(true);
      expect(approved?.verificationRequest).toMatchObject({
        status: 'APPROVED',
        reviewedBy: 'admin-3',
        returnReason: null,
      });
      expect(
        approved?.verificationRequest?.reviewHistory.map((review) => [
          review.decision,
          review.reviewedBy,
          review.reason,
        ]),
      ).toEqual([
        ['RETURNED', 'admin-1', 'první'],
        ['RETURNED', 'admin-2', 'druhý'],
        ['APPROVED', 'admin-3', null],
      ]);
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

    it('lists the queue filtered by status, by the latest submission', async () => {
      at('2026-03-01T08:00:00.000Z');
      const first = await submitted('b1', 1);
      at('2026-03-01T08:01:00.000Z');
      const second = await submitted('b2', 2);
      at('2026-03-01T08:02:00.000Z');
      await submitted('b3', 3);
      at('2026-03-01T08:03:00.000Z');
      const fourth = await submitted('b4', 4);
      await provision('b5'); // bez žádosti
      await approve(first);
      await giveBack(second);
      await giveBack(fourth);
      at('2026-03-01T08:04:00.000Z');
      await resubmit('b2', second); // opravená žádost se řadí podle opravy

      const pending = await repository.listByVerificationStatus('PENDING');
      expect(pending.map((b) => b.breederId)).toEqual(['b3', 'b2']);

      const returned = await repository.listByVerificationStatus('RETURNED');
      expect(returned.map((b) => b.breederId)).toEqual(['b4']);

      const approved = await repository.listByVerificationStatus('APPROVED');
      expect(approved.map((b) => b.breederId)).toEqual(['b1']);

      expect(await repository.listByVerificationStatus('REJECTED')).toEqual([]);
    });

    it('counts requests by status including zeros', async () => {
      expect(await repository.countByVerificationStatus()).toEqual({
        PENDING: 0,
        RETURNED: 0,
        APPROVED: 0,
        REJECTED: 0,
      });

      const a = await submitted('b1', 1);
      await submitted('b2', 2);
      const c = await submitted('b3', 3);
      const d = await submitted('b5', 5);
      await provision('b4');
      await approve(a);
      await reject(c);
      await giveBack(d);

      expect(await repository.countByVerificationStatus()).toEqual({
        PENDING: 1,
        RETURNED: 1,
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
          'verificationRequest.lastSubmittedAt': 1,
        }),
      ).toBeDefined();
      expect(
        byKey({
          'verificationRequest.status': 1,
          'verificationRequest.submittedAt': 1,
        }),
      ).toBeUndefined();
    });
  });
});
