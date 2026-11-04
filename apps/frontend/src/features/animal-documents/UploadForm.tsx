import { useEffect, useRef, useState } from 'react';
import type { FormState } from './AnimalDocumentsFeature';
import { uploadDocument } from './documents-mock';
import {
  DOCUMENT_TYPES,
  formatApiError,
  formatBreedName,
  formatDocumentTypeLabel,
  formatSpeciesLabel,
  type AnimalDocument,
  type DocumentAnimal,
  type DocumentType,
} from './documents-types';
import {
  MAX_UPLOAD_ROWS,
  getOccupiedTypes,
  validateRows,
  type UploadRowFields,
} from './documents-validation';
import { FilePicker } from './FilePicker';
import styles from './AnimalDocumentsFeature.module.css';

type RowState = 'ready' | 'uploading' | 'uploaded' | 'error';

interface UploadRow extends UploadRowFields {
  state: RowState;
  upload_error: string;
}

function createEmptyRow(row_id: number): UploadRow {
  return {
    row_id,
    document_type: '',
    file: null,
    state: 'ready',
    upload_error: '',
  };
}

function formatRowStatus(row: UploadRow) {
  if (row.state === 'uploading') return 'Nahrává se…';
  if (row.state === 'uploaded') return 'Nahráno';
  if (row.state === 'error') return `Chyba: ${row.upload_error}`;
  return row.document_type && row.file ? 'Připraveno' : '';
}

interface UploadFormProps {
  animal: DocumentAnimal;
  documents: readonly AnimalDocument[];
  onStateChange: (state: FormState) => void;
  onUploaded: (document: AnimalDocument) => void;
  onFinished: () => void;
  onCancel: () => void;
}

