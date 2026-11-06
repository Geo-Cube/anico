import type {
  AnimalDocumentsState,
  AnimalDocumentType,
  AssessmentStatus,
  DocumentAnimal,
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

/**
 * Doklady jednoho zvířete a jeho údaje pro posouzení (vlastník, čip); `revision` slouží
 * optimistické kontrole souběhu.
 */
export interface AnimalDocuments {
  animal: DocumentAnimal;
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
  documentId: string,
): DocumentVersion | undefined {
  return historyOf(versions, documentId).find((version) => version.isCurrent);
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

/** Podání (UC-03/1): každý soubor zakládá vlastní řadu, i při shodném typu. */
export function planSubmission(
  versions: readonly DocumentVersion[],
  inputs: readonly NewVersionInput[],
  submission: { id: () => string; now: Date; submittedBy: string },
): { versions: DocumentVersion[]; created: DocumentVersion[] } {
  const created = inputs.map((input) =>
    successorOf(undefined, input, submission),
  );
  return { versions: [...versions, ...created], created };
}

/** Náhrada pokračuje pouze v řadě explicitně zvolené zamítnuté verze. */
export function planReplacement(
  versions: readonly DocumentVersion[],
  documentId: string,
  input: NewVersionInput,
  submission: { id: () => string; now: Date; submittedBy: string },
): { versions: DocumentVersion[]; created: DocumentVersion[] } {
  const target = assertReplaceable(versions, documentId);
  const created = successorOf(target, input, submission);
  return {
    versions: [
      ...versions.map((version) =>
        version.id === target.id ? { ...version, isCurrent: false } : version,
      ),
      created,
    ],
    created: [created],
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
  const current = currentVersionOf(versions, documentId)!;
  if (!target.isCurrent)
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
  versions: readonly Pick<DocumentVersion, 'isCurrent' | 'assessmentStatus'>[],
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
  const byId = new Map(versions.map((version) => [version.id, version]));
  let root = target;
  while (root.previousDocumentId) {
    const previous = byId.get(root.previousDocumentId);
    if (!previous) break;
    root = previous;
  }
  const chain = new Set([root.id]);
  const ordered = [...versions].sort(
    (a, b) => a.versionNumber - b.versionNumber,
  );
  return ordered.filter((version) => {
    if (version.previousDocumentId && chain.has(version.previousDocumentId))
      chain.add(version.id);
    return chain.has(version.id);
  });
}
