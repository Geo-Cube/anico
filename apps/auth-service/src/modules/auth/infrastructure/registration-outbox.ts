import type { Connection } from 'mongoose';
import type {
  RegistrationClaim,
  RegistrationOutbox,
} from '../domain/registration-outbox.js';

export function mongoRegistrationOutbox(
  connection: Connection,
): RegistrationOutbox {
  const users = connection.db!.collection('users');
  const filter = (claim: RegistrationClaim) => ({
    userId: claim.userId,
    'registration.id': claim.eventId,
    'registration.status': 'pending',
    'registration.delivery.lockToken': claim.lockToken,
  });
  const unlock = {
    'registration.delivery.lockToken': '',
    'registration.delivery.lockedUntil': '',
  };
  return {
    async claim(now, leaseUntil, lockToken) {
      const user = await users.findOneAndUpdate(
        {
          fixture: { $ne: true },
          'registration.status': 'pending',
          'registration.event': { $exists: true },
          $and: [
            {
              $or: [
                { 'registration.delivery.nextAttemptAt': { $exists: false } },
                { 'registration.delivery.nextAttemptAt': { $lte: now } },
              ],
            },
            {
              $or: [
                { 'registration.delivery.lockedUntil': { $exists: false } },
                { 'registration.delivery.lockedUntil': { $lte: now } },
              ],
            },
          ],
        },
        {
          $set: {
            'registration.delivery.lockToken': lockToken,
            'registration.delivery.lockedUntil': leaseUntil,
          },
          $inc: { 'registration.delivery.attempts': 1 },
        },
        { sort: { 'registration.createdAt': 1 }, returnDocument: 'after' },
      );
      return user
        ? {
            userId: user.userId,
            eventId: user.registration.id,
            lockToken,
            attempts: user.registration.delivery.attempts,
            event: user.registration.event,
          }
        : null;
    },
    async published(claim, now) {
      const result = await users.updateOne(filter(claim), {
        $set: {
          'registration.status': 'published',
          'registration.delivery.publishedAt': now,
        },
        $unset: {
          ...unlock,
          'registration.delivery.nextAttemptAt': '',
          'registration.delivery.lastError': '',
        },
      });
      return result.modifiedCount === 1;
    },
    async retry(claim, nextAttemptAt) {
      await users.updateOne(filter(claim), {
        $set: {
          'registration.delivery.nextAttemptAt': nextAttemptAt,
          'registration.delivery.lastError': 'publish_failed',
        },
        $unset: unlock,
      });
    },
    async invalid(claim) {
      await users.updateOne(filter(claim), {
        $set: {
          'registration.status': 'failed',
          'registration.delivery.lastError': 'invalid_event',
        },
        $unset: unlock,
      });
    },
  };
}
