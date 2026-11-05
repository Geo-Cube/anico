import { randomUUID } from 'node:crypto';
import { UserRegisteredEventSchema } from '@anico/shared-schemas';
import type { Connection } from 'mongoose';
import { AuthError, initialRoles } from '../domain/auth.js';
import type {
  AuthRepository,
  User,
  Session,
  LoginAttempt,
  Provider,
} from '../domain/auth.js';

export function mongoAuthRepository(connection: Connection): AuthRepository {
  const db = connection.db!;
  const users = db.collection<
    User & {
      _id: string;
      issuer?: string;
      subject?: string;
      provider?: Provider;
      identities?: Array<{
        provider: Provider;
        issuer: string;
        subject: string;
      }>;
      identityAudit?: Array<{ action: string; provider: Provider; at: Date }>;
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
      const filter = {
        $or: [
          { issuer, subject },
          { identities: { $elemMatch: { issuer, subject } } },
        ],
      };
      const userId = randomUUID();
      const createdAt = new Date();
      const event = UserRegisteredEventSchema.parse({
        eventId: randomUUID(),
        type: 'user.registered',
        schemaVersion: 1,
        producer: 'auth-service',
        occurredAt: createdAt.toISOString(),
        data: {
          userId,
          givenName: identity.givenName,
          familyName: identity.familyName,
          email: identity.email,
        },
      });
      try {
        await users.updateOne(
          filter,
          {
            $setOnInsert: {
              _id: userId,
              userId,
              issuer,
              subject,
              identities: [{ provider: identity.provider, issuer, subject }],
              ...profile,
              roles: initialRoles(),
              status: 'active',
              registration: {
                id: event.eventId,
                type: 'user.registered',
                status: 'pending',
                createdAt,
                event,
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
      const user = await users.findOne(filter);
      if (!user) throw new Error('Registration failed');
      return user;
    },
    user: (userId) => users.findOne({ userId }),
    async linkedProviders(userId) {
      const user = await users.findOne({ userId });
      return [
        ...new Set(
          user?.identities?.map((identity) => identity.provider) ??
            (user?.provider ? [user.provider] : []),
        ),
      ];
    },
    async linkIdentity(userId, identity) {
      const { provider, issuer, subject } = identity;
      try {
        const user = await users.findOneAndUpdate(
          {
            userId,
            status: 'active',
            fixture: { $ne: true },
            identities: { $not: { $elemMatch: { provider } } },
          },
          {
            $addToSet: { identities: { provider, issuer, subject } },
            $push: {
              identityAudit: {
                action: 'link-provider',
                provider,
                at: new Date(),
              },
            },
          },
          { returnDocument: 'after' },
        );
        if (user) return user;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 11000
        )
          throw new AuthError(409, 'IDENTITY_ALREADY_LINKED');
        throw error;
      }
      const current = await users.findOne({
        userId,
        status: 'active',
        fixture: { $ne: true },
      });
      if (!current) throw new AuthError(401, 'ACCOUNT_DISABLED');
      if (
        current.identities?.some(
          (item) => item.issuer === issuer && item.subject === subject,
        )
      )
        return current;
      throw new AuthError(409, 'PROVIDER_ALREADY_CONNECTED');
    },
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
