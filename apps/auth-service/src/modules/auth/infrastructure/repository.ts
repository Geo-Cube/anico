import { randomUUID } from 'node:crypto';
import type { Connection } from 'mongoose';
import { initialRoles } from '../domain/auth.js';
import type {
  AuthRepository,
  User,
  Session,
  LoginAttempt,
} from '../domain/auth.js';

export function mongoAuthRepository(connection: Connection): AuthRepository {
  const db = connection.db!;
  const users = db.collection<
    User & {
      _id: string;
      issuer?: string;
      subject?: string;
      roleAudit?: Array<{ actorId: string; admin: boolean; at: Date }>;
    }
  >('users');
  const sessions = db.collection<Session & { _id: string }>('sessions');
  const attempts = db.collection<LoginAttempt & { _id: string }>(
    'login_attempts',
  );
  return {
    async register(identity) {
      const { issuer, subject, ...profile } = identity;
      const userId = randomUUID();
      try {
        await users.updateOne(
          { issuer, subject },
          {
            $setOnInsert: {
              _id: userId,
              userId,
              issuer,
              subject,
              ...profile,
              roles: initialRoles(),
              status: 'active',
              registration: {
                id: randomUUID(),
                type: 'user.registered',
                status: 'pending',
                createdAt: new Date(),
              },
            },
          },
          { upsert: true },
        );
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 11000
        ))
          throw error;
      }
      const user = await users.findOne({ issuer, subject });
      if (!user) throw new Error('Registration failed');
      return user;
    },
    user: (userId) => users.findOne({ userId }),
    async createSession(hash, session) {
      await sessions.insertOne({ _id: hash, ...session });
    },
    session: (hash, now) =>
      sessions.findOne({ _id: hash, expiresAt: { $gt: now } }),
    async revoke(hash) {
      await sessions.deleteOne({ _id: hash });
    },
    async saveAttempt(hash, attempt) {
      await attempts.insertOne({ _id: hash, ...attempt });
    },
    consumeAttempt: (hash, browserHash, now) =>
      attempts.findOneAndDelete({
        _id: hash,
        browserHash,
        expiresAt: { $gt: now },
      }),
    async setAdmin(actorId, userId, admin) {
      // Role change and its audit entry are one atomic document update.
      return users.findOneAndUpdate(
        {
          userId,
          status: 'active',
          roles: { $ne: 'owner' },
          fixture: { $ne: true },
        },
        {
          ...(admin
            ? { $addToSet: { roles: 'admin' as const } }
            : { $pull: { roles: 'admin' as const } }),
          $push: { roleAudit: { actorId, admin, at: new Date() } },
        },
        { returnDocument: 'after' },
      );
    },
  };
}
