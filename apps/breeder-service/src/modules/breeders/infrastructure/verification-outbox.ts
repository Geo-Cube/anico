import type { Connection } from 'mongoose';
import type {
  VerificationClaim,
  VerificationOutbox,
} from '../domain/verification-outbox.js';

export function mongoVerificationOutbox(
  connection: Connection,
): VerificationOutbox {
  const breeders = connection.db!.collection('breeders');
  const filter = (claim: VerificationClaim) => ({
    breederId: claim.breederId,
    'verificationEvent.id': claim.eventId,
    'verificationEvent.status': 'pending',
    'verificationEvent.delivery.lockToken': claim.lockToken,
  });
  const unlock = {
    'verificationEvent.delivery.lockToken': '',
    'verificationEvent.delivery.lockedUntil': '',
  };
  return {
    async claim(now, leaseUntil, lockToken) {
      const breeder = await breeders.findOneAndUpdate(
        {
          fixture: { $ne: true },
          'verificationEvent.status': 'pending',
          'verificationEvent.event': { $exists: true },
          $and: [
            {
              $or: [
                {
                  'verificationEvent.delivery.nextAttemptAt': {
                    $exists: false,
                  },
                },
                { 'verificationEvent.delivery.nextAttemptAt': { $lte: now } },
              ],
            },
            {
              $or: [
                {
                  'verificationEvent.delivery.lockedUntil': { $exists: false },
                },
                { 'verificationEvent.delivery.lockedUntil': { $lte: now } },
              ],
            },
          ],
        },
        {
          $set: {
            'verificationEvent.delivery.lockToken': lockToken,
            'verificationEvent.delivery.lockedUntil': leaseUntil,
          },
          $inc: { 'verificationEvent.delivery.attempts': 1 },
        },
        { sort: { 'verificationEvent.createdAt': 1 }, returnDocument: 'after' },
      );
      return breeder
        ? {
            breederId: breeder.breederId,
            eventId: breeder.verificationEvent.id,
            lockToken,
            attempts: breeder.verificationEvent.delivery.attempts,
            event: breeder.verificationEvent.event,
          }
        : null;
    },
    async published(claim, now) {
      const result = await breeders.updateOne(filter(claim), {
        $set: {
          'verificationEvent.status': 'published',
          'verificationEvent.delivery.publishedAt': now,
        },
        $unset: {
          ...unlock,
          'verificationEvent.delivery.nextAttemptAt': '',
          'verificationEvent.delivery.lastError': '',
        },
      });
      return result.modifiedCount === 1;
    },
    async retry(claim, nextAttemptAt) {
      await breeders.updateOne(filter(claim), {
        $set: {
          'verificationEvent.delivery.nextAttemptAt': nextAttemptAt,
          'verificationEvent.delivery.lastError': 'publish_failed',
        },
        $unset: unlock,
      });
    },
    async invalid(claim) {
      await breeders.updateOne(filter(claim), {
        $set: {
          'verificationEvent.status': 'failed',
          'verificationEvent.delivery.lastError': 'invalid_event',
        },
        $unset: unlock,
      });
    },
  };
}
