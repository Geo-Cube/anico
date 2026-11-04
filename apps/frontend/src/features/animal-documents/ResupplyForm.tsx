import { useEffect, useState } from 'react';
import type { FormState } from './AnimalDocumentsFeature';
import { fileUrl, uploadNewVersion } from './documents-mock';
import {
  DocumentsApiError,
  formatApiError,
  formatDocumentTypeLabel,
  type AnimalDocument,
  type DocumentAnimal,
} from './documents-types';
import { validateFile } from './documents-validation';
import { FilePicker } from './FilePicker';
import styles from './AnimalDocumentsFeature.module.css';

interface ResupplyFormProps {
  animal: DocumentAnimal;
  document: AnimalDocument;
  onStateChange: (state: FormState) => void;
  onResupplied: (document: AnimalDocument) => void;
  onConflict: () => void;
  onCancel: () => void;
}

export function ResupplyForm({
  animal,
  document,
  onStateChange,
  onResupplied,
  onConflict,
  onCancel,
}: ResupplyFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [wasSubmitted, setWasSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const isDirty = file !== null;
  useEffect(() => {
    onStateChange({ is_dirty: isDirty, is_busy: isLoading });
  }, [isDirty, isLoading, onStateChange]);

  const fileError = file || wasSubmitted ? validateFile(file) : '';

  const handleSubmit = async () => {
    setWasSubmitted(true);
    if (!file || validateFile(file)) return;

    setIsLoading(true);
    setApiError(null);
    try {
      const newVersion = await uploadNewVersion({
        previous_document_id: document.document_id,
        file,
      });
      onResupplied(newVersion);
    } catch (error) {
      setIsLoading(false);
      if (error instanceof DocumentsApiError && error.status === 409) {
        onConflict();
        return;
      }
      setApiError(formatApiError(error));
    }
  };

  return (
    <>
      {apiError && (
        <div className="wf-banner wf-banner-error" role="alert">
          <span>{apiError}</span>
          <button
            type="button"
            className="wf-banner-close"
            aria-label="Zavřít zprávu"
            onClick={() => setApiError(null)}
          >
            &times;
          </button>
        </div>
      )}

      <div className="wf-card">
        <h2 className="wf-card-title mb-1">
          {formatDocumentTypeLabel(document.document_type, animal.species)} –{' '}
          {animal.name}
        </h2>
        <p className="mt-2 text-danger">
          <strong>Důvod zamítnutí:</strong> {document.rejection_reason}
        </p>
        <p className="wf-detail-line wf-text-muted">
          Verze {document.version_number} · posouzeno {document.reviewed_at}
        </p>
        <p className="wf-detail-line">
          <a
            className={styles.linkButton}
            href={fileUrl(document.document_id)}
            download={document.file.file_name}
          >
            Otevřít verzi {document.version_number}
          </a>
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="new-version-file" className="wf-label">
          Nová verze dokladu <span className="text-danger">*</span>
        </label>
        <FilePicker
          id="new-version-file"
          file={file}
          error={fileError}
          disabled={isLoading}
          onChange={(selected) => {
            setFile(selected);
            setApiError(null);
          }}
        />
      </div>

      <p className="wf-helper-text">
        PDF, JPEG nebo PNG, max. 10 MB. Vícestránkový doklad nahrajte jako jedno
        PDF.
      </p>
      <p className="wf-helper-text">
        Doklad musí obsahovat číslo čipu zvířete. Každý doklad posuzuje
        administrátor samostatně.
      </p>
      <p className="wf-helper-text">
        Nová verze: {document.version_number + 1}. Původní soubor a rozhodnutí
        zůstanou v historii. Po odeslání bude nová verze čekat na posouzení.
      </p>

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
            {isLoading ? 'Nahrávám...' : 'Odeslat novou verzi'}
          </button>
        </div>
      </div>
    </>
  );
}
