import type {
  AnimalDocumentsState,
  AnimalDocumentType,
  AssessmentStatus,
} from '@anico/shared-schemas';
import type { FileContentType } from '../../../files/file-content.js';

/** Limit jednoho souboru dokladu (R5, ADR-0005). */
export const MAX_DOCUMENT_FILE_BYTES = 10 * 1024 * 1024;

/** Uložená verze dokladu; `fileReference` nikdy neopouští službu. */
export interface DocumentVersion {
  id: string;
  documentType: AnimalDocumentType;
  versionNumber: number;
  previousDocumentId: string | null;
  isCurrent: boolean;
  file: {
    fileName: string;
    fileReference: string;
    contentType: FileContentType;
    size: number;
  };
  assessmentStatus: AssessmentStatus;
  submittedAt: Date;
  submittedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
}

/** Doklady jednoho zvířete; `revision` slouží optimistické kontrole souběhu. */
export interface AnimalDocuments {
  animalId: string;
  ownerUserId: string;
  revision: number;
  versions: DocumentVersion[];
}

export type StoredFile = DocumentVersion['file'];

export interface NewVersionInput {
  documentType: AnimalDocumentType;
  file: StoredFile;
}

export class DocumentError extends Error {
  constructor(
    public readonly status: 404 | 409 | 415,
    message: string,
    /** Aktuální verze řady při 409 (A3, A4). */
    public readonly current?: DocumentVersion,
  ) {
    super(message);
  }
}

export const documentNotFound = () =>
  new DocumentError(404, 'Document not found');

export function currentVersionOf(
  versions: readonly DocumentVersion[],
  documentType: AnimalDocumentType,
): DocumentVersion | undefined {
  return versions.find(
    (version) => version.isCurrent && version.documentType === documentType,
  );
}

function successorOf(
  current: DocumentVersion | undefined,
  input: NewVersionInput,
  submission: { id: () => string; now: Date; submittedBy: string },
): DocumentVersion {
  return {
    id: submission.id(),
    documentType: input.documentType,
    versionNumber: current ? current.versionNumber + 1 : 1,
    previousDocumentId: current?.id ?? null,
    isCurrent: true,
    file: input.file,
    assessmentStatus: 'PENDING',
    submittedAt: submission.now,
    submittedBy: submission.submittedBy,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
  };
}

/**
 * Podání (UC-03/1, R7): každý soubor je samostatný doklad `PENDING`. Typ, který zvíře už má,
 * pokračuje ve své řadě novou verzí; předchozí verze zůstává v historii, jen přestane být aktuální.
 */
export function planSubmission(
  versions: readonly DocumentVersion[],
  inputs: readonly NewVersionInput[],
  submission: { id: () => string; now: Date; submittedBy: string },
): { versions: DocumentVersion[]; created: DocumentVersion[] } {
  const created = inputs.map((input) =>
    successorOf(
      currentVersionOf(versions, input.documentType),
      input,
      submission,
    ),
  );
  const superseded = new Set(
    created.flatMap((version) => version.previousDocumentId ?? []),
  );
  return {
    versions: [
      ...versions.map((version) =>
        superseded.has(version.id) ? { ...version, isCurrent: false } : version,
      ),
      ...created,
    ],
    created,
  };
}

/**
 * Nová verze konkrétního dokladu (UC-03/4–5): jen nad aktuální `REJECTED` verzí. Jiný stav
 * nebo již nahrazená verze vrátí 409 s aktuální verzí řady.
 */
export function assertReplaceable(
  versions: readonly DocumentVersion[],
  documentId: string,
): DocumentVersion {
  const target = versions.find((version) => version.id === documentId);
  if (!target) throw documentNotFound();
  const current = currentVersionOf(versions, target.documentType)!;
  if (current.id !== documentId)
    throw new DocumentError(
      409,
      'Document version was already replaced',
      current,
    );
  if (current.assessmentStatus !== 'REJECTED')
    throw new DocumentError(
      409,
      'Only a rejected document can be replaced',
      current,
    );
  return current;
}

/** Odvozený stav dokladů zvířete (UC-03/7): PENDING > APPROVED > REJECTED, bez dokladů NOT_SUBMITTED. */
export function documentsState(
  versions: readonly DocumentVersion[],
): AnimalDocumentsState {
  const statuses = new Set(
    versions
      .filter((version) => version.isCurrent)
      .map((version) => version.assessmentStatus),
  );
  for (const status of ['PENDING', 'APPROVED', 'REJECTED'] as const)
    if (statuses.has(status)) return status;
  return 'NOT_SUBMITTED';
}

/** Všechny verze řady, do které patří `documentId`, nejstarší první. */
export function historyOf(
  versions: readonly DocumentVersion[],
  documentId: string,
): DocumentVersion[] {
  const target = versions.find((version) => version.id === documentId);
  if (!target) throw documentNotFound();
  return versions
    .filter((version) => version.documentType === target.documentType)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}
