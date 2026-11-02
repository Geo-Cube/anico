import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type Identity } from '@anico/shared-schemas';
import {
  AuthError,
  type AuthRepository,
  type Provider,
  type ProviderClient,
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
  return {
    providers: Object.keys(providers),
    async begin(provider: Provider) {
      const client = providers[provider];
      if (!client) throw new AuthError(503, 'PROVIDER_NOT_CONFIGURED');
      const state = random(),
        nonce = random(),
        verifier = random(),
        browser = random();
      const callback = `${options.publicOrigin}/api/auth/login/${provider}/callback`;
      const url = await client.authorize({ state, nonce, verifier, callback });
      await repository.saveAttempt(hash(state), {
        provider,
        state,
        nonce,
        verifier,
        browserHash: hash(browser),
        expiresAt: new Date(now().getTime() + 600000),
      });
      return { url, browser };
    },
    async complete(
      provider: Provider,
      state: string,
      browser: string,
      response: URL | Request,
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
      const identity = await client.exchange({
        ...attempt,
        callback: `${options.publicOrigin}/api/auth/login/${provider}/callback`,
        response,
      });
      if (identity.provider !== provider)
        throw new AuthError(401, 'INVALID_PROVIDER');
      const user = await repository.register(identity);
      if (user.status !== 'active' || user.fixture)
        throw new AuthError(403, 'ACCOUNT_DISABLED');
      const token = random();
      const session = {
        userId: user.userId,
        csrfToken: random(),
        expiresAt: new Date(now().getTime() + options.sessionSeconds * 1000),
      };
      await repository.createSession(hash(token), session);
      return { token, session, user: publicIdentity(user) };
    },
    async authenticate(token: string | undefined) {
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new AuthError(401, 'AUTHENTICATION_REQUIRED');
      const session = await repository.session(hash(token), now());
      if (!session) throw new AuthError(401, 'SESSION_EXPIRED');
      const user = await repository.user(session.userId);
      if (!user || user.status !== 'active' || user.fixture)
        throw new AuthError(401, 'ACCOUNT_DISABLED');
      return { user: publicIdentity(user), session };
    },
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
