import type { Request } from 'express';

/** Ověřená identita z gateway; přeposílá se breeder-service pro zjištění `isVerified`. */
export function identityToken(req: Request): string | undefined {
  const token = req.headers['x-anico-identity'];
  return typeof token === 'string' ? token : undefined;
}
