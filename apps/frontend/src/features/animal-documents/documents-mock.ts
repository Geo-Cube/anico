// DOČASNÉ: simulace API, dokud backend dokladů není napojený (README, „Napojení na API“).
// Exportované funkce mají tvar budoucího API, obrazovky se při výměně nemění.
import {
  DocumentsApiError,
  formatDateTime,
  type AnimalDocument,
  type DocumentAnimal,
  type DocumentType,
} from './documents-types';

export const DOCUMENTS_API_BASE = '/api/breeding/documents';

const MOCK_DELAY_MS = 250;
const MOCK_OWNER_USER_ID = '7f3c2a10-5b1e-4d7a-9c64-1e2f3a4b5c6d';
const MOCK_TIMESTAMP = '2026-10-01T08:00:00.000Z';

export const MOCK_ANIMALS: readonly [DocumentAnimal, ...DocumentAnimal[]] = [
  {
    id: '65a000000000000000000001',
    ownerUserId: MOCK_OWNER_USER_ID,
    name: 'Rex z Modrého údolí',
    species: 'dog',
    breedId: 'labradorsky-retrivr',
    sex: 'male',
    birthDate: '2022-05-14',
    microchipNumber: '203098100123456',
    createdAt: MOCK_TIMESTAMP,
    updatedAt: MOCK_TIMESTAMP,
  },
  {
    id: '65a000000000000000000002',
    ownerUserId: MOCK_OWNER_USER_ID,
    name: 'Bára z Modrého údolí',
    species: 'dog',
    breedId: 'labradorsky-retrivr',
    sex: 'female',
    birthDate: '2024-03-02',
    microchipNumber: null,
    createdAt: MOCK_TIMESTAMP,
    updatedAt: MOCK_TIMESTAMP,
  },
  {
    id: '65a000000000000000000003',
    ownerUserId: MOCK_OWNER_USER_ID,
    name: 'Hvězda z Modrého údolí',
    species: 'horse',
    breedId: 'cesky-teplokrevnik',
    sex: 'female',
    birthDate: '2019-06-21',
    microchipNumber: '203098100654321',
    createdAt: MOCK_TIMESTAMP,
    updatedAt: MOCK_TIMESTAMP,
  },
];

const REX_ID = MOCK_ANIMALS[0].id;

const INITIAL_MOCK_DATA: AnimalDocument[] = [
  {
    document_id: 'doc-1',
    animal_id: REX_ID,
    document_type: 'PEDIGREE',
    version_number: 1,
    previous_document_id: null,
    file: {
      file_name: 'Prukaz-puvodu.pdf',
      file_reference: '/files/Prukaz-puvodu.pdf',
    },
    assessment_status: 'APPROVED',
    submitted_at: '29. 10. 2026, 18:05',
    reviewed_at: '30. 10. 2026, 10:40',
    rejection_reason: null,
  },
  {
    document_id: 'doc-2',
    animal_id: REX_ID,
    document_type: 'HEALTH_RESULTS',
    version_number: 1,
    previous_document_id: null,
    file: {
      file_name: 'Zdravotni-vysledky.pdf',
      file_reference: '/files/Zdravotni-vysledky.pdf',
    },
    assessment_status: 'REJECTED',
    submitted_at: '29. 10. 2026, 18:06',
    reviewed_at: '30. 10. 2026, 10:45',
    rejection_reason: 'Na dokumentu chybí datum vyšetření.',
  },
  {
    document_id: 'doc-3',
    animal_id: REX_ID,
    document_type: 'BREEDING_APPROVAL',
    version_number: 1,
    previous_document_id: null,
    file: {
      file_name: 'Potvrzeni-o-uchovneni.jpg',
      file_reference: '/files/Potvrzeni-o-uchovneni.jpg',
    },
    assessment_status: 'REJECTED',
    submitted_at: '29. 10. 2026, 18:07',
    reviewed_at: '30. 10. 2026, 11:02',
    rejection_reason: 'Nečitelný sken.',
  },
  {
    document_id: 'doc-4',
    animal_id: REX_ID,
    document_type: 'BREEDING_APPROVAL',
    version_number: 2,
    previous_document_id: 'doc-3',
    file: {
      file_name: 'Potvrzeni-o-uchovneni-v2.pdf',
      file_reference: '/files/Potvrzeni-o-uchovneni-v2.pdf',
    },
    assessment_status: 'PENDING',
    submitted_at: '31. 10. 2026, 08:30',
    reviewed_at: null,
    rejection_reason: null,
  },
];

