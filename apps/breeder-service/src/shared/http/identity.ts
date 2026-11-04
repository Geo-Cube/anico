import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';

export interface Identity {
  id: string;
  firstName: string;
  lastName: string;
  emailAddress: string;
  isAdmin: boolean;
}

/** Vrací identitu volajícího, nebo `null`, pokud ji nelze určit. */
export type IdentityResolver = (
  req: Request,
) => Identity | null | Promise<Identity | null>;

const IdentityHeadersSchema = z.object({
  // čárka/bílé znaky: Node spojuje duplicitní hlavičky přes ", "
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[^,\s]+$/),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  emailAddress: z.email().max(254),
});

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' ? value : null;
}

function decoded(value: string | null): string | null {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * Dočasný kontrakt: identitu doplňuje gateway hlavičkami `x-user-*`
 * (hodnoty URL-encoded). Servisa musí běžet jen za gateway, která tyto
 * hlavičky od klienta zahazuje a přepisuje. Později lze vyměnit za JWT.
 */
export const gatewayHeaderIdentity: IdentityResolver = (req) => {
  const parsed = IdentityHeadersSchema.safeParse({
    id: decoded(header(req, 'x-user-id')),
    firstName: decoded(header(req, 'x-user-first-name')),
    lastName: decoded(header(req, 'x-user-last-name')),
    emailAddress: decoded(header(req, 'x-user-email')),
  });
  if (!parsed.success) return null;

  const roles = (decoded(header(req, 'x-user-roles')) ?? '')
    .split(',')
    .map((role) => role.trim());

  return { ...parsed.data, isAdmin: roles.includes('admin') };
};

const IDENTITY_KEY = 'identity';

export function authenticate(resolve: IdentityResolver): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identity = await resolve(req);
      if (!identity) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      res.locals[IDENTITY_KEY] = identity;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin(resolve: IdentityResolver): RequestHandler {
  const authenticated = authenticate(resolve);
  return async (req, res, next) => {
    let failure: unknown;
    let passed = false;
    await authenticated(req, res, (error?: unknown) => {
      failure = error;
      passed = true;
    });
    if (!passed) return; // authenticate už odpověděl (401)
    if (failure) {
      next(failure);
      return;
    }
    if (!identityOf(res).isAdmin) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

export function identityOf(res: Response): Identity {
  const identity = res.locals[IDENTITY_KEY] as Identity | undefined; // nastavuje jen authenticate()
  if (!identity) {
    throw new Error('identityOf() called without authenticate() middleware');
  }
  return identity;
}
