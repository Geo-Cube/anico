import { VerificationRequestSchema } from '@anico/shared-schemas';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
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

const MIGRATION_ID = '20261105110409-verification-return-history';
const QUEUE_INDEX =
  'verificationRequest.status_1_verificationRequest.lastSubmittedAt_1';
const REPLACED_INDEX =
  'verificationRequest.status_1_verificationRequest.submittedAt_1';

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

/** Dokument ve tvaru před zavedením vrácení k doplnění. */
function legacy(
  breederId: string,
  request: {
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    submittedAt: Date;
    reviewedBy?: string;
    reviewedAt?: Date;
    rejectionReason?: string;
  } | null,
) {
  return {
    breederId,
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: `${breederId}@example.test`,
    breedingStationName: request ? 'Stanice' : null,
    breedingStationNumber: request ? '1' : null,
    isVerified: request?.status === 'APPROVED',
    verificationRequest: request && {
      _id: new Types.ObjectId(),
      status: request.status,
      submittedAt: request.submittedAt,
      breedingStationCertificate: {
        fileName: 'c.pdf',
        fileReference: `ref-${breederId}`,
      },
      reviewedBy: request.reviewedBy ?? null,
      reviewedAt: request.reviewedAt ?? null,
      rejectionReason: request.rejectionReason ?? null,
    },
  };
}

describe('migrace 20261105110409-verification-return-history', () => {
  let mongo: MongoMemoryServer;
  let connection: Connection;
  let migration: Migration;
  let sequence = 0;

  const breeders = () => connection.db!.collection('breeders');
  const request = async (breederId: string) =>
    (await breeders().findOne({ breederId }))?.verificationRequest;

  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    const found = (await loadMigrations()).find(
      (item) => item.id === MIGRATION_ID,
    );
    if (!found) throw new Error(`Migration ${MIGRATION_ID} not found`);
    migration = found;
  });

  beforeEach(async () => {
    connection = await mongoose
      .createConnection(mongo.getUri(), {
        dbName: `anico_breeder_migration_${sequence++}`,
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
      legacy('pending', { status: 'PENDING', submittedAt: day(3) }),
      legacy('approved', {
        status: 'APPROVED',
        submittedAt: day(1),
        reviewedBy: 'admin-1',
        reviewedAt: day(2),
      }),
      legacy('rejected', {
        status: 'REJECTED',
        submittedAt: day(2),
        reviewedBy: 'admin-2',
        reviewedAt: day(4),
        rejectionReason: 'Nečitelné',
      }),
      legacy('none', null),
    ]);
    await breeders().createIndex({
      'verificationRequest.status': 1,
      'verificationRequest.submittedAt': 1,
    });
  }

  it('doplní nová pole podle stavu a je idempotentní (2× běh beze změny)', async () => {
    await seedLegacy();
    // dokument už v novém tvaru se nesmí změnit
    const current = legacy('current', {
      status: 'PENDING',
      submittedAt: day(1),
    });
    await breeders().insertOne({
      ...current,
      verificationRequest: {
        ...current.verificationRequest!,
        status: 'RETURNED',
        lastSubmittedAt: day(5),
        reviewedBy: 'admin-3',
        reviewedAt: day(6),
        returnReason: 'Doplňte',
        reviewHistory: [
          {
            decision: 'RETURNED',
            reviewedBy: 'admin-3',
            reviewedAt: day(6),
            reason: 'Doplňte',
          },
        ],
      },
    });
    const untouched = await breeders().findOne({ breederId: 'current' });

    await migration.up(connection);
    const once = await breeders().find().sort({ breederId: 1 }).toArray();
    await migration.up(connection);
    expect(await breeders().find().sort({ breederId: 1 }).toArray()).toEqual(
      once,
    );

    expect(await request('pending')).toMatchObject({
      status: 'PENDING',
      lastSubmittedAt: day(3),
      returnReason: null,
      reviewHistory: [],
    });
    expect(await request('approved')).toMatchObject({
      lastSubmittedAt: day(1),
      returnReason: null,
      reviewHistory: [
        {
          decision: 'APPROVED',
          reviewedBy: 'admin-1',
          reviewedAt: day(2),
          reason: null,
        },
      ],
    });
    expect(await request('rejected')).toMatchObject({
      lastSubmittedAt: day(2),
      returnReason: null,
      rejectionReason: 'Nečitelné',
      reviewHistory: [
        {
          decision: 'REJECTED',
          reviewedBy: 'admin-2',
          reviewedAt: day(4),
          reason: 'Nečitelné',
        },
      ],
    });
    expect(await request('none')).toBeNull();
    expect(await breeders().findOne({ breederId: 'current' })).toEqual(
      untouched,
    );

    const indexes = (await breeders().indexes()).map((index) => index.name);
    expect(indexes).toContain(QUEUE_INDEX);
    expect(indexes).not.toContain(REPLACED_INDEX);
  });

  it('projde přes migrační engine i na prázdné databázi a opakovaně', async () => {
    const migrations = await loadMigrations();
    expect(await migrateDatabase(connection, migrations)).toContain(
      MIGRATION_ID,
    );
    expect(await migrateDatabase(connection, migrations)).toEqual([]);
    await migration.up(connection);
    expect((await breeders().indexes()).map((index) => index.name)).toContain(
      QUEUE_INDEX,
    );
  });

  it('po migraci aplikace načte staré žádosti, fronta je řazená podle lastSubmittedAt a index sedí se schématem', async () => {
    await seedLegacy();
    await migrateDatabase(connection, await loadMigrations());
    const repository = mongooseBreederRepository(connection);
    // model.init() nesmí kolidovat s indexem vytvořeným migrací
    await Promise.all(
      Object.values(connection.models).map((model) => model.init()),
    );

    for (const breederId of ['pending', 'approved', 'rejected']) {
      const breeder = await repository.findByBreederId(breederId);
      VerificationRequestSchema.parse(
        toVerificationRequest(breeder!.verificationRequest!, 'application/pdf'),
      );
    }
    expect(
      (await repository.listByVerificationStatus('PENDING')).map(
        (breeder) => breeder.breederId,
      ),
    ).toEqual(['pending']);
    expect(await repository.countByVerificationStatus()).toEqual({
      PENDING: 1,
      RETURNED: 0,
      APPROVED: 1,
      REJECTED: 1,
    });

    // stará PENDING žádost jde po migraci vrátit a historie navazuje
    const pending = await repository.findByBreederId('pending');
    const returned = await repository.decideVerification(
      pending!.verificationRequest!.requestId,
      {
        decision: 'RETURNED',
        revision: 1,
        returnReason: 'Doplňte',
        reviewedBy: 'admin-1',
        reviewedAt: day(10),
      },
    );
    expect(returned?.verificationRequest?.reviewHistory).toEqual([
      {
        decision: 'RETURNED',
        revision: 1,
        reviewedBy: 'admin-1',
        reviewedAt: day(10),
        reason: 'Doplňte',
      },
    ]);
  });
});
