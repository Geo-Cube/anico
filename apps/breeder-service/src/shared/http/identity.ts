import { requireRole, type Identity } from '@anico/auth';
import type { RequestHandler, Response } from 'express';

/** Identity is supplied only by the verified @anico/auth middleware. */
export const authenticate: RequestHandler = (req, res, next) => {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  res.locals.identity = req.auth;
  next();
};

export const requireAdmin = requireRole('admin', 'owner');

export function identityOf(res: Response): Identity {
  const identity = res.locals.identity as Identity | undefined;
  if (!identity) {
    throw new Error('identityOf() called without authenticate middleware');
  }
  return identity;
}