export interface MockOptions {
  upload_error: 'off' | 'all' | 'every_second';
  simulate_csrf: boolean;
  simulate_conflict: boolean;
  simulate_load_error: boolean;
}

export const DEFAULT_MOCK_OPTIONS: MockOptions = {
  upload_error: 'off',
  simulate_csrf: false,
  simulate_conflict: false,
  simulate_load_error: false,
};

let documents = [...INITIAL_MOCK_DATA];
let options = DEFAULT_MOCK_OPTIONS;
let nextDocumentNumber = INITIAL_MOCK_DATA.length + 1;
let uploadAttempts = 0;
let csrfTokenFresh = false;

// Volá jen dev-test-bar. Stavy se nikdy neodvozují z názvu souboru.
export function setMockOptions(next: MockOptions) {
  options = next;
  uploadAttempts = 0;
}

function delay() {
  return new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));
}

function throwSimulatedWriteError() {
  if (options.simulate_csrf && !csrfTokenFresh)
    throw new DocumentsApiError(403, 'CSRF_REJECTED');
  uploadAttempts += 1;
  const failsEverySecond =
    options.upload_error === 'every_second' && uploadAttempts % 2 === 0;
  if (options.upload_error === 'all' || failsEverySecond)
    throw new DocumentsApiError(500);
}

// Skutečná verze znovu načte /api/auth/session a vezme nový csrfToken.
async function refreshCsrfToken() {
  await delay();
  csrfTokenFresh = true;
}

// 403 CSRF_REJECTED se opakuje právě jednou (ZADANI, kap. 5).
async function withCsrfRetry<T>(send: () => Promise<T>) {
  csrfTokenFresh = false;
  try {
    return await send();
  } catch (error) {
    const isCsrfError =
      error instanceof DocumentsApiError && error.code === 'CSRF_REJECTED';
    if (!isCsrfError) throw error;
    await refreshCsrfToken();
    return send();
  }
}

function createDocument(
  fields: Pick<
    AnimalDocument,
    'animal_id' | 'document_type' | 'version_number' | 'previous_document_id'
  >,
  file: File,
) {
  const document_id = `doc-${nextDocumentNumber}`;
  nextDocumentNumber += 1;
  const document: AnimalDocument = {
    ...fields,
    document_id,
    file: { file_name: file.name, file_reference: fileUrl(document_id) },
    assessment_status: 'PENDING',
    submitted_at: formatDateTime(new Date()),
    reviewed_at: null,
    rejection_reason: null,
  };
  documents = [...documents, document];
  return document;
}

export async function listDocuments(
  animal_id: string,
): Promise<AnimalDocument[]> {
  await delay();
  if (options.simulate_load_error) throw new DocumentsApiError(500);
  return documents.filter((document) => document.animal_id === animal_id);
}

export function uploadDocument(input: {
  animal_id: string;
  document_type: DocumentType;
  file: File;
}): Promise<AnimalDocument> {
  return withCsrfRetry(async () => {
    await delay();
    throwSimulatedWriteError();
    return createDocument(
      {
        animal_id: input.animal_id,
        document_type: input.document_type,
        version_number: 1,
        previous_document_id: null,
      },
      input.file,
    );
  });
}

export function uploadNewVersion(input: {
  previous_document_id: string;
  file: File;
}): Promise<AnimalDocument> {
  return withCsrfRetry(async () => {
    await delay();
    throwSimulatedWriteError();
    const previous = documents.find(
      (document) => document.document_id === input.previous_document_id,
    );
    if (!previous) throw new DocumentsApiError(404);
    const newVersion = {
      animal_id: previous.animal_id,
      document_type: previous.document_type,
      version_number: previous.version_number + 1,
      previous_document_id: previous.document_id,
    };
    const isReplaced = documents.some(
      (document) => document.previous_document_id === previous.document_id,
    );
    if (isReplaced || previous.assessment_status !== 'REJECTED')
      throw new DocumentsApiError(409);
    // Souběh: stejný doklad mezitím doplnil někdo jiný, třeba druhá karta.
    if (options.simulate_conflict) {
      createDocument(newVersion, input.file);
      throw new DocumentsApiError(409);
    }
    return createDocument(newVersion, input.file);
  });
}

export function fileUrl(document_id: string) {
  return `${DOCUMENTS_API_BASE}/${document_id}`;
}
