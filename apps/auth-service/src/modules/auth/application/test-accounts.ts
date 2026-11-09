import { randomBytes, randomUUID } from 'node:crypto';
import type {
  CreateTestAccountInput,
  Identity,
  Role,
  TestAccount,
  TestAccountActor,
} from '@anico/shared-schemas';
import { AuthError, type AuthRepository, type User } from '../domain/auth.js';
import {
  TEST_ACCOUNT_LIST_LIMIT,
  type TestAccountRepository,
} from '../domain/test-accounts.js';
import {
  equalSecret,
  hash,
  publicIdentity,
  type AuthenticatedSession,
  type AuthService,
} from './auth.js';

const random = () => randomBytes(32).toString('base64url');
const canAdminister = (identity: Identity) =>
  identity.roles.includes('admin') || identity.roles.includes('owner');

/**
 * Dev-only switching into test accounts. The acting admin/owner keeps their own
 * session; the test session only stores its hash, so returning never mints a new
 * privileged session. `auth.authenticate` re-checks the actor on every use.
 */
export function createTestAccountService(options: {
  auth: AuthService;
  users: Pick<AuthRepository, 'user' | 'createSession' | 'revoke'>;
  repository: TestAccountRepository;
  sessionSeconds: number;
  now?: () => Date;
}) {
  const { auth, users, repository } = options;
  const now = options.now ?? (() => new Date());

  async function requireActor(token: string | undefined) {
    const current = await auth.authenticate(token);
    const actor = current.actor ?? {
      identity: current.user,
      session: current.session,
    };
    if (!canAdminister(actor.identity))
      throw new AuthError(403, 'TEST_ACCOUNTS_FORBIDDEN');
    return { current, actor };
  }
  const toView = (user: User): TestAccount => ({
    identity: publicIdentity(user),
    createdAt: user.testAccount!.createdAt.toISOString(),
    createdBy: user.testAccount!.createdBy,
  });

  return {
    /** Extra /session fields for an already authenticated session. */
    describe(current: AuthenticatedSession): {
      canUseTestAccounts: boolean;
      testAccountActor?: TestAccountActor;
    } {
      const actor = current.actor?.identity;
      return {
        canUseTestAccounts: canAdminister(actor ?? current.user),
        ...(actor
          ? {
              testAccountActor: {
                userId: actor.userId,
                givenName: actor.givenName,
                familyName: actor.familyName,
              },
            }
          : {}),
      };
    },
    async list(token: string | undefined) {
      await requireActor(token);
      return (await repository.list(TEST_ACCOUNT_LIST_LIMIT)).map(toView);
    },
    async create(token: string | undefined, input: CreateTestAccountInput) {
      const { actor } = await requireActor(token);
      if (input.admin && !actor.identity.roles.includes('owner'))
        throw new AuthError(403, 'OWNER_REQUIRED');
      const userId = randomUUID();
      const roles: Role[] = input.admin ? ['breeder', 'admin'] : ['breeder'];
      return toView(
        await repository.create({
          userId,
          givenName: input.givenName,
          familyName: input.familyName,
          email: input.email ?? `tester-${userId.slice(0, 8)}@anico.test`,
          roles,
          createdBy: actor.identity.userId,
          createdAt: now(),
        }),
      );
    },
    /**
     * Opens a session of the test account. `returnSession` is set only when the
     * actor leaves their own session; switching between test accounts keeps it.
     */
    async switchTo(token: string | undefined, targetUserId: string) {
      const { current, actor } = await requireActor(token);
      const target = await users.user(targetUserId);
      if (!target?.testAccount || target.status !== 'active')
        throw new AuthError(404, 'TEST_ACCOUNT_NOT_FOUND');
      const returnSessionHash =
        current.session.testAccount?.returnSessionHash ?? hash(token!);
      const next = random();
      const expiresAt = new Date(
        Math.min(
          now().getTime() + options.sessionSeconds * 1000,
          actor.session.expiresAt.getTime(),
        ),
      );
      await users.createSession(hash(next), {
        userId: target.userId,
        csrfToken: random(),
        expiresAt,
        // No authenticatedAt: account linking requires a fresh real login.
        testAccount: { actorUserId: actor.identity.userId, returnSessionHash },
      });
      if (current.session.testAccount) await users.revoke(hash(token!));
      return {
        token: next,
        expiresAt,
        returnSession: current.session.testAccount
          ? undefined
          : { token: token!, expiresAt: actor.session.expiresAt },
      };
    },
    async returnToOwn(
      token: string | undefined,
      returnToken: string | undefined,
    ) {
      const current = await auth.authenticate(token);
      const link = current.session.testAccount;
      if (!link) throw new AuthError(409, 'NOT_IN_TEST_ACCOUNT');
      if (
        !returnToken ||
        !equalSecret(hash(returnToken), link.returnSessionHash)
      )
        throw new AuthError(401, 'RETURN_SESSION_MISMATCH');
      const own = await auth.authenticate(returnToken);
      await users.revoke(hash(token!));
      return { token: returnToken, expiresAt: own.session.expiresAt };
    },
    /** Logout from a test account also ends the actor's own session. */
    async endActorSession(session: AuthenticatedSession['session']) {
      if (session.testAccount)
        await users.revoke(session.testAccount.returnSessionHash);
    },
  };
}
export type TestAccountService = ReturnType<typeof createTestAccountService>;
