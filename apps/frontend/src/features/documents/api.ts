import {
  AnimalDocumentHistorySchema,
  AnimalDocumentListSchema,
  AnimalDocumentSchema,
  DocumentReviewListSchema,
  type AnimalDocument,
  type AnimalDocumentFile,
  type AnimalDocumentType,
  type AssessmentStatus,
  type DecideAnimalDocumentInput,
} from '@anico/shared-schemas';
import { animalKey } from '@/features/animals/api';
import { isUnverifiedBreeder } from '@/features/animals/AnimalError';
import { apiBlob, apiRequest, isApiError } from '@/shared/lib/http';

const base = '/api/animal';
const documentsPath = (animalId: string) =>
  `${base}/animals/${encodeURIComponent(animalId)}/documents`;
const documentPath = (animalId: string, documentId: string) =>
  `${documentsPath(animalId)}/${encodeURIComponent(documentId)}`;

/**
 * Doklady patří pod klíč zvířete: změna nebo smazání zvířete je obnoví či odebere
 * spolu s ním a stav dokladů na kartě (`documentsState`) se obnoví s nimi.
 */
export const documentsKey = (animalId: string) =>
  [...animalKey, animalId, 'documents'] as const;

export const documentsQuery = (animalId: string) => ({
  queryKey: documentsKey(animalId),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(documentsPath(animalId), {
      signal,
      schema: AnimalDocumentListSchema,
    }),
});

export const historyQuery = (animalId: string, documentId: string) => ({
  queryKey: [...documentsKey(animalId), documentId, 'history'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${documentPath(animalId, documentId)}/history`, {
      signal,
      schema: AnimalDocumentHistorySchema,
    }),
});

/** Fronta animal-service vrací nejvýše tolik čekajících dokladů. */
export const DOCUMENT_QUEUE_LIMIT = 500;
export const reviewQueueKey = ['document-reviews'] as const;
export const reviewQueueQuery = {
  queryKey: reviewQueueKey,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}/document-reviews`, {
      signal,
      schema: DocumentReviewListSchema,
    }),
};

/** Jedno podání: `documentTypes[i]` je typ i-tého souboru (UC-03/1). */
export function submitDocuments(
  animalId: string,
  items: { file: File; documentType: AnimalDocumentType }[],
  csrfToken: string,
) {
  const body = new FormData();
  for (const { file, documentType } of items) {
    body.append('documentTypes', documentType);
    body.append('files', file);
  }
  return apiRequest(documentsPath(animalId), {
    method: 'POST',
    csrfToken,
    body,
    schema: AnimalDocumentListSchema,
  });
}

/** Nová verze aktuálního zamítnutého dokladu (UC-03/4). */
export function replaceDocument(
  animalId: string,
  documentId: string,
  file: File,
  csrfToken: string,
) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest(`${documentPath(animalId, documentId)}/versions`, {
    method: 'POST',
    csrfToken,
    body,
    schema: AnimalDocumentSchema,
  });
}

export const decideDocument = (
  animalId: string,
  documentId: string,
  input: DecideAnimalDocumentInput,
  csrfToken: string,
) =>
  apiRequest(`${documentPath(animalId, documentId)}/decision`, {
    method: 'POST',
    csrfToken,
    body: input,
    schema: AnimalDocumentSchema,
  });

export const downloadDocument = (animalId: string, documentId: string) =>
  apiBlob(`${documentPath(animalId, documentId)}/file`);

/** 409: verzi mezitím někdo posoudil nebo nahradil; `current` je aktuální verze řady. */
export function documentConflict(
  error: unknown,
): { current: AnimalDocument | null } | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const body = error.body;
  const parsed =
    body && typeof body === 'object' && 'current' in body
      ? AnimalDocumentSchema.safeParse(body.current)
      : null;
  return { current: parsed?.success ? parsed.data : null };
}

export const DOCUMENT_TYPE_LABEL: Record<AnimalDocumentType, string> = {
  PEDIGREE: 'Průkaz původu',
  HEALTH_RESULTS: 'Výsledky zdravotních vyšetření',
  BREEDING_APPROVAL: 'Doklad o chovnosti',
};
export const DOCUMENT_TYPES = Object.keys(
  DOCUMENT_TYPE_LABEL,
) as AnimalDocumentType[];

export const ASSESSMENT_LABEL: Record<AssessmentStatus, string> = {
  PENDING: 'Čeká na posouzení',
  APPROVED: 'Schváleno',
  REJECTED: 'Zamítnuto',
};

const FORMAT_LABEL: Record<AnimalDocumentFile['contentType'], string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
};

const sizeFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
/** „PDF · 1,2 MB“ */
export function fileSummary(file: AnimalDocumentFile) {
  const size =
    file.size < 1024 * 1024
      ? `${sizeFormat.format(Math.max(1, Math.round(file.size / 1024)))} kB`
      : `${sizeFormat.format(file.size / 1024 / 1024)} MB`;
  return `${FORMAT_LABEL[file.contentType]} · ${size}`;
}

/** Stejný limit jako animal-service (R5, ADR-0005); formát server kontroluje znovu podle obsahu. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png';
const DOCUMENT_CONTENT_TYPES = DOCUMENT_ACCEPT.split(',');

/** Proč soubor nelze odeslat, nebo `null`. */
export function fileProblem(file: File): string | null {
  if (!DOCUMENT_CONTENT_TYPES.includes(file.type))
    return 'Nepodporovaný formát. Nahrajte PDF, JPEG nebo PNG.';
  if (file.size > MAX_DOCUMENT_BYTES) return 'Soubor je větší než 10 MiB.';
  if (file.size === 0) return 'Soubor je prázdný.';
  return null;
}

/** Česká zpráva k chybě API dokladů. */
export function documentErrorText(error: unknown): string {
  if (!isApiError(error))
    return 'Služba je dočasně nedostupná. Zkuste to prosím znovu.';
  if (isUnverifiedBreeder(error))
    return 'Nejdřív musí být ověřen váš chovatelský účet. Pokud vás administrátor právě schválil, zkuste to za chvíli znovu.';
  if (error.status === 403) return 'K této operaci nemáte oprávnění.';
  if (error.status === 404)
    return 'Zvíře nebo doklad nebyly nalezeny, nebo k nim nemáte přístup.';
  if (error.status === 413)
    return 'Soubor je příliš velký. Každý doklad může mít nejvýše 10 MiB.';
  if (error.status === 415)
    return 'Doklad musí být soubor PDF, JPEG nebo PNG. Nic nebylo uloženo.';
  if (error.status === 409)
    return 'Doklady se mezitím změnily. Načtěte aktuální stav a zkuste to znovu.';
  if (error.status === 400)
    return 'Podání není platné. Zkontrolujte soubory a typy dokladů.';
  return 'Služba je dočasně nedostupná. Zkuste to prosím znovu.';
}
