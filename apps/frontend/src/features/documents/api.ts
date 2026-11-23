import {
  AnimalDocumentHistorySchema,
  AnimalDocumentListSchema,
  AnimalDocumentSchema,
  AnimalPhotoListSchema,
  DocumentReviewListSchema,
  type AnimalDocumentFile,
  type AnimalDocumentType,
  type AssessmentStatus,
  type DecideAnimalDocumentInput,
} from '@anico/shared-schemas';
import { ANIMAL_API_BASE, animalKey } from '@/features/animals/api';
import { apiErrorText } from '@/shared/lib/error-text';
import { contentTypeLabel } from '@/shared/lib/format';
import { apiBlob, apiRequest, conflictCurrent } from '@/shared/lib/http';

/** Absolutní cesta fronty; detail leží o dvě úrovně níž (`:animalId/:documentId`). */
export const QUEUE_PATH = '/administrace/chovatele/doklady';

const animalPath = (animalId: string) =>
  `${ANIMAL_API_BASE}/animals/${encodeURIComponent(animalId)}`;
const documentsPath = (animalId: string) => `${animalPath(animalId)}/documents`;
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

/** Fotografie zvířete pro náhled při posouzení dokladu; čte je i posuzovatel (ADR-0008). */
export const animalPhotosQuery = (animalId: string) => ({
  queryKey: [...animalKey, animalId, 'photos'] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${animalPath(animalId)}/photos`, {
      signal,
      schema: AnimalPhotoListSchema,
    }),
});

/** Fronta animal-service vrací nejvýše tolik čekajících dokladů. */
export const DOCUMENT_QUEUE_LIMIT = 500;
export const reviewQueueKey = ['document-reviews'] as const;
export const reviewQueueQuery = {
  queryKey: reviewQueueKey,
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${ANIMAL_API_BASE}/document-reviews`, {
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
export const documentConflict = (error: unknown) =>
  conflictCurrent(error, AnimalDocumentSchema);

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

const sizeFormat = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
/** „PDF · 1,2 MB“ */
export function fileSummary(file: AnimalDocumentFile) {
  const size =
    file.size < 1024 * 1024
      ? `${sizeFormat.format(Math.max(1, Math.round(file.size / 1024)))} kB`
      : `${sizeFormat.format(file.size / 1024 / 1024)} MB`;
  return `${contentTypeLabel(file.contentType)} · ${size}`;
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
export const documentErrorText = (error: unknown) =>
  apiErrorText(error, {
    codes: {
      'Breeder is not verified':
        'Nejdřív musí být ověřen váš chovatelský účet. Pokud vás administrátor právě schválil, zkuste to za chvíli znovu.',
    },
    statuses: {
      403: 'K této operaci nemáte oprávnění.',
      404: 'Zvíře nebo doklad nebyly nalezeny, nebo k nim nemáte přístup.',
      413: 'Soubor je příliš velký. Každý doklad může mít nejvýše 10 MiB.',
      415: 'Doklad musí být soubor PDF, JPEG nebo PNG. Nic nebylo uloženo.',
      409: 'Doklady se mezitím změnily. Načtěte aktuální stav a zkuste to znovu.',
      400: 'Podání není platné. Zkontrolujte soubory a typy dokladů.',
    },
  });
