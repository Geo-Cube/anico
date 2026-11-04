import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isSafeReturnPath, type Identity } from '@anico/shared-schemas';
import {
  AuthError,
  type AuthRepository,
  type Provider,
  type ProviderClient,
  type LoginAttempt,
} from '../domain/auth.js';
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
export function equalSecret(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function publicIdentity(user: Identity): Identity {
  return {
    userId: user.userId,
    givenName: user.givenName,
    familyName: user.familyName,
    email: user.email,
    roles: [...user.roles],
  };
}
export function createAuthService(options: {
  repository: AuthRepository;
  providers: Partial<Record<Provider, ProviderClient>>;
  publicOrigin: string;
  sessionSeconds: number;
  now?: () => Date;
}) {
  const { repository, providers } = options;
  const now = options.now ?? (() => new Date());
  async function authenticate(token: string | undefined) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new AuthError(401, 'AUTHENTICATION_REQUIRED');
    const session = await repository.session(hash(token), now());
    if (!session) throw new AuthError(401, 'SESSION_EXPIRED');
    const user = await repository.user(session.userId);
    if (!user || user.status !== 'active' || user.fixture)
      throw new AuthError(401, 'ACCOUNT_DISABLED');
    return { user: publicIdentity(user), session };
  }
  function requireRecentLogin(session: { authenticatedAt?: Date }) {
    const age = session.authenticatedAt
      ? now().getTime() - session.authenticatedAt.getTime()
      : Infinity;
    if (age < 0 || age > 300000)
      throw new AuthError(401, 'RECENT_LOGIN_REQUIRED');
  }
  async function begin(
    provider: Provider,
    link?: LoginAttempt['link'],
    returnTo?: string,
  ) {
    if (
      returnTo !== undefined &&
      !isSafeReturnPath(returnTo) &&
      !/^\/api\/auth\/development\/consent\?request=[A-Za-z0-9_-]{43}$/.test(
        returnTo,
      )
    )
      throw new AuthError(400, 'INVALID_LOGIN_RETURN');
    const client = providers[provider];
    if (!client) throw new AuthError(503, 'PROVIDER_NOT_CONFIGURED');
    const state = random(),
      nonce = random(),
      verifier = random(),
      browser = random();
    const callback = `${options.publicOrigin}/api/auth/login/${provider}/callback`;
    const url = await client.authorize({
      state,
      nonce,
      verifier,
      callback,
      ...(link || returnTo ? { prompt: 'select_account' as const } : {}),
    });
    await repository.saveAttempt(hash(state), {
      provider,
      state,
      nonce,
      verifier,
      browserHash: hash(browser),
      expiresAt: new Date(now().getTime() + 600000),
      ...(link ? { link } : {}),
      ...(returnTo ? { returnTo } : {}),
    });
    return { url, browser };
  }
  async function finish(
    client: ProviderClient,
    attempt: LoginAttempt,
    response: URL | Request,
    currentToken: string | undefined,
  ) {
    const { provider } = attempt;
    if (attempt.link) {
      if (
        !currentToken ||
        !equalSecret(hash(currentToken), attempt.link.sessionHash)
      )
        throw new AuthError(401, 'LINK_SESSION_MISMATCH');
      const current = await authenticate(currentToken);
      if (current.user.userId !== attempt.link.userId)
        throw new AuthError(401, 'LINK_SESSION_MISMATCH');
      requireRecentLogin(current.session);
    }
    const identity = await client.exchange({
      ...attempt,
      callback: `${options.publicOrigin}/api/auth/login/${provider}/callback`,
      response,
    });
    if (identity.provider !== provider)
      throw new AuthError(401, 'INVALID_PROVIDER');
    // Never merge accounts by email or move an identity owned by another user.
    if (attempt.link) {
      const current = await authenticate(currentToken);
      requireRecentLogin(current.session);
    }
    const user = attempt.link
      ? await repository.linkIdentity(attempt.link.userId, identity)
      : await repository.register(identity);
    if (user.status !== 'active' || user.fixture)
      throw new AuthError(403, 'ACCOUNT_DISABLED');
    const token = random();
    const session = {
      userId: user.userId,
      csrfToken: random(),
      expiresAt: new Date(now().getTime() + options.sessionSeconds * 1000),
      authenticatedAt: now(),
    };
    await repository.createSession(hash(token), session);
    return {
      token,
      session,
      user: publicIdentity(user),
      returnTo: attempt.returnTo ?? '/',
    };
  }
  return {
    providers: Object.keys(providers) as Provider[],
    begin: (provider: Provider, returnTo?: string) =>
      begin(provider, undefined, returnTo),
    linkedProviders: (userId: string) => repository.linkedProviders(userId),
    async beginLink(provider: Provider, token: string) {
      if (provider === 'apple')
        throw new AuthError(503, 'LINK_PROVIDER_UNSUPPORTED');
      const result = await authenticate(token);
      requireRecentLogin(result.session);
      if (
        (await repository.linkedProviders(result.user.userId)).includes(
          provider,
        )
      )
        throw new AuthError(409, 'PROVIDER_ALREADY_CONNECTED');
      return begin(provider, {
        userId: result.user.userId,
        sessionHash: hash(token),
      });
    },
    async complete(
      provider: Provider,
      state: string,
      browser: string,
      response: URL | Request,
      currentToken?: string,
    ) {
      const client = providers[provider];
      if (!client) throw new AuthError(503, 'PROVIDER_NOT_CONFIGURED');
      const attempt = await repository.consumeAttempt(
        hash(state),
        hash(browser),
        now(),
      );
      if (!attempt || attempt.provider !== provider)
        throw new AuthError(401, 'INVALID_LOGIN_ATTEMPT');
      try {
        return await finish(client, attempt, response, currentToken);
      } catch (error) {
        const failure =
          error instanceof AuthError
            ? error
            : new AuthError(401, 'PROVIDER_LOGIN_FAILED');
        throw attempt.link
          ? new AuthError(failure.status, failure.code, 'link')
          : failure;
      }
    },
    authenticate,
    csrf(
      session: { csrfToken: string },
      origin: string | undefined,
      token: string | undefined,
    ) {
      if (
        origin !== options.publicOrigin ||
        !token ||
        !equalSecret(session.csrfToken, token)
      )
        throw new AuthError(403, 'CSRF_REJECTED');
    },
    async logout(token: string) {
      await repository.revoke(hash(token));
    },
    async setAdmin(actor: Identity, target: string, admin: boolean) {
      if (!actor.roles.includes('owner'))
        throw new AuthError(403, 'OWNER_REQUIRED');
      const user = await repository.setAdmin(actor.userId, target, admin);
      if (!user) throw new AuthError(404, 'ELIGIBLE_USER_NOT_FOUND');
      return publicIdentity(user);
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
