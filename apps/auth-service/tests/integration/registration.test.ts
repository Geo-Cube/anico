import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo } from '../../../../scripts/start-test-mongo.mjs';
import mongoose, { type Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { UserRegisteredEventSchema } from '@anico/shared-schemas';
import { mongoAuthRepository } from '../../src/modules/auth/infrastructure/repository.js';
import { migrateDatabase } from '../../src/database/engine.js';
import { loadMigrations } from '../../src/database/registry.js';

const external = {
  provider: 'google' as const,
  issuer: 'https://accounts.google.com',
  subject: 'registration-test',
  givenName: 'Example',
  familyName: null,
  email: null,
};

describe('versioned registration outbox', () => {
  let mongo: MongoMemoryServer, connection: Connection;
  beforeAll(async () => {
    mongo = await startTestMongo(new MongoMemoryServer());
    connection = await mongoose
      .createConnection(mongo.getUri('registration_test'))
      .asPromise();
  });
  beforeEach(async () => {
    await connection.dropDatabase();
    await migrateDatabase(connection, await loadMigrations());
  });
  afterAll(async () => {
    await connection?.close();
    await mongo?.stop();
  });

  it('creates one stable event with the account under concurrent/repeated logins', async () => {
    const repository = mongoAuthRepository(connection);
    const logins = await Promise.all(
      Array.from({ length: 8 }, () => repository.register(external)),
    );
    const first = logins[0]!;
    expect(new Set(logins.map((user) => user.userId)).size).toBe(1);
    expect(await connection.db!.collection('users').countDocuments()).toBe(1);
    const event = UserRegisteredEventSchema.parse(first.registration?.event);
    expect(event.eventId).toBe(first.registration?.id);
    expect(event.occurredAt).toBe(first.registration?.createdAt.toISOString());
    expect(event.data).toEqual({
      userId: first.userId,
      givenName: 'Example',
      familyName: null,
      email: null,
    });
    expect(first.roles).toEqual(['breeder']);
    expect(first.registration?.status).toBe('pending');
    await repository.setAdmin(randomUUID(), first.userId, true);
    const again = await repository.register({
      ...external,
      givenName: 'Later name',
    });
    expect(again.registration).toEqual(first.registration);
    expect(again.roles).toContain('admin');
    expect(JSON.stringify(event)).not.toMatch(
      /roles|issuer|subject|provider|token|secret/,
    );
  });

  it('backfills legacy pending registrations once while preserving identity, roles and metadata', async () => {
    const users = connection.db!.collection('users');
    const legacyId = randomUUID(),
      eventId = randomUUID(),
      createdAt = new Date('2026-11-01T12:00:00Z');
    await users.insertOne({
      userId: legacyId,
      givenName: null,
      familyName: null,
      email: null,
      roles: ['breeder', 'owner'],
      status: 'active',
      registration: {
        id: eventId,
        type: 'user.registered',
        status: 'pending',
        createdAt,
      },
    });
    await users.insertOne({
      userId: randomUUID(),
      fixture: true,
      registration: { status: 'pending' },
    });
    await users.insertOne({
      userId: randomUUID(),
      registration: { status: 'published' },
    });
    const migration = (await loadMigrations()).find((m) =>
      m.id.endsWith('-registration-event-contract'),
    )!;
    await migration.up(connection);
    const first = await users.findOne({ userId: legacyId });
    const event = UserRegisteredEventSchema.parse(first?.registration.event);
    expect(event.eventId).toBe(eventId);
    expect(event.occurredAt).toBe(createdAt.toISOString());
    expect(event.data.userId).toBe(legacyId);
    expect(first?.roles).toEqual(['breeder', 'owner']);
    await migration.up(connection);
    expect(await users.findOne({ userId: legacyId })).toEqual(first);
    expect(
      await users.countDocuments({ 'registration.event': { $exists: true } }),
    ).toBe(1);
  });

  it('rejects unsupported versions and credentials or roles in the event contract', async () => {
    const user = await mongoAuthRepository(connection).register(external);
    const event = UserRegisteredEventSchema.parse(user.registration?.event);
    expect(
      UserRegisteredEventSchema.safeParse({ ...event, schemaVersion: 2 })
        .success,
    ).toBe(false);
    expect(
      UserRegisteredEventSchema.safeParse({
        ...event,
        accessToken: 'test-only',
      }).success,
    ).toBe(false);
    expect(
      UserRegisteredEventSchema.safeParse({
        ...event,
        data: { ...event.data, roles: ['owner'] },
      }).success,
    ).toBe(false);
    expect(
      UserRegisteredEventSchema.safeParse({
        ...event,
        data: { ...event.data, email: 'invalid' },
      }).success,
    ).toBe(false);
  });
});
