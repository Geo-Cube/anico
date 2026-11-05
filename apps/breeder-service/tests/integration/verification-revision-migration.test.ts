import { VerificationRequestSchema } from '@anico/shared-schemas';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types, type Connection } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { migrateDatabase, type Migration } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';
import { toVerificationRequest } from '../../src/modules/breeders/http/breeder-mapper.js';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';

const MIGRATION_ID = '20261105160000-verification-submission-revision';

type Status = 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED';
type Decision = Exclude<Status, 'PENDING'>;

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

/** Dokument ve tvaru po vrácení k doplnění, ale před zavedením revizí. */
function legacy(
  breederId: string,
  status: Status,
  decisions: Decision[],
  revisions?: { request: number; history: number[] },
) {
  const history = decisions.map((decision, index) => ({
    decision,
    ...(revisions ? { revision: revisions.history[index] } : {}),
    reviewedBy: `admin-${index + 1}`,
    reviewedAt: day(index + 2),
    reason: decision === 'APPROVED' ? null : `Důvod ${index + 1}`,
  }));
  const last = history.at(-1);
  const decided = status !== 'PENDING' && last !== undefined;
  return {
    breederId,
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: `${breederId}@example.test`,
    breedingStationName: 'Stanice',
    breedingStationNumber: '1',
    hasBreedingStation: true,
    isVerified: status === 'APPROVED',
    verificationRequest: {
      _id: new Types.ObjectId(),
      status,
      submittedAt: day(1),
      lastSubmittedAt: day(1),
      ...(revisions ? { revision: revisions.request } : {}),
      breedingStationCertificate: {
        fileName: 'c.pdf',
        fileReference: `ref-${breederId}`,
      },
      reviewedBy: decided ? last.reviewedBy : null,
      reviewedAt: decided ? last.reviewedAt : null,
      rejectionReason: status === 'REJECTED' ? last!.reason : null,
      returnReason: status === 'RETURNED' ? last!.reason : null,
      reviewHistory: history,
    },
  };
}

/** [breederId, stav, historie, očekávaná revize žádosti, očekávané revize historie] */
const CASES: Array<[string, Status, Decision[], number, number[]]> = [
  ['pending', 'PENDING', [], 1, []],
  ['approved', 'APPROVED', ['APPROVED'], 1, [1]],
  ['rejected', 'REJECTED', ['REJECTED'], 1, [1]],
  ['returned', 'RETURNED', ['RETURNED'], 1, [1]],
  ['corrected', 'PENDING', ['RETURNED'], 2, [1]],
  ['returned-twice', 'RETURNED', ['RETURNED', 'RETURNED'], 2, [1, 2]],
  ['corrected-twice', 'PENDING', ['RETURNED', 'RETURNED'], 3, [1, 2]],
  [
    'approved-after-returns',
    'APPROVED',
    ['RETURNED', 'RETURNED', 'APPROVED'],
    3,
    [1, 2, 3],
  ],
  ['rejected-after-return', 'REJECTED', ['RETURNED', 'REJECTED'], 2, [1, 2]],
];

describe(`migrace ${MIGRATION_ID}`, () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let migration: Migration;
  let sequence = 0;

  const breeders = () => connection.db!.collection('breeders');
  const snapshot = () => breeders().find().sort({ breederId: 1 }).toArray();

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    const found = (await loadMigrations()).find(
      (item) => item.id === MIGRATION_ID,
    );
    if (!found) throw new Error(`Migration ${MIGRATION_ID} not found`);
    migration = found;
  });

  beforeEach(async () => {
    connection = await mongoose
      .createConnection(mongo.getUri(), {
        dbName: `anico_breeder_revision_migration_${sequence++}`,
        autoIndex: false,
        autoCreate: false,
      })
      .asPromise();
  });

  afterEach(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  afterAll(async () => {
    await mongo.stop();
  });

  async function seedLegacy() {
    await breeders().insertMany([
      ...CASES.map(([breederId, status, decisions]) =>
        legacy(breederId, status, decisions),
      ),
      { ...legacy('none', 'PENDING', []), verificationRequest: null },
      // už migrovaný dokument se nesmí změnit
      legacy('current', 'PENDING', ['RETURNED', 'RETURNED'], {
        request: 7,
        history: [5, 6],
      }),
    ]);
  }

  it('doplní revize podle historie ve všech stavech a druhý běh nic nezmění', async () => {
    await seedLegacy();
    const untouched = await breeders().findOne({ breederId: 'current' });

    await migration.up(connection);
    const migrated = await snapshot();
    await migration.up(connection);
    expect(await snapshot()).toEqual(migrated);

    for (const [breederId, , decisions, revision, history] of CASES) {
      const request = (await breeders().findOne({ breederId }))
        ?.verificationRequest;
      expect(request?.revision, breederId).toBe(revision);
      expect(
        request?.reviewHistory.map(
          (review: { decision: string; revision: number }) => [
            review.decision,
            review.revision,
          ],
        ),
        breederId,
      ).toEqual(decisions.map((decision, index) => [decision, history[index]]));
      // ostatní pole historie zůstávají
      expect(request?.reviewHistory[0]?.reviewedBy ?? null).toBe(
        decisions.length ? 'admin-1' : null,
      );
    }
    expect(
      (await breeders().findOne({ breederId: 'none' }))?.verificationRequest,
    ).toBeNull();
    expect(await breeders().findOne({ breederId: 'current' })).toEqual(
      untouched,
    );
  });

  it('projde přes migrační engine i na prázdné databázi a opakovaně', async () => {
    const migrations = await loadMigrations();
    expect(await migrateDatabase(connection, migrations)).toContain(
      MIGRATION_ID,
    );
    expect(await migrateDatabase(connection, migrations)).toEqual([]);
    await migration.up(connection);
    expect(await breeders().countDocuments()).toBe(0);
  });

  it('po migraci aplikace načte žádosti a rozhoduje jen o aktuální revizi', async () => {
    await seedLegacy();
    await migrateDatabase(connection, await loadMigrations());
    const repository = mongooseBreederRepository(connection);

    for (const [breederId] of CASES) {
      const breeder = await repository.findByBreederId(breederId);
      VerificationRequestSchema.parse(
        toVerificationRequest(breeder!.verificationRequest!, 'application/pdf'),
      );
    }

    const corrected = await repository.findByBreederId('corrected-twice');
    const requestId = corrected!.verificationRequest!.requestId;
    const decide = (revision: number) =>
      repository.decideVerification(requestId, {
        decision: 'APPROVED',
        revision,
        reviewedBy: 'admin-9',
        reviewedAt: day(20),
      });
    expect(await decide(2)).toBeNull();
    const approved = await decide(3);
    expect(approved?.isVerified).toBe(true);
    expect(
      approved?.verificationRequest?.reviewHistory.map((review) => [
        review.decision,
        review.revision,
      ]),
    ).toEqual([
      ['RETURNED', 1],
      ['RETURNED', 2],
      ['APPROVED', 3],
    ]);

    // vrácená žádost po migraci: oprava zvýší revizi
    const returned = await repository.findByBreederId('returned-twice');
    const resubmitted = await repository.resubmitVerification(
      'returned-twice',
      returned!.verificationRequest!.requestId,
      {
        firstName: 'Jan',
        lastName: 'Novák',
        emailAddress: 'returned-twice@example.test',
        breedingStationName: 'Stanice',
        breedingStationNumber: '1',
        breedingStationCertificate: null,
        currentCertificateReference: 'ref-returned-twice',
      },
    );
    expect(resubmitted?.verificationRequest).toMatchObject({
      status: 'PENDING',
      revision: 3,
    });
  });
});
