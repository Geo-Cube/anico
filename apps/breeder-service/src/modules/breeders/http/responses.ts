import {
  AdminVerificationRequestSchema,
  MyAccountSchema,
  type AdminVerificationRequest,
  type MyAccount,
} from '@anico/shared-schemas';
import { certificateContentTypeOf } from '../application/certificate-content-type.js';
import type { Breeder } from '../domain/breeder.js';
import type { FileStorage } from '../domain/ports.js';
import { toAdminVerificationRequest, toMyAccount } from './breeder-mapper.js';

/** Sestaví a zvaliduje `MyAccount` (typ certifikátu se čte přes jediný helper). */
export function myAccountOf(files: FileStorage) {
  const contentTypeOf = certificateContentTypeOf(files);
  return async (breeder: Breeder): Promise<MyAccount> =>
    MyAccountSchema.parse(
      toMyAccount(
        breeder,
        breeder.verificationRequest
          ? await contentTypeOf(breeder.verificationRequest)
          : undefined,
      ),
    );
}

export function adminRequestOf(files: FileStorage) {
  const contentTypeOf = certificateContentTypeOf(files);
  return async (breeder: Breeder): Promise<AdminVerificationRequest> => {
    if (!breeder.verificationRequest) {
      throw new Error('Breeder has no verification request');
    }
    return AdminVerificationRequestSchema.parse(
      toAdminVerificationRequest(
        breeder,
        await contentTypeOf(breeder.verificationRequest),
      ),
    );
  };
}
