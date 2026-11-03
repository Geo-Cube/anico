import { createHash, randomBytes } from 'node:crypto';
import { AuthError, type AuthRepository } from '../domain/auth.js';
import type {
  DevelopmentRepository,
  DevelopmentRequest,
} from '../domain/development.js';
import { hash, publicIdentity, type AuthService } from './auth.js';

const random = () => randomBytes(32).toString('base64url');
const opaque = /^[A-Za-z0-9_-]{43}$/;
export function developmentRedirect(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthError(400, 'INVALID_DEVELOPMENT_REDIRECT');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65535 ||
    url.pathname !== '/callback' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    url.href !== value
  )
    throw new AuthError(400, 'INVALID_DEVELOPMENT_REDIRECT');
  return url;
}
export function createDevelopmentAuthService(options: {
  auth: AuthService;
  users: Pick<AuthRepository, 'user' | 'session'>;
  repository: DevelopmentRepository;
  sessionSeconds: number;
  now?: () => Date;
}) {
  const { auth, users, repository } = options;
  const now = options.now ?? (() => new Date());
  async function pending(id: string) {
    if (!opaque.test(id))
      throw new AuthError(400, 'INVALID_DEVELOPMENT_REQUEST');
    const request = await repository.request(hash(id), now());
    if (!request) throw new AuthError(401, 'DEVELOPMENT_REQUEST_EXPIRED');
    return request;
  }
  async function authenticate(
    token: string | undefined,
    origin: string | undefined,
  ) {
    if (!token || !opaque.test(token))
      throw new AuthError(401, 'DEVELOPMENT_LOGIN_REQUIRED');
    const session = await repository.session(hash(token), now());
    if (!session) throw new AuthError(401, 'DEVELOPMENT_SESSION_EXPIRED');
    if (origin !== session.origin)
      throw new AuthError(403, 'DEVELOPMENT_ORIGIN_REJECTED');
    const user = await users.user(session.userId);
    if (!user || user.status !== 'active' || user.fixture)
      throw new AuthError(401, 'ACCOUNT_DISABLED');
    return { user: publicIdentity(user), session };
  }
  return {
    authenticate,
    pending,
    async begin(input: Omit<DevelopmentRequest, 'expiresAt'>) {
      developmentRedirect(input.redirectUri);
      if (!opaque.test(input.state) || !opaque.test(input.challenge))
        throw new AuthError(400, 'INVALID_DEVELOPMENT_REQUEST');
      if (input.provider && !auth.providers.includes(input.provider))
        throw new AuthError(503, 'PROVIDER_NOT_CONFIGURED');
      const id = random();
      await repository.saveRequest(hash(id), {
        ...input,
        expiresAt: new Date(now().getTime() + 300000),
      });
      return id;
    },
    async approve(id: string, browserToken: string, approved: boolean) {
      await pending(id);
      const current = await auth.authenticate(browserToken);
      const request = await repository.consumeRequest(hash(id), now());
      if (!request) throw new AuthError(401, 'DEVELOPMENT_REQUEST_EXPIRED');
      const redirect = developmentRedirect(request.redirectUri);
      redirect.searchParams.set('state', request.state);
      if (!approved) redirect.searchParams.set('error', 'access_denied');
      else {
        const code = random();
        await repository.saveCode(hash(code), {
          userId: current.user.userId,
          parentSessionHash: hash(browserToken),
          redirectUri: request.redirectUri,
          challenge: request.challenge,
          expiresAt: new Date(now().getTime() + 60000),
        });
        redirect.searchParams.set('code', code);
      }
      return redirect.href;
    },
    async exchange(code: string, verifier: string, redirectUri: string) {
      developmentRedirect(redirectUri);
      if (!opaque.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))
        throw new AuthError(401, 'INVALID_DEVELOPMENT_CODE');
      const challenge = createHash('sha256')
        .update(verifier)
        .digest('base64url');
      const grant = await repository.consumeCode(
        hash(code),
        challenge,
        redirectUri,
        now(),
      );
      if (!grant) throw new AuthError(401, 'INVALID_DEVELOPMENT_CODE');
      const parent = await users.session(grant.parentSessionHash, now());
      const user = await users.user(grant.userId);
      if (
        !parent ||
        parent.userId !== grant.userId ||
        !user ||
        user.status !== 'active' ||
        user.fixture
      )
        throw new AuthError(401, 'ACCOUNT_DISABLED');
      const token = random();
      const expiresAt = new Date(
        Math.min(
          parent.expiresAt.getTime(),
          now().getTime() + Math.min(options.sessionSeconds, 28800) * 1000,
        ),
      );
      await repository.saveSession(hash(token), {
        userId: user.userId,
        origin: new URL(redirectUri).origin,
        csrfToken: random(),
        expiresAt,
      });
      return { token, expiresAt };
    },
    async logout(token: string, origin: string | undefined) {
      await authenticate(token, origin);
      await repository.revoke(hash(token));
    },
  };
}
export type DevelopmentAuthService = ReturnType<
  typeof createDevelopmentAuthService
>;
