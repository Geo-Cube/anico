import { useCallback, useEffect, useState } from 'react';
import { DevTestBar } from './DevTestBar';
import { DocumentOverview } from './DocumentOverview';
import {
  DEFAULT_MOCK_OPTIONS,
  MOCK_ANIMALS,
  listDocuments,
  setMockOptions,
  type MockOptions,
} from './documents-mock';
import {
  formatBirthDate,
  formatBreedName,
  formatDocumentTypeLabel,
  formatDocumentsSummary,
  formatSexLabel,
  formatSpeciesLabel,
  getCurrentDocuments,
  getStatusClass,
  getSummaryStatus,
  type AnimalDocument,
  type DocumentAnimal,
} from './documents-types';
import { LeaveFormModal } from './LeaveFormModal';
import { ResupplyForm } from './ResupplyForm';
import { UploadForm } from './UploadForm';
import styles from './AnimalDocumentsFeature.module.css';

type ScreenView = 'wf03-01-overview' | 'wf03-02-upload' | 'wf03-09-resupply';

export interface FormState {
  is_dirty: boolean;
  is_busy: boolean;
}

const CLEAN_FORM_STATE: FormState = { is_dirty: false, is_busy: false };

export interface AnimalDocumentsFeatureProps {
  animal: DocumentAnimal;
  onBack: () => void;
  /** Cizí zvíře: skryje akce, zůstane jen prohlížení. Určuje rodič. */
  readOnly?: boolean;
}

