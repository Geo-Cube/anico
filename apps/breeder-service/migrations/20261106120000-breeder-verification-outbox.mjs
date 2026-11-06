import { randomUUID } from 'node:crypto';

/** @param {import('mongoose').Connection} connection */
export async function up(connection) {
  const breeders = connection.db.collection('breeders');
  await breeders.createIndex(
    {
      'verificationEvent.status': 1,
      'verificationEvent.delivery.nextAttemptAt': 1,
      'verificationEvent.delivery.lockedUntil': 1,
      'verificationEvent.createdAt': 1,
    },
    { name: 'verification_event_claim' },
  );
  const filter = {
    isVerified: true,
    fixture: { $ne: true },
    'verificationRequest.status': 'APPROVED',
    'verificationRequest.reviewedAt': { $type: 'date' },
    verificationEvent: { $exists: false },
  };
  for await (const breeder of breeders.find(filter)) {
    const eventId = randomUUID();
    const verifiedAt = breeder.verificationRequest.reviewedAt;
    await breeders.updateOne(
      { _id: breeder._id, ...filter },
      {
        $set: {
          verificationEvent: {
            id: eventId,
            status: 'pending',
            createdAt: verifiedAt,
            delivery: { attempts: 0 },
            event: {
              eventId,
              type: 'breeder.verified',
              schemaVersion: 1,
              producer: 'breeder-service',
              occurredAt: verifiedAt.toISOString(),
              data: {
                breederId: breeder.breederId,
                verifiedAt: verifiedAt.toISOString(),
              },
            },
          },
        },
      },
    );
  }
}
