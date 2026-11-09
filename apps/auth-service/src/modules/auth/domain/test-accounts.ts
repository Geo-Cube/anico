import type { Role } from '@anico/shared-schemas';
import type { User } from './auth.js';

/** Dev-only accounts without a provider identity; reachable only by switching. */
export interface NewTestAccount {
  userId: string;
  givenName: string;
  familyName: string;
  email: string;
  roles: Role[];
  createdBy: string;
  createdAt: Date;
}
export interface TestAccountRepository {
  create(account: NewTestAccount): Promise<User>;
  /** Newest first. */
  list(limit: number): Promise<User[]>;
}
export const TEST_ACCOUNT_LIST_LIMIT = 200;
