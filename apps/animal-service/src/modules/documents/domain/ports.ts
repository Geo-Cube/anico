import type { AssessmentStatus, DocumentAnimal } from '@anico/shared-schemas';
import type { AnimalDocuments, DocumentVersion } from './animal-documents.js';

export interface AnimalDocumentsRepository {
  /** Verze dokladů a údaje zvířete; `null`, pokud zvíře neexistuje. */
  load(animalId: string): Promise<AnimalDocuments | null>;
  /** Atomicky nahradí verze, jen když se `revision` mezitím nezměnila; jinak `false`. */
  saveVersions(
    animalId: string,
    ownerUserId: string,
    expectedRevision: number,
    versions: DocumentVersion[],
    /** Náhrada navíc vyžaduje aktuální `REJECTED` verzi přímo ve filtru zápisu. */
    replacementId?: string,
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
  reviewQueue(
    limit: number,
  ): Promise<{ version: DocumentVersion; animal: DocumentAnimal }[]>;
}
