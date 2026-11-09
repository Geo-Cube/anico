import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mongooseBreederRepository } from '../../src/modules/breeders/infrastructure/mongoose-breeder-repository.js';
import type { BreederRepository } from '../../src/modules/breeders/domain/ports.js';

let mongo: MongoMemoryServer;
let connection: Connection;
let repository: BreederRepository;
beforeAll(async () => {
  mongo = await startTestMongo(new MongoMemoryServer());
  connection = await mongoose.createConnection(mongo.getUri()).asPromise();
  repository = mongooseBreederRepository(connection);
});
beforeEach(async () => {
  await connection.db!.collection('breeders').deleteMany({});
  await repository.provision({
    breederId: 'b1',
    firstName: 'Jan',
    lastName: 'Novák',
    emailAddress: 'jan@example.test',
  });
});
afterAll(async () => {
  await connection?.close();
  await mongo?.stop();
});

describe('atomic profile update', () => {
  const submission = {
    firstName: 'Podané',
    lastName: 'Jméno',
    emailAddress: 'submitted@example.test',
    breedingStationName: 'Stanice',
    breedingStationNumber: '1',
    breedingStationCertificate: { fileName: 'c.pdf', fileReference: 'file1' },
  };
  it('updates only requested fields and never overwrites a submitted profile', async () => {
    const updated = await repository.updateProfile('b1', { firstName: 'Eva' });
    expect(updated).toMatchObject({
      firstName: 'Eva',
      lastName: 'Novák',
      verificationRequest: null,
    });
    await repository.submitVerification('b1', submission);
    const before = await repository.findByBreederId('b1');
    expect(
      await repository.updateProfile('b1', { firstName: 'Neplatné' }),
    ).toBeNull();
    expect(await repository.findByBreederId('b1')).toEqual(before);
  });
  it('keeps submitted data when profile edit races with submission', async () => {
    await Promise.all([
      repository.updateProfile('b1', { firstName: 'Editace' }),
      repository.submitVerification('b1', submission),
    ]);
    expect(await repository.findByBreederId('b1')).toMatchObject({
      firstName: 'Podané',
      lastName: 'Jméno',
      verificationRequest: { status: 'PENDING' },
    });
  });
});
