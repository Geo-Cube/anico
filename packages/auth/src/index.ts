import {
  IdentitySchema,
  type Identity,
  type Role,
} from '@anico/shared-schemas';
import {
  jwtVerify,
  createLocalJWKSet,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
} from 'jose';
import type { RequestHandler } from 'express';
export type { Identity, Role } from '@anico/shared-schemas';
export { AuthorizationError, assertResourceOwner } from './authorization.js';

declare global {
  namespace Express {
    interface Request {
      auth?: Identity;
    }
  }
}

export function createIdentityVerifier(options: {
  key: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}) {
  return async (token: string): Promise<Identity> => {
    const { payload } = await jwtVerify(token, options.key, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['ES256'],
      typ: 'anico-identity+jwt',
      requiredClaims: ['sub', 'iat', 'exp', 'jti'],
      maxTokenAge: '30s',
      clockTolerance: 2,
    });
    const identity = IdentitySchema.parse(payload.identity);
    if (payload.sub !== identity.userId)
      throw new Error('Identity subject mismatch');
    return identity;
  };
}
export function requireAuth(
  verify: (token: string) => Promise<Identity>,
): RequestHandler {
  return async (req, res, next) => {
    // Gateway overwrites this header. Raw x-user-* headers are never trusted.
    const token = req.headers['x-anico-identity'];
    if (typeof token !== 'string' || token.length > 8192) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    try {
      req.auth = await verify(token);
    } catch {
      res.status(401).json({ error: 'Invalid identity' });
      return;
    }
    next();
  };
}
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!allowed.some((role) => req.auth!.roles.includes(role))) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function requestAuthenticator(
  env: NodeJS.ProcessEnv,
): RequestHandler | undefined {
  const local = env.AUTH_JWKS_JSON;
  const remote = env.AUTH_JWKS_URL;
  if (!local && !remote) {
    if (
      env.APP_ENV === 'dev' ||
      (env.NODE_ENV === 'production' && env.APP_ENV !== 'local')
    )
      throw new Error(
        'API requires identity configuration; start remote development through AniCo commands',
      );
    return undefined;
  }
  if ((local && remote) || !env.AUTH_ISSUER || !env.AUTH_AUDIENCE)
    throw new Error('Invalid identity configuration');
  let key: JWTVerifyGetKey;
  if (local) {
    if (
      env.NODE_ENV === 'production' ||
      env.APP_ENV !== 'dev' ||
      env.HOST !== '127.0.0.1'
    )
      throw new Error('Local identity keys require loopback development mode');
    try {
      const jwks = JSON.parse(local);
      if (
        !Array.isArray(jwks.keys) ||
        !jwks.keys.length ||
        jwks.keys.some(
          (item: Record<string, unknown>) =>
            !item || item.kty !== 'EC' || item.crv !== 'P-256' || 'd' in item,
        )
      )
        throw new Error();
      key = createLocalJWKSet(jwks);
    } catch {
      throw new Error('Invalid public identity keys; values hidden');
    }
  } else key = createRemoteJWKSet(new URL(remote!));
  return requireAuth(
    createIdentityVerifier({
      key,
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    }),
  );
}
