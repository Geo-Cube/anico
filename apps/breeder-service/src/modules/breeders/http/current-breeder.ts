import type { Identity } from '@anico/auth';
import type { NewBreeder } from '../domain/breeder.js';

/** Jediné místo, kde se identita z přihlášení mění na údaje nového chovatele. */
export function toNewBreeder(identity: Identity): NewBreeder {
  return {
    breederId: identity.userId,
    firstName: identity.givenName,
    lastName: identity.familyName,
    emailAddress: identity.email,
  };
}
