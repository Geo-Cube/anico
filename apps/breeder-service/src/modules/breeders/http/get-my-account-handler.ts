import type { RequestHandler } from 'express';
import type { BreederRepository, FileStorage } from '../domain/ports.js';
import type { CurrentBreederResolver } from './current-breeder.js';
import { getMyAccount } from '../application/get-my-account.js';
import { toMyAccount } from './breeder-mapper.js';
import type { CertificateFile } from '@anico/shared-schemas';

export function getMyAccountHandler(
  repository: BreederRepository,
  resolveCurrentBreeder: CurrentBreederResolver,
  files: FileStorage,
): RequestHandler {
  return async (req, res) => {
    const identity = await resolveCurrentBreeder(req);
    const getAccount = getMyAccount(repository);

    const result = await getAccount(identity);
    let contentType: CertificateFile['contentType'] | undefined;

    const verificationRequest = result.breeder.verificationRequest;

    if (verificationRequest) {
      const fileReference =
        verificationRequest.breedingStationCertificate.fileReference;

      const metadata = await files.getMetadata(fileReference);
      if (!metadata) {
        throw new Error(
          'Failed to get metadata for breeding station certificate',
        );
      }
      contentType = metadata.contentType;
    }
    const response = toMyAccount(result.breeder, contentType);

    res.status(200).json(response);
  };
}
