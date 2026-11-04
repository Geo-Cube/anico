import { animalBreeds, type Animal } from '@anico/shared-schemas';

export type DocumentType = 'PEDIGREE' | 'HEALTH_RESULTS' | 'BREEDING_APPROVAL';
export type AssessmentStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface SharedFile {
  file_name: string;
  file_reference: string;
}

// reviewed_by sem záměrně nepatří: chovatel jméno administrátora nikdy nevidí.
export interface AnimalDocument {
  document_id: string;
  animal_id: string;
  document_type: DocumentType;
  version_number: number;
  previous_document_id: string | null;
  file: SharedFile;
  assessment_status: AssessmentStatus;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

// Číslo čipu ve schématu zvířete zatím chybí (ZADANI, kap. 9, bod 7).
export type DocumentAnimal = Animal & { microchipNumber: string | null };

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'PEDIGREE',
  'HEALTH_RESULTS',
  'BREEDING_APPROVAL',
];

// Dočasné mapování na kódy backendu, do dohody týmů se mění jen zde.
export const BACKEND_DOCUMENT_TYPES: Record<DocumentType, string> = {
  PEDIGREE: 'PEDIGREE',
  HEALTH_RESULTS: 'VET_REPORT',
  BREEDING_APPROVAL: 'BREEDING_LICENSE',
};

export function formatDocumentTypeLabel(
  type: DocumentType,
  species: Animal['species'],
) {
  if (type === 'PEDIGREE')
    return species === 'horse' ? 'Průkaz koně' : 'Průkaz původu';
  if (type === 'HEALTH_RESULTS') return 'Zdravotní výsledky';
  return 'Potvrzení o uchovnění';
}

export function formatStatusLabel(status: AssessmentStatus) {
  if (status === 'PENDING') return 'K posouzení';
  if (status === 'APPROVED') return 'Ověřený';
  return 'Zamítnutý';
}

export function getStatusClass(status: AssessmentStatus) {
  if (status === 'PENDING') return 'status-pending';
  if (status === 'APPROVED') return 'status-approved';
  return 'status-rejected';
}

export function formatSpeciesLabel(species: Animal['species']) {
  return species === 'dog' ? 'Pes' : 'Kůň';
}

export function formatSexLabel(animal: Animal) {
  if (animal.sex === 'unknown') return 'Neznámé pohlaví';
  if (animal.species === 'horse')
    return animal.sex === 'male' ? 'Hřebec' : 'Klisna';
  return animal.sex === 'male' ? 'Samec' : 'Samice';
}

export function formatBreedName(animal: Animal) {
  return (
    animalBreeds(animal.species).find((breed) => breed.id === animal.breedId)
      ?.name ?? animal.breedId
  );
}

// Datum narození je jen den, přes Date by se v jiném pásmu mohl posunout.
export function formatBirthDate(birthDate: string) {
  const [year, month, day] = birthDate.split('-').map(Number);
  return `${day}. ${month}. ${year}`;
}

// Stejné údaje jako UC-01, ale s čárkou podle zadání: 30. 10. 2026, 10:20.
export function formatDateTime(date: Date) {
  const day = date.toLocaleDateString('cs-CZ');
  const time = date.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${day}, ${time}`;
}

export function getFileFormat(fileName: string) {
  return fileName.split('.').pop()?.toUpperCase() ?? '';
}

// Aktuální je verze, na kterou už žádná novější neodkazuje.
export function getCurrentDocuments(documents: readonly AnimalDocument[]) {
  const replaced = new Set(
    documents.map((document) => document.previous_document_id),
  );
  return documents.filter((document) => !replaced.has(document.document_id));
}

// Starší verze dokladu od nejnovější, samotný doklad se neopakuje.
export function getVersionHistory(
  document: AnimalDocument,
  documents: readonly AnimalDocument[],
) {
  const history: AnimalDocument[] = [];
  let previousId = document.previous_document_id;
  while (previousId) {
    const previous = documents.find((item) => item.document_id === previousId);
    if (!previous) break;
    history.push(previous);
    previousId = previous.previous_document_id;
  }
  return history;
}

function formatRejectedCountText(count: number) {
  if (count === 1) return '1 zamítnutý';
  if (count >= 2 && count <= 4) return `${count} zamítnuté`;
  return `${count} zamítnutých`;
}

// Počítá se jen z aktuálních verzí a nesmí schovat zamítnutý ani ověřený doklad.
export function formatDocumentsSummary(
  current: readonly AnimalDocument[],
): string {
  if (current.length === 0) return 'Nedoložené';
  const count = (status: AssessmentStatus) =>
    current.filter((document) => document.assessment_status === status).length;
  const approved = count('APPROVED');
  const rejected = count('REJECTED');
  const pending = count('PENDING');
  return [
    approved > 0 ? 'Ověřené' : '',
    rejected > 0 ? formatRejectedCountText(rejected) : '',
    pending > 0 ? `${pending} k posouzení` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function getSummaryStatus(
  current: readonly AnimalDocument[],
): AssessmentStatus | null {
  const statuses = current.map((document) => document.assessment_status);
  if (statuses.length === 0) return null;
  if (statuses.includes('REJECTED')) return 'REJECTED';
  return statuses.includes('PENDING') ? 'PENDING' : 'APPROVED';
}

export class DocumentsApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string) {
    super(`Documents API error ${status}`);
    this.status = status;
    this.code = code;
  }
}

const GENERIC_UPLOAD_ERROR = 'Nahrání se nepodařilo. Zkuste to prosím znovu.';

// Odeslání zopakuje API vrstva, sem CSRF chyba dojde, až když selže i opakování.
export function formatApiError(error: unknown) {
  if (!(error instanceof DocumentsApiError)) return GENERIC_UPLOAD_ERROR;
  if (error.status === 400)
    return error.code === 'NO_FILE'
      ? 'Vyberte soubor.'
      : 'Údaje dokladu nejsou platné.';
  if (error.status === 401)
    return 'Byli jste odhlášeni. Přihlaste se prosím znovu.';
  if (error.status === 403)
    return error.code === 'CSRF_REJECTED'
      ? GENERIC_UPLOAD_ERROR
      : 'K tomuto zvířeti nemáte oprávnění.';
  if (error.status === 404) return 'Zvíře nebo doklad nebyl nalezen.';
  if (error.status === 409) return 'Tento doklad už byl doplněn.';
  if (error.status === 413) return 'Soubor je větší než 10 MB.';
  return GENERIC_UPLOAD_ERROR;
}
