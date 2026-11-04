import type { AnimalDocument, DocumentType } from './documents-types';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 5;

const ALLOWED_FILES: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
};

export const FILE_INPUT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';

// Tyto typy smějí mít u zvířete jen jeden řetězec verzí.
const SINGLE_CHAIN_TYPES: readonly DocumentType[] = [
  'PEDIGREE',
  'BREEDING_APPROVAL',
];

export function getOccupiedTypes(documents: readonly AnimalDocument[]) {
  return new Set(
    documents
      .map((document) => document.document_type)
      .filter((type) => SINGLE_CHAIN_TYPES.includes(type)),
  );
}

// Formát a velikost musí zachytit klient, backend je dnes vrací jako 500.
export function validateFile(file: File | null) {
  if (!file) return 'Vyberte soubor.';
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_FILES[file.type]?.includes(extension))
    return 'Nepovolený formát. Povolené jsou PDF, JPEG a PNG.';
  if (file.size > MAX_FILE_SIZE_BYTES) return 'Soubor je větší než 10 MB.';
  return '';
}

export interface UploadRowFields {
  row_id: number;
  document_type: DocumentType | '';
  file: File | null;
}

export interface UploadRowErrors {
  type_error: string;
  file_error: string;
}

export function validateRows(
  rows: readonly UploadRowFields[],
  occupiedTypes: ReadonlySet<DocumentType>,
) {
  const seenTypes = new Set<DocumentType>();
  const errors = new Map<number, UploadRowErrors>();
  for (const row of rows) {
    let typeError = '';
    if (!row.document_type) {
      typeError = 'Vyberte typ dokladu.';
    } else if (occupiedTypes.has(row.document_type)) {
      typeError = 'Tento typ dokladu už u zvířete existuje.';
    } else if (
      seenTypes.has(row.document_type) &&
      SINGLE_CHAIN_TYPES.includes(row.document_type)
    ) {
      typeError = 'Tento typ dokladu může být ve formuláři jen jednou.';
    }
    if (row.document_type) seenTypes.add(row.document_type);
    errors.set(row.row_id, {
      type_error: typeError,
      file_error: validateFile(row.file),
    });
  }
  return errors;
}
