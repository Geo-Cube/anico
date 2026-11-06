import { AuthorizationError, type Identity } from '@anico/auth';
import { AnimalError, type BreederVerification } from '../domain/entity.js';

export interface WarnLogger {
  warn(details: object, message: string): void;
}

/**
 * Ověření z místní projekce: bez identity 401, chybějící projekce 403,
 * nedostupné čtení databáze 503. Schválení je v MVP konečné.
 */
export function verifiedBreeder(verification: BreederVerification) {
  return async (actor: Identity | undefined): Promise<Identity> => {
    if (!actor) throw new AuthorizationError(401);
    let verified: boolean;
    try {
      verified = await verification.isVerified(actor.userId);
    } catch {
      throw new AnimalError(503, 'Breeder verification unavailable');
    }
    if (!verified) throw new AnimalError(403, 'Breeder is not verified');
    return actor;
  };
}
