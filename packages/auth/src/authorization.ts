import type { Identity, Role } from '@anico/shared-schemas';

export class AuthorizationError extends Error {
  constructor(public readonly status: 401 | 403) {
    super(
      status === 401 ? 'Authentication required' : 'Insufficient permissions',
    );
  }
}

/** Domain policy: the owner ID must come from stored data, never request input. */
export function assertResourceOwner(
  actor: Identity | undefined,
  resourceOwnerId: string,
  options: { allowRoles?: readonly Role[] } = {},
): asserts actor is Identity {
  if (!actor) throw new AuthorizationError(401);
  if (
    actor.userId !== resourceOwnerId &&
    !options.allowRoles?.some((role) => actor.roles.includes(role))
  )
    throw new AuthorizationError(403);
}
