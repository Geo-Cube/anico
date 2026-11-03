import { z } from 'zod';

// Frozen v1 contract: historical migrations must not depend on mutable models.
const eventSchema = z.strictObject({
  eventId: z.uuid(),
  type: z.literal('user.registered'),
  schemaVersion: z.literal(1),
  producer: z.literal('auth-service'),
  occurredAt: z.iso.datetime(),
  data: z.strictObject({
    userId: z.uuid(),
    givenName: z.string().max(200).nullable(),
    familyName: z.string().max(200).nullable(),
    email: z.email().nullable(),
  }),
});

/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const users = connection.db.collection('users');
  for await (const user of users.find({
    fixture: { $ne: true },
    'registration.status': 'pending',
    'registration.event': { $exists: false },
  })) {
    let event;
    try {
      event = eventSchema.parse({
        eventId: user.registration.id,
        type: 'user.registered',
        schemaVersion: 1,
        producer: 'auth-service',
        occurredAt: user.registration.createdAt.toISOString(),
        data: {
          userId: user.userId,
          givenName: user.givenName,
          familyName: user.familyName,
          email: user.email,
        },
      });
    } catch {
      throw new Error('Invalid legacy registration; private values hidden');
    }
    await users.updateOne(
      {
        _id: user._id,
        'registration.id': event.eventId,
        'registration.status': 'pending',
        'registration.event': { $exists: false },
      },
      { $set: { 'registration.event': event } },
    );
  }
  await users.createIndex(
    { 'registration.event.eventId': 1 },
    {
      unique: true,
      name: 'unique_registration_event',
      partialFilterExpression: {
        'registration.event.eventId': { $type: 'string' },
      },
    },
  );
  await users.createIndex(
    { 'registration.status': 1, 'registration.createdAt': 1 },
    { name: 'registration_outbox_pending' },
  );
}
