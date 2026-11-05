import type { Readable } from 'node:stream';
import type { Animal, AssessmentStatus } from '@anico/shared-schemas';
import type { AnimalDocuments, DocumentVersion } from './animal-documents.js';
import type { DocumentContentType } from './document-file.js';

export interface AnimalDocumentsRepository {
  /** `null`, pokud zvíře neexistuje. */
  load(animalId: string): Promise<AnimalDocuments | null>;
  /** Atomicky nahradí verze, jen když se `revision` mezitím nezměnila; jinak `false`. */
  saveVersions(
    animalId: string,
    ownerUserId: string,
    expectedRevision: number,
    versions: DocumentVersion[],
  ): Promise<boolean>;
  /** Zapíše rozhodnutí jen o aktuální `PENDING` verzi; jinak `null` (A4). */
  decide(
    animalId: string,
    documentId: string,
    decision: {
      assessmentStatus: Exclude<AssessmentStatus, 'PENDING'>;
      reviewedBy: string;
      reviewedAt: Date;
      rejectionReason: string | null;
    },
  ): Promise<DocumentVersion | null>;
  /** Aktuální `PENDING` verze všech zvířat, nejdéle čekající první. */
  reviewQueue(limit: number): Promise<
    {
      version: DocumentVersion;
      animal: Pick<
        Animal,
        'id' | 'ownerUserId' | 'name' | 'species' | 'breedId' | 'sex'
      >;
    }[]
  >;
}

export interface DocumentFileStorage {
  save(file: {
    content: Buffer;
    fileName: string;
    contentType: DocumentContentType;
  }): Promise<string>;
  open(
    fileReference: string,
  ): Promise<{ stream: Readable; size: number } | null>;
  delete(fileReference: string): Promise<void>;
}

/** Stav ověření chovatele z breeder-service (UC-01). Nedostupnost vyhazuje chybu. */
export interface BreederVerification {
  isVerified(identityToken: string): Promise<boolean>;
}
