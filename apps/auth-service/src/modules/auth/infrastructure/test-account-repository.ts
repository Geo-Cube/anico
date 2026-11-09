import type { Connection } from 'mongoose';
import type { User } from '../domain/auth.js';
import type { TestAccountRepository } from '../domain/test-accounts.js';
import { registrationRecord } from './repository.js';

export function mongoTestAccountRepository(
  connection: Connection,
): TestAccountRepository {
  const users = connection.db!.collection<User & { _id: string }>('users');
  return {
    async create(account) {
      const { createdBy, createdAt, ...identity } = account;
      const user: User & { _id: string } = {
        _id: account.userId,
        ...identity,
        status: 'active',
        testAccount: { createdBy, createdAt },
        // Same durable registration record as a real first login.
        registration: registrationRecord(account.userId, identity, createdAt),
      };
      await users.insertOne(user);
      return user;
    },
    list: (limit) =>
      users
        .find({ testAccount: { $exists: true }, status: 'active' })
        .sort({ 'testAccount.createdAt': -1 })
        .limit(limit)
        .toArray(),
  };
}
