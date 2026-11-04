import { describe, it, expect } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createConnection, mongo } from 'mongoose';
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
});
