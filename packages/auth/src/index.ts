import {
  IdentitySchema,
  type Identity,
  type Role,
} from '@anico/shared-schemas';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { RequestHandler } from 'express';
export type { Identity, Role } from '@anico/shared-schemas';

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
      maxTokenAge: '60s',
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
