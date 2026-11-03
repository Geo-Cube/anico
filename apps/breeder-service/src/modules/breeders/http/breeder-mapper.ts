import type { Breeder } from '../domain/breeder.js';
import { accountState } from '../domain/breeder.js';
import type { MyAccount, VerificationRequestDto } from '@anico/shared-schemas';

export function toMyAccount(breeder: Breeder): MyAccount {
  return {
    accountState: accountState(breeder),
    breederId: breeder.breederId,
    firstName: breeder.firstName,
    lastName: breeder.lastName,
    emailAddress: breeder.emailAddress,
    breedingStationName: breeder.breedingStationName,
    breedingStationNumber: breeder.breedingStationNumber,
    isVerified: breeder.isVerified,
    verificationRequest:
      breeder.verificationRequest as unknown as VerificationRequestDto,
  };
}