export function UploadForm({
  animal,
  documents,
  onStateChange,
  onUploaded,
  onFinished,
  onCancel,
}: UploadFormProps) {
  const nextRowId = useRef(2);
  const [rows, setRows] = useState([createEmptyRow(1)]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  const isDirty = rows.some((row) => row.document_type || row.file);
  useEffect(() => {
    onStateChange({ is_dirty: isDirty, is_busy: isLoading });
  }, [isDirty, isLoading, onStateChange]);

  const failedCount = rows.filter((row) => row.state === 'error').length;
  const occupiedTypes = getOccupiedTypes(documents);
  const rowsToValidate = rows.filter((row) => row.state !== 'uploaded');
  const errors = validateRows(rowsToValidate, occupiedTypes);
  const occupiedLabels = DOCUMENT_TYPES.filter((type) =>
    occupiedTypes.has(type),
  ).map((type) => formatDocumentTypeLabel(type, animal.species));

  const updateRow = (rowId: number, changes: Partial<UploadRow>) => {
    setRows((prev) =>
      prev.map((row) => (row.row_id === rowId ? { ...row, ...changes } : row)),
    );
  };

  const editRow = (rowId: number, changes: Partial<UploadRowFields>) => {
    updateRow(rowId, { ...changes, state: 'ready', upload_error: '' });
  };

  const handleRemoveRow = (rowId: number) => {
    setRows((prev) => {
      if (prev.length > 1) return prev.filter((row) => row.row_id !== rowId);
      return prev.map((row) => createEmptyRow(row.row_id));
    });
  };

  const handleAddRow = () => {
    setRows((prev) => [...prev, createEmptyRow(nextRowId.current)]);
    nextRowId.current += 1;
  };

  const uploadRow = async (row: UploadRow) => {
    if (!row.document_type || !row.file) return false;
    updateRow(row.row_id, { state: 'uploading', upload_error: '' });
    try {
      const document = await uploadDocument({
        animal_id: animal.id,
        document_type: row.document_type,
        file: row.file,
      });
      onUploaded(document);
      updateRow(row.row_id, { state: 'uploaded' });
      return true;
    } catch (error) {
      updateRow(row.row_id, {
        state: 'error',
        upload_error: formatApiError(error),
      });
      return false;
    }
  };

  const finishUploading = (uploaded: number, remainingRows: number) => {
    setIsLoading(false);
    setUploadedCount(uploaded);
    setRows((prev) => prev.filter((row) => row.state !== 'uploaded'));
    if (remainingRows === 0) onFinished();
  };

  const handleSubmit = async () => {
    setShowAllErrors(true);
    const isValid = [...errors.values()].every(
      (error) => !error.type_error && !error.file_error,
    );
    if (!isValid) return;

    setIsLoading(true);
    let uploaded = 0;
    // Backend bere jeden soubor na požadavek, proto se posílá řádek po řádku.
    for (const row of rows) {
      if (await uploadRow(row)) uploaded += 1;
    }
    finishUploading(uploadedCount + uploaded, rows.length - uploaded);
  };

  const handleRetry = async (row: UploadRow) => {
    setIsLoading(true);
    const uploaded = (await uploadRow(row)) ? 1 : 0;
    finishUploading(uploadedCount + uploaded, rows.length - uploaded);
  };

  return (
    <>
      {failedCount > 0 && !isLoading && (
        <div className="wf-banner wf-banner-warning" role="status">
          <span>
            Nahráno {uploadedCount} z {uploadedCount + failedCount} dokladů. U
            zbývajících zkontrolujte chybu.
          </span>
        </div>
      )}

      <h2 className="wf-card-title mb-1">
        {animal.name} · {formatSpeciesLabel(animal.species)} ·{' '}
        {formatBreedName(animal)}
      </h2>
      <p className="wf-detail-line">Číslo čipu: {animal.microchipNumber}</p>

      <div className={`${styles.uploadRows} mt-4`}>
        {rows.map((row, index) => {
          const rowErrors = errors.get(row.row_id);
          const typeError =
            showAllErrors || row.document_type
              ? (rowErrors?.type_error ?? '')
              : '';
          const fileError =
            showAllErrors || row.file ? (rowErrors?.file_error ?? '') : '';
          const typeInputId = `document-type-${row.row_id}`;
          const fileInputId = `document-file-${row.row_id}`;
          const isRowLocked = isLoading || row.state === 'uploaded';

          return (
            <div
              key={row.row_id}
              className={styles.uploadRow}
              role="group"
              aria-label={`Doklad ${index + 1}`}
            >
              <div>
                <label htmlFor={typeInputId} className="wf-label">
                  Typ dokladu <span className="text-danger">*</span>
                </label>
                <select
                  id={typeInputId}
                  className={styles.select}
                  value={row.document_type}
                  disabled={isRowLocked}
                  aria-invalid={typeError ? true : undefined}
                  aria-describedby={
                    typeError ? `${typeInputId}-error` : undefined
                  }
                  onChange={(e) =>
                    editRow(row.row_id, {
                      document_type: e.target.value as DocumentType | '',
                    })
                  }
                >
                  <option value="">Vyberte typ dokladu</option>
                  {DOCUMENT_TYPES.map((type) => {
                    const label = formatDocumentTypeLabel(type, animal.species);
                    const isOccupied = occupiedTypes.has(type);
                    return (
                      <option key={type} value={type} disabled={isOccupied}>
                        {isOccupied ? `${label} – už doloženo` : label}
                      </option>
                    );
                  })}
                </select>
                {typeError && (
                  <p id={`${typeInputId}-error`} className="wf-error-text">
                    {typeError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={fileInputId} className="wf-label">
                  Soubor <span className="text-danger">*</span>
                </label>
                <FilePicker
                  id={fileInputId}
                  file={row.file}
                  error={fileError}
                  disabled={isRowLocked}
                  onChange={(file) => editRow(row.row_id, { file })}
                />
              </div>

              <div className={styles.rowFooter}>
                <p
                  className={
                    row.state === 'error' ? 'wf-error-text' : styles.rowStatus
                  }
                  aria-live="polite"
                >
                  {formatRowStatus(row)}
                </p>
                <div className={styles.rowActions}>
                  {row.state === 'error' && (
                    <button
                      type="button"
                      className="wf-btn wf-btn-outline"
                      onClick={() => handleRetry(row)}
                      disabled={isLoading}
                    >
                      Zkusit znovu
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => handleRemoveRow(row.row_id)}
                    disabled={isRowLocked}
                  >
                    Odebrat
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="wf-btn wf-btn-outline mt-4"
        onClick={handleAddRow}
        disabled={isLoading || rows.length >= MAX_UPLOAD_ROWS}
      >
        Přidat další doklad
      </button>
      {rows.length >= MAX_UPLOAD_ROWS && (
        <p className="wf-helper-text">
          Najednou lze nahrát nejvýše {MAX_UPLOAD_ROWS} dokladů.
        </p>
      )}

      <p className="wf-helper-text">
        PDF, JPEG nebo PNG, max. 10 MB. Vícestránkový doklad nahrajte jako jedno
        PDF.
      </p>
      <p className="wf-helper-text">
        Doklad musí obsahovat číslo čipu zvířete. Každý doklad posuzuje
        administrátor samostatně.
      </p>
      {occupiedLabels.length > 0 && (
        <p className="wf-helper-text">
          Už doloženo: {occupiedLabels.join(', ')}. Tyto typy lze mít jen
          jednou, zamítnutý doklad opravte přes „Doplnit doklad“.
        </p>
      )}

      <div className="wf-detail-footer">
        <button
          type="button"
          className="wf-btn wf-btn-outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Zrušit
        </button>
        <div className="wf-detail-footer-right">
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? 'Nahrávám...' : 'Odeslat k posouzení'}
          </button>
        </div>
      </div>
    </>
  );
}
