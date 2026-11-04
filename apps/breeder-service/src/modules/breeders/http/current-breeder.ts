import type { Identity } from '../../../shared/http/identity.js';
import type { NewBreeder } from '../domain/breeder.js';

/** Jediné místo, kde se identita z přihlášení mění na údaje nového chovatele. */
export function toNewBreeder(identity: Identity): NewBreeder {
  return {
    breederId: identity.id,
    firstName: identity.firstName,
    lastName: identity.lastName,
    emailAddress: identity.emailAddress,
  };
}