export function AnimalDocumentsFeature({
  animal,
  onBack,
  readOnly = false,
}: AnimalDocumentsFeatureProps) {
  const currentBreederName = 'Karel Novák';

  // DOČASNÉ: přepínače ukázky, po napojení na detail zvířete odebrat.
  const [selectedAnimalId, setSelectedAnimalId] = useState(animal.id);
  const [isForeignAnimal, setIsForeignAnimal] = useState(false);
  const [devOptions, setDevOptions] =
    useState<MockOptions>(DEFAULT_MOCK_OPTIONS);

  const currentAnimal =
    MOCK_ANIMALS.find((item) => item.id === selectedAnimalId) ?? animal;
  const isReadOnly = readOnly || isForeignAnimal;

  const [currentView, setCurrentView] =
    useState<ScreenView>('wf03-01-overview');
  const [items, setItems] = useState<AnimalDocument[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    text: string;
    type: 'success' | 'warning';
  } | null>(null);

  const [formState, setFormState] = useState(CLEAN_FORM_STATE);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);

  useEffect(() => {
    setMockOptions(devOptions);
  }, [devOptions]);

  useEffect(() => {
    let isCurrent = true;
    setIsLoading(true);
    setApiError(null);
    listDocuments(currentAnimal.id)
      .then((documents) => {
        if (isCurrent) setItems(documents);
      })
      .catch(() => {
        if (isCurrent) setApiError('Doklady se nepodařilo načíst.');
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [currentAnimal.id, reloadKey]);

  const current = getCurrentDocuments(items);
  const resupplyDocument =
    current.find(
      (document) =>
        document.document_id === selectedDocumentId &&
        document.assessment_status === 'REJECTED',
    ) ?? null;

  let view = isReadOnly ? 'wf03-01-overview' : currentView;
  if (view === 'wf03-09-resupply' && !resupplyDocument)
    view = 'wf03-01-overview';

  const summaryStatus = getSummaryStatus(current);

  const showOverview = useCallback(() => {
    setFormState(CLEAN_FORM_STATE);
    setCurrentView('wf03-01-overview');
  }, []);

  // Rozpracovaný formulář se zahazuje jen po potvrzení, během odesílání vůbec.
  const leaveForm = (action: () => void) => {
    if (formState.is_busy) return;
    if (formState.is_dirty) {
      setPendingLeave(() => action);
      return;
    }
    action();
  };

  const handleConfirmLeave = () => {
    pendingLeave?.();
    setPendingLeave(null);
  };

  const addDocument = useCallback((document: AnimalDocument) => {
    setItems((prev) => [...prev, document]);
  }, []);

  const handleAnimalChange = (animalId: string) => {
    leaveForm(() => {
      showOverview();
      setBannerMessage(null);
      setSelectedAnimalId(animalId);
    });
  };

  const handleForeignAnimalChange = (isForeign: boolean) => {
    leaveForm(() => {
      showOverview();
      setIsForeignAnimal(isForeign);
    });
  };

  const handleUploadFinished = useCallback(() => {
    setBannerMessage({
      text: 'Doklady byly odeslány k posouzení.',
      type: 'success',
    });
    showOverview();
  }, [showOverview]);

  const handleResupplied = useCallback(
    (document: AnimalDocument) => {
      addDocument(document);
      setBannerMessage({
        text: 'Nová verze byla odeslána k posouzení.',
        type: 'success',
      });
      showOverview();
    },
    [addDocument, showOverview],
  );

  const handleResupplyConflict = useCallback(() => {
    setBannerMessage({ text: 'Tento doklad už byl doplněn.', type: 'warning' });
    showOverview();
    setReloadKey((key) => key + 1);
  }, [showOverview]);

  const openBreadcrumb = (
    <>
      <button
        type="button"
        className={`${styles.crumbButton} cursor-pointer`}
        onClick={() => leaveForm(onBack)}
      >
        Moje zvířata
      </button>
      <span className="separator">/</span>
    </>
  );

  return (
    <div className="anico-admin-wrapper">
      <DevTestBar
        selectedAnimalId={selectedAnimalId}
        isForeignAnimal={isForeignAnimal}
        options={devOptions}
        isBusy={formState.is_busy}
        onAnimalChange={handleAnimalChange}
        onForeignAnimalChange={handleForeignAnimalChange}
        onOptionsChange={setDevOptions}
        onReload={() => setReloadKey((key) => key + 1)}
      />

      <div className="wf-page">
        <header className="wf-header">
          <div className="wf-header-top">
            <div className="wf-logo">AniCo</div>
            <div className="wf-user-info">{currentBreederName} · Chovatel</div>
          </div>
          <nav className="wf-nav">
            <div className="wf-nav-links">
              <button
                type="button"
                className="wf-nav-link"
                onClick={() => leaveForm(onBack)}
              >
                Můj účet
              </button>
              <button
                type="button"
                className="wf-nav-link active"
                onClick={() => leaveForm(onBack)}
              >
                Moje zvířata
              </button>
            </div>
            <button
              type="button"
              className="wf-nav-logout"
              onClick={() => leaveForm(onBack)}
            >
              Odhlásit
            </button>
          </nav>
        </header>

        <main className="wf-main">
          {bannerMessage && (
            <div
              className={`wf-banner wf-banner-${bannerMessage.type}`}
              role="status"
            >
              <span>{bannerMessage.text}</span>
              <button
                type="button"
                className="wf-banner-close"
                aria-label="Zavřít zprávu"
                onClick={() => setBannerMessage(null)}
              >
                &times;
              </button>
            </div>
          )}

          {view === 'wf03-01-overview' && (
            <section className="fade-in">
              <div className="wf-breadcrumb">
                {openBreadcrumb}
                {currentAnimal.name}
              </div>
              <h1 className="wf-title">{currentAnimal.name}</h1>

              <div className={`wf-filter-group ${styles.tabs}`}>
                <button
                  type="button"
                  className="wf-filter-btn"
                  disabled
                  title="Přehled zvířete řeší UC-02."
                >
                  Přehled
                </button>
                <button
                  type="button"
                  className="wf-filter-btn"
                  disabled
                  title="Fotografie zvířete řeší UC-02."
                >
                  Fotografie
                </button>
                <button type="button" className="wf-filter-btn active">
                  Doklady
                </button>
              </div>

              <div className={styles.layout}>
                <aside className={styles.sidebar}>
                  <div className={styles.photo}>Hlavní fotografie</div>
                  <div className="wf-card">
                    <h2 className="wf-card-title">
                      {formatBreedName(currentAnimal)}
                    </h2>
                    <p className="wf-detail-line">
                      {formatSpeciesLabel(currentAnimal.species)} ·{' '}
                      {formatSexLabel(currentAnimal)}
                    </p>
                    {currentAnimal.birthDate && (
                      <p className="wf-detail-line">
                        {currentAnimal.sex === 'female'
                          ? 'Narozena'
                          : 'Narozen'}{' '}
                        {formatBirthDate(currentAnimal.birthDate)}
                      </p>
                    )}
                  </div>
                </aside>

                <div>
                  <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Doklady zvířete</h2>
                    {!isLoading && !apiError && (
                      <div
                        className={`wf-status-badge ${
                          summaryStatus
                            ? getStatusClass(summaryStatus)
                            : styles.summaryEmpty
                        }`}
                      >
                        {formatDocumentsSummary(current)}
                      </div>
                    )}
                  </div>

                  {isLoading && (
                    <div className="wf-empty-row" role="status">
                      Načítám doklady…
                    </div>
                  )}

                  {!isLoading && apiError && (
                    <div className="wf-banner wf-banner-error" role="alert">
                      <span>{apiError}</span>
                      <button
                        type="button"
                        className="wf-btn wf-btn-outline"
                        onClick={() => setReloadKey((key) => key + 1)}
                      >
                        Zkusit znovu
                      </button>
                    </div>
                  )}

                  {!isLoading && !apiError && (
                    <DocumentOverview
                      animal={currentAnimal}
                      documents={items}
                      readOnly={isReadOnly}
                      onUpload={() => {
                        setBannerMessage(null);
                        setCurrentView('wf03-02-upload');
                      }}
                      onResupply={(documentId) => {
                        setBannerMessage(null);
                        setSelectedDocumentId(documentId);
                        setCurrentView('wf03-09-resupply');
                      }}
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          {view === 'wf03-02-upload' && (
            <section className="fade-in">
              <div className="wf-breadcrumb">
                {openBreadcrumb}
                <button
                  type="button"
                  className={`${styles.crumbButton} cursor-pointer`}
                  onClick={() => leaveForm(showOverview)}
                >
                  {currentAnimal.name}
                </button>
                <span className="separator">/</span>
                Doklady
              </div>
              <h1 className="wf-title">Nahrát doklady</h1>
              <UploadForm
                animal={currentAnimal}
                documents={items}
                onStateChange={setFormState}
                onUploaded={addDocument}
                onFinished={handleUploadFinished}
                onCancel={() => leaveForm(showOverview)}
              />
            </section>
          )}

          {view === 'wf03-09-resupply' && resupplyDocument && (
            <section className="fade-in">
              <div className="wf-breadcrumb">
                {openBreadcrumb}
                <button
                  type="button"
                  className={`${styles.crumbButton} cursor-pointer`}
                  onClick={() => leaveForm(showOverview)}
                >
                  {currentAnimal.name}
                </button>
                <span className="separator">/</span>
                {formatDocumentTypeLabel(
                  resupplyDocument.document_type,
                  currentAnimal.species,
                )}
              </div>
              <h1 className="wf-title">Doplnit doklad</h1>
              <ResupplyForm
                animal={currentAnimal}
                document={resupplyDocument}
                onStateChange={setFormState}
                onResupplied={handleResupplied}
                onConflict={handleResupplyConflict}
                onCancel={() => leaveForm(showOverview)}
              />
            </section>
          )}
        </main>

        {pendingLeave && (
          <LeaveFormModal
            onStay={() => setPendingLeave(null)}
            onLeave={handleConfirmLeave}
          />
        )}
      </div>
    </div>
  );
}
