import { AuthorizationError, type Identity } from '@anico/auth';
import { AnimalError, type BreederVerification } from '../domain/entity.js';

export interface WarnLogger {
  warn(details: object, message: string): void;
}

/**
 * Přihlášený chovatel s ověřeným účtem (UC-01 `isVerified`), zjištěno v breeder-service při
 * každém požadavku. Bez identity 401, neověřený 403, nedostupná breeder-service 503 (fail closed).
 */
export function verifiedBreeder(verification: BreederVerification) {
  return async (
    actor: Identity | undefined,
    identityToken: string | undefined,
  ): Promise<Identity> => {
    if (!actor || !identityToken) throw new AuthorizationError(401);
    let verified: boolean;
    try {
      verified = await verification.isVerified(identityToken);
    } catch {
      throw new AnimalError(503, 'Breeder verification unavailable');
    }
    if (!verified) throw new AnimalError(403, 'Breeder is not verified');
    return actor;
  };
}
