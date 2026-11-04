import { useState } from 'react';
import { fileUrl } from './documents-mock';
import {
  formatDocumentTypeLabel,
  formatStatusLabel,
  getCurrentDocuments,
  getFileFormat,
  getStatusClass,
  getVersionHistory,
  type AnimalDocument,
  type DocumentAnimal,
} from './documents-types';
import styles from './AnimalDocumentsFeature.module.css';

interface DocumentOverviewProps {
  animal: DocumentAnimal;
  documents: readonly AnimalDocument[];
  readOnly: boolean;
  onUpload: () => void;
  onResupply: (documentId: string) => void;
}

export function DocumentOverview({
  animal,
  documents,
  readOnly,
  onUpload,
  onResupply,
}: DocumentOverviewProps) {
  const current = getCurrentDocuments(documents);
  const hasMicrochip = Boolean(animal.microchipNumber);
  const hasPending = current.some(
    (document) => document.assessment_status === 'PENDING',
  );

  return (
    <>
      {current.length === 0 ? (
        <div className="wf-empty-row">
          <p className="wf-card-subtitle">
            Zatím nebyly přidány žádné doklady.
          </p>
          {!readOnly && (
            <p className="mt-2">
              Můžete doložit původ, zdravotní výsledky nebo uchovnění. Ověřené
              doklady se zobrazí u nabídek vašeho zvířete.
            </p>
          )}
        </div>
      ) : (
        <div className={styles.documentList}>
          {current.map((document) => (
            <DocumentCard
              key={document.document_id}
              animal={animal}
              document={document}
              documents={documents}
              canResupply={!readOnly}
              hasMicrochip={hasMicrochip}
              onResupply={onResupply}
            />
          ))}
        </div>
      )}

      {hasPending && !readOnly && (
        <p className="wf-helper-text">
          Doklady čekají na posouzení administrátorem. Výsledek uvidíte zde.
        </p>
      )}

      {!readOnly && (
        <div className={`${styles.pageActions} mt-4`}>
          {!hasMicrochip && (
            <p id="missing-microchip-hint" className="wf-helper-text">
              Pro nahrání dokladů nejprve doplňte číslo čipu v profilu zvířete.
            </p>
          )}
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={onUpload}
            disabled={!hasMicrochip}
            aria-describedby={
              hasMicrochip ? undefined : 'missing-microchip-hint'
            }
          >
            Nahrát doklady
          </button>
        </div>
      )}
    </>
  );
}

interface DocumentCardProps {
  animal: DocumentAnimal;
  document: AnimalDocument;
  documents: readonly AnimalDocument[];
  canResupply: boolean;
  hasMicrochip: boolean;
  onResupply: (documentId: string) => void;
}

function DocumentCard({
  animal,
  document,
  documents,
  canResupply,
  hasMicrochip,
  onResupply,
}: DocumentCardProps) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const history = getVersionHistory(document, documents);
  const historyId = `document-history-${document.document_id}`;

  return (
    <article className="wf-card">
      <div className={styles.cardHeader}>
        <h3 className="wf-card-title mb-1">
          {formatDocumentTypeLabel(document.document_type, animal.species)}
        </h3>
        <span
          className={`wf-status-pill ${getStatusClass(document.assessment_status)}`}
        >
          {formatStatusLabel(document.assessment_status)}
        </span>
      </div>

      <div className="wf-file-box mt-4">
        <div className="wf-file-icon">📄</div>
        <div className="wf-file-info">
          <p className="wf-file-name">{document.file.file_name}</p>
          <p className="wf-file-format wf-text-muted">
            Formát: {getFileFormat(document.file.file_name)}
          </p>
        </div>
        <a
          className={`wf-btn wf-btn-outline ${styles.fileAction}`}
          href={fileUrl(document.document_id)}
          download={document.file.file_name}
        >
          Otevřít
        </a>
      </div>

      <p className="wf-detail-line wf-text-muted mt-4">
        {formatDocumentMeta(document)}
      </p>

      {document.rejection_reason && (
        <p className="mt-2 text-danger">
          <strong>Důvod zamítnutí:</strong> {document.rejection_reason}
        </p>
      )}

      {(history.length > 0 ||
        (canResupply && document.assessment_status === 'REJECTED')) && (
        <div className={`${styles.cardActions} mt-4`}>
          {history.length > 0 ? (
            <button
              type="button"
              className={styles.linkButton}
              aria-expanded={isHistoryOpen}
              aria-controls={historyId}
              onClick={() => setIsHistoryOpen((open) => !open)}
            >
              {isHistoryOpen
                ? 'Skrýt historii'
                : `Zobrazit historii (${history.length})`}
            </button>
          ) : (
            <span />
          )}
          {canResupply && document.assessment_status === 'REJECTED' && (
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              onClick={() => onResupply(document.document_id)}
              disabled={!hasMicrochip}
            >
              Doplnit doklad
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div id={historyId} hidden={!isHistoryOpen}>
          <ul className={`wf-decision-info fade-in ${styles.historyList}`}>
            {history.map((version) => (
              <li key={version.document_id} className={styles.historyItem}>
                <div className={styles.cardHeader}>
                  <strong>Verze {version.version_number}</strong>
                  <span
                    className={`wf-status-pill ${getStatusClass(version.assessment_status)}`}
                  >
                    {formatStatusLabel(version.assessment_status)}
                  </span>
                </div>
                <div className={`${styles.historyFile} mt-2`}>
                  <p className="wf-file-name">{version.file.file_name}</p>
                  <a
                    className={styles.linkButton}
                    href={fileUrl(version.document_id)}
                    download={version.file.file_name}
                    aria-label={`Otevřít verzi ${version.version_number}`}
                  >
                    Otevřít
                  </a>
                </div>
                <p className="wf-detail-line wf-text-muted">
                  Odesláno {version.submitted_at}
                </p>
                {version.reviewed_at && (
                  <p className="wf-detail-line wf-text-muted">
                    Posouzeno {version.reviewed_at}
                  </p>
                )}
                {version.rejection_reason && (
                  <p className="mt-2 text-danger">
                    <strong>Důvod zamítnutí:</strong> {version.rejection_reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function formatDocumentMeta(document: AnimalDocument) {
  if (document.reviewed_at)
    return `Verze ${document.version_number} · posouzeno ${document.reviewed_at}`;
  if (document.version_number > 1)
    return `Verze ${document.version_number} · odesláno ${document.submitted_at}`;
  return `Odesláno ${document.submitted_at}`;
}
