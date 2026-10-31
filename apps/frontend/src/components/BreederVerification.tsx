import { useState } from 'react';

type VerificationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type ScreenView = 'wf04-overview' | 'wf05-queue' | 'wf07-detail';

interface SharedFile {
  file_name: string;
  file_reference: string;
}

interface Breeder {
  breeder_id: string;
  first_name: string;
  last_name: string;
  email_address: string;
  has_breeding_station: boolean;
  breeding_station_name: string;
  breeding_station_number: string;
  is_verified: boolean;
}

interface VerificationRequest {
  verification_request_id: string;
  breeder_id: string;
  status: VerificationStatus;
  submitted_at: string;
  breeding_station_certificate: SharedFile;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
}

interface BreederRequestItem {
  breeder: Breeder;
  verification_request: VerificationRequest;
}

const INITIAL_MOCK_DATA: BreederRequestItem[] = [
  {
    breeder: {
      breeder_id: 'b-1',
      first_name: 'Karel',
      last_name: 'Novák',
      email_address: 'karel.novak@example.com',
      has_breeding_station: true,
      breeding_station_name: 'Modré údolí',
      breeding_station_number: '1234/2024',
      is_verified: false,
    },
    verification_request: {
      verification_request_id: 'vr-1',
      breeder_id: 'b-1',
      status: 'PENDING',
      submitted_at: '30. 10. 2026, 09:15',
      breeding_station_certificate: {
        file_name: 'Certifikat-Modre-udoli.pdf',
        file_reference: '/files/Certifikat-Modre-udoli.pdf',
      },
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
    },
  },
  {
    breeder: {
      breeder_id: 'b-2',
      first_name: 'Lucie',
      last_name: 'Svobodová',
      email_address: 'lucie.svobodova@example.com',
      has_breeding_station: true,
      breeding_station_name: 'Stříbrný vítr',
      breeding_station_number: '5678/2025',
      is_verified: false,
    },
    verification_request: {
      verification_request_id: 'vr-2',
      breeder_id: 'b-2',
      status: 'PENDING',
      submitted_at: '30. 10. 2026, 09:25',
      breeding_station_certificate: {
        file_name: 'Certifikat-Stribrny-vitr.pdf',
        file_reference: '/files/Certifikat-Stribrny-vitr.pdf',
      },
      reviewed_by: null,
      reviewed_at: null,
      rejection_reason: null,
    },
  },
];

export function BreederVerification() {
  const [userRole, setUserRole] = useState<'admin' | 'user'>('admin');
  const currentAdminName = 'Eva Novotná';

  const [currentView, setCurrentView] = useState<ScreenView>('wf04-overview');
  const [items, setItems] = useState<BreederRequestItem[]>(INITIAL_MOCK_DATA);
  const [statusFilter, setStatusFilter] =
    useState<VerificationStatus>('PENDING');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    null,
  );

  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionError, setRejectionError] = useState('');

  const [bannerMessage, setBannerMessage] = useState<{
    text: string;
    type: 'success' | 'warning';
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [simulateConflict409, setSimulateConflict409] = useState(false);

  const pendingRequestsCount = items.filter(
    (item) => item.verification_request.status === 'PENDING',
  ).length;
  const pendingAnimalDocsCount = 0;

  const selectedItem =
    items.find(
      (item) =>
        item.verification_request.verification_request_id === selectedRequestId,
    ) || null;
  const filteredItems = items.filter(
    (item) => item.verification_request.status === statusFilter,
  );

  const formatRequestStatusLabel = (status: VerificationStatus) => {
    if (status === 'PENDING') return 'K posouzení';
    if (status === 'APPROVED') return 'Účet ověřený';
    return 'Zamítnuto';
  };

  const getStatusClass = (status: VerificationStatus) => {
    if (status === 'PENDING') return 'status-pending';
    if (status === 'APPROVED') return 'status-approved';
    return 'status-rejected';
  };

  const formatPendingCountText = (count: number) => {
    if (count === 1) return '1 žádost čeká na posouzení';
    if (count >= 2 && count <= 4) return `${count} žádosti čekají na posouzení`;
    return `${count} žádostí čeká na posouzení`;
  };

  const handleOpenDetail = (verificationRequestId: string) => {
    setSelectedRequestId(verificationRequestId);
    setIsRejectModalOpen(false);
    setRejectionReason('');
    setRejectionError('');
    setApiError(null);
    setCurrentView('wf07-detail');
  };

  const handleApprove = () => {
    if (!selectedItem) return;
    setIsLoading(true);
    setApiError(null);

    setTimeout(() => {
      setIsLoading(false);

      if (simulateConflict409) {
        const conflictItem: BreederRequestItem = {
          breeder: { ...selectedItem.breeder, is_verified: false },
          verification_request: {
            ...selectedItem.verification_request,
            status: 'REJECTED',
            reviewed_by: 'Jan Dvořák',
            reviewed_at: '30. 10. 2026, 09:40',
            rejection_reason: 'Nečitelný certifikát chovatelské stanice.',
          },
        };
        setItems((prev) =>
          prev.map((item) =>
            item.verification_request.verification_request_id ===
            selectedItem.verification_request.verification_request_id
              ? conflictItem
              : item,
          ),
        );
        setBannerMessage({
          text: 'Konflikt (409): Jiný administrátor už o této žádosti rozhodl. Zobrazuji uložený výsledek.',
          type: 'warning',
        });
        return;
      }

      const now = new Date().toLocaleString('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      setItems((prev) =>
        prev.map((item) =>
          item.verification_request.verification_request_id ===
          selectedItem.verification_request.verification_request_id
            ? {
                breeder: { ...item.breeder, is_verified: true },
                verification_request: {
                  ...item.verification_request,
                  status: 'APPROVED',
                  reviewed_by: currentAdminName,
                  reviewed_at: now,
                  rejection_reason: null,
                },
              }
            : item,
        ),
      );
      setBannerMessage({
        text: 'Ověření účtu bylo schváleno. Výsledek byl odeslán e-mailem.',
        type: 'success',
      });
      setStatusFilter('PENDING');
      setCurrentView('wf05-queue');
    }, 250);
  };

  const handleConfirmReject = () => {
    if (!selectedItem) return;
    if (!rejectionReason.trim()) {
      setRejectionError('Důvod zamítnutí je povinný.');
      return;
    }
    setIsLoading(true);
    setRejectionError('');
    setApiError(null);

    setTimeout(() => {
      setIsLoading(false);

      if (simulateConflict409) {
        const conflictItem: BreederRequestItem = {
          breeder: { ...selectedItem.breeder, is_verified: true },
          verification_request: {
            ...selectedItem.verification_request,
            status: 'APPROVED',
            reviewed_by: 'Jan Dvořák',
            reviewed_at: '30. 10. 2026, 09:42',
            rejection_reason: null,
          },
        };
        setItems((prev) =>
          prev.map((item) =>
            item.verification_request.verification_request_id ===
            selectedItem.verification_request.verification_request_id
              ? conflictItem
              : item,
          ),
        );
        setIsRejectModalOpen(false);
        setBannerMessage({
          text: 'Konflikt (409): Jiný administrátor už o této žádosti rozhodl. Zobrazuji uložený výsledek.',
          type: 'warning',
        });
        return;
      }

      const now = new Date().toLocaleString('cs-CZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      setItems((prev) =>
        prev.map((item) =>
          item.verification_request.verification_request_id ===
          selectedItem.verification_request.verification_request_id
            ? {
                breeder: { ...item.breeder, is_verified: false },
                verification_request: {
                  ...item.verification_request,
                  status: 'REJECTED',
                  reviewed_by: currentAdminName,
                  reviewed_at: now,
                  rejection_reason: rejectionReason.trim(),
                },
              }
            : item,
        ),
      );
      setIsRejectModalOpen(false);
      setBannerMessage({
        text: 'Ověření účtu bylo zamítnuto. Výsledek byl odeslán e-mailem.',
        type: 'success',
      });
      setStatusFilter('PENDING');
      setCurrentView('wf05-queue');
    }, 250);
  };

  return (
    <div className="anico-admin-wrapper">
      <div className="dev-test-bar">
        <span>
          🛠️ <strong>Testování DoD:</strong>
        </span>
        <label>
          Role:{' '}
          <select
            value={userRole}
            onChange={(e) => setUserRole(e.target.value as 'admin' | 'user')}
          >
            <option value="admin">Administrátor</option>
            <option value="user">Nepřihlášen</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={simulateConflict409}
            onChange={(e) => setSimulateConflict409(e.target.checked)}
          />{' '}
          Simulovat 409 (Konflikt)
        </label>
        <button
          type="button"
          className="dev-btn"
          onClick={() =>
            setApiError((prev) =>
              prev
                ? null
                : 'Při ukládání došlo k chybě komunikace se serverem. Zkuste operaci zopakovat.',
            )
          }
        >
          {apiError ? 'Skrýt chybu serveru' : 'Simulovat chybu 500'}
        </button>
      </div>

      {userRole !== 'admin' ? (
        <div className="wf-access-denied">
          <h2>Přístup odepřen</h2>
          <p>
            Toto administrační rozhraní je dostupné pouze pro roli
            Administrátor.
          </p>
        </div>
      ) : (
        <div className="wf-page">
          <header className="wf-header">
            <div className="wf-header-top">
              <div className="wf-logo">AniCo</div>
              <div className="wf-user-info">
                {currentAdminName} · Administrátor
              </div>
            </div>
            <nav className="wf-nav">
              <div className="wf-nav-links">
                <button
                  type="button"
                  className={`wf-nav-link ${currentView === 'wf04-overview' ? 'active' : ''}`}
                  onClick={() => setCurrentView('wf04-overview')}
                >
                  Přehled
                </button>
                <button
                  type="button"
                  className={`wf-nav-link ${currentView === 'wf05-queue' || currentView === 'wf07-detail' ? 'active' : ''}`}
                  onClick={() => setCurrentView('wf05-queue')}
                >
                  Žádosti chovatelů
                </button>
                <button
                  type="button"
                  className="wf-nav-link"
                  onClick={() =>
                    alert(
                      'Sekce Doklady zvířat je řešena v samostatném úkolu US-03.',
                    )
                  }
                >
                  Doklady zvířat
                </button>
              </div>
              <button
                type="button"
                className="wf-nav-logout"
                onClick={() => setUserRole('user')}
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
                  onClick={() => setBannerMessage(null)}
                >
                  &times;
                </button>
              </div>
            )}

            {apiError && (
              <div className="wf-banner wf-banner-error" role="alert">
                <span>{apiError}</span>
                <button
                  type="button"
                  className="wf-banner-close"
                  onClick={() => setApiError(null)}
                >
                  &times;
                </button>
              </div>
            )}

            {currentView === 'wf04-overview' && (
              <section className="fade-in">
                <h1 className="wf-title">Přehled</h1>
                <div className="wf-cards-grid">
                  <div className="wf-card">
                    <div>
                      <h2 className="wf-card-title">Ověření chovatelů</h2>
                      <p className="wf-card-text">
                        {formatPendingCountText(pendingRequestsCount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="wf-btn wf-btn-primary wf-btn-full"
                      onClick={() => {
                        setStatusFilter('PENDING');
                        setCurrentView('wf05-queue');
                      }}
                    >
                      Zobrazit žádosti
                    </button>
                  </div>
                  <div className="wf-card">
                    <div>
                      <h2 className="wf-card-title">Doklady zvířat</h2>
                      <p className="wf-card-text">
                        {pendingAnimalDocsCount} dokladů čeká na posouzení
                      </p>
                    </div>
                    <button
                      type="button"
                      className="wf-btn wf-btn-outline wf-btn-full"
                      onClick={() =>
                        alert('Fronta dokladů zvířat je součástí úkolu US-03.')
                      }
                    >
                      Zobrazit doklady
                    </button>
                  </div>
                </div>
              </section>
            )}

            {currentView === 'wf05-queue' && (
              <section className="fade-in">
                <h1 className="wf-title">Žádosti chovatelů</h1>
                <div className="wf-filter-group">
                  <button
                    type="button"
                    className={`wf-filter-btn ${statusFilter === 'PENDING' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('PENDING')}
                  >
                    Čekající
                  </button>
                  <button
                    type="button"
                    className={`wf-filter-btn ${statusFilter === 'APPROVED' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('APPROVED')}
                  >
                    Schválené
                  </button>
                  <button
                    type="button"
                    className={`wf-filter-btn ${statusFilter === 'REJECTED' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('REJECTED')}
                  >
                    Zamítnuté
                  </button>
                </div>
                <div className="wf-table-container">
                  <div className="wf-table-header">
                    <div>Chovatel</div>
                    <div>Typ chovatele</div>
                    <div>Odesláno</div>
                    <div>Stav</div>
                    <div />
                  </div>
                  {filteredItems.length === 0 ? (
                    <div className="wf-empty-row">
                      V tomto stavu nejsou žádné žádosti chovatelů.
                    </div>
                  ) : (
                    filteredItems.map(({ breeder, verification_request }) => (
                      <div
                        key={verification_request.verification_request_id}
                        className="wf-table-row fade-in"
                      >
                        <div className="wf-col-breeder">
                          {breeder.first_name} {breeder.last_name}
                        </div>
                        <div className="wf-text-muted">
                          {breeder.has_breeding_station
                            ? 'Chovatelská stanice'
                            : '-'}
                        </div>
                        <div className="wf-text-muted">
                          {verification_request.submitted_at}
                        </div>
                        <div>
                          <span
                            className={`wf-status-pill ${getStatusClass(verification_request.status)}`}
                          >
                            {formatRequestStatusLabel(
                              verification_request.status,
                            )}
                          </span>
                        </div>
                        <div className="wf-col-action">
                          <button
                            type="button"
                            className="wf-btn wf-btn-outline"
                            onClick={() =>
                              handleOpenDetail(
                                verification_request.verification_request_id,
                              )
                            }
                          >
                            Posoudit
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )}

            {currentView === 'wf07-detail' && selectedItem && (
              <section className="fade-in">
                <div className="wf-breadcrumb">
                  <span
                    className="cursor-pointer"
                    onClick={() => setCurrentView('wf05-queue')}
                  >
                    Žádosti chovatelů
                  </span>{' '}
                  <span className="separator">/</span>{' '}
                  {selectedItem.breeder.first_name}{' '}
                  {selectedItem.breeder.last_name}
                </div>
                <h1 className="wf-title">Posoudit žádost chovatele</h1>
                <div className="wf-cards-grid">
                  <div className="wf-card wf-detail-card">
                    <h2 className="wf-card-title">
                      {selectedItem.breeder.first_name}{' '}
                      {selectedItem.breeder.last_name}
                    </h2>
                    <p className="wf-detail-line wf-text-muted">
                      {selectedItem.breeder.email_address}
                    </p>
                    <p className="wf-detail-line mt-4">
                      <strong>Chovatelská stanice:</strong>{' '}
                      {selectedItem.breeder.breeding_station_name}
                    </p>
                    <p className="wf-detail-line">
                      <strong>Registrační číslo:</strong>{' '}
                      {selectedItem.breeder.breeding_station_number}
                    </p>
                    <p className="wf-detail-line">
                      <strong>Odesláno:</strong>{' '}
                      {selectedItem.verification_request.submitted_at}
                    </p>
                  </div>
                  <div className="wf-card wf-detail-card">
                    <div>
                      <h2 className="wf-card-title mb-1">Přiložený soubor</h2>
                      <h3 className="wf-card-subtitle wf-text-muted">
                        Certifikát stanice
                      </h3>
                      <div className="wf-file-box mt-4">
                        <div className="wf-file-icon">📄</div>
                        <div className="wf-file-info">
                          <p className="wf-file-name">
                            {
                              selectedItem.verification_request
                                .breeding_station_certificate.file_name
                            }
                          </p>
                          <p className="wf-file-format wf-text-muted">
                            Formát: PDF
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="wf-card-right-action mt-4">
                      <button
                        type="button"
                        className="wf-btn wf-btn-outline wf-btn-full"
                        onClick={() =>
                          alert(
                            `Otevírám soubor: ${selectedItem.verification_request.breeding_station_certificate.file_name}`,
                          )
                        }
                      >
                        Otevřít dokument
                      </button>
                    </div>
                  </div>
                </div>

                <div className="wf-status-section">
                  <div
                    className={`wf-status-badge ${getStatusClass(selectedItem.verification_request.status)}`}
                  >
                    {formatRequestStatusLabel(
                      selectedItem.verification_request.status,
                    )}
                  </div>
                  <p className="wf-helper-text">
                    Údaje a přílohu porovnejte s příslušnou evidencí chovu.
                  </p>
                  {selectedItem.verification_request.reviewed_by && (
                    <div className="wf-decision-info fade-in">
                      <p>
                        <strong>Rozhodnutí:</strong>{' '}
                        {selectedItem.verification_request.reviewed_by} (
                        {selectedItem.verification_request.reviewed_at})
                      </p>
                      {selectedItem.verification_request.rejection_reason && (
                        <p className="mt-2 text-danger">
                          <strong>Důvod zamítnutí:</strong>{' '}
                          {selectedItem.verification_request.rejection_reason}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="wf-detail-footer">
                  <button
                    type="button"
                    className="wf-btn wf-btn-outline"
                    onClick={() => setCurrentView('wf05-queue')}
                    disabled={isLoading}
                  >
                    Zpět na žádosti
                  </button>
                  {selectedItem.verification_request.status === 'PENDING' && (
                    <div className="wf-detail-footer-right">
                      <button
                        type="button"
                        className="wf-btn wf-btn-reject"
                        onClick={() => {
                          setRejectionError('');
                          setIsRejectModalOpen(true);
                        }}
                        disabled={isLoading}
                      >
                        Zamítnout
                      </button>
                      <button
                        type="button"
                        className="wf-btn wf-btn-approve"
                        onClick={handleApprove}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Ukládám...' : 'Schválit ověření'}
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>

          {isRejectModalOpen && selectedItem && (
            <div
              className="wf-modal-overlay fade-in"
              role="dialog"
              aria-modal="true"
            >
              <div className="wf-modal">
                <div className="wf-modal-header">
                  <h2>Zamítnout žádost</h2>
                  <button
                    type="button"
                    className="wf-modal-close"
                    onClick={() => setIsRejectModalOpen(false)}
                    aria-label="Zavřít okno"
                  >
                    &times;
                  </button>
                </div>
                <div className="wf-modal-body">
                  <label htmlFor="rejection-reason-input" className="wf-label">
                    Důvod zamítnutí <span className="text-danger">*</span>
                  </label>
                  <textarea
                    id="rejection-reason-input"
                    className="wf-textarea"
                    rows={4}
                    value={rejectionReason}
                    onChange={(e) => {
                      setRejectionReason(e.target.value);
                      if (rejectionError) setRejectionError('');
                    }}
                    placeholder="Např.: Na certifikátu není čitelné registrační číslo stanice."
                  />
                  {rejectionError && (
                    <p className="wf-error-text">{rejectionError}</p>
                  )}
                  <p className="wf-modal-note wf-text-muted">
                    Důvod se zobrazí u výsledku posouzení a v e-mailu pro
                    chovatele.
                  </p>
                </div>
                <div className="wf-modal-footer">
                  <button
                    type="button"
                    className="wf-btn wf-btn-outline"
                    onClick={() => setIsRejectModalOpen(false)}
                    disabled={isLoading}
                  >
                    Zrušit
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn-reject"
                    onClick={handleConfirmReject}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Ukládám...' : 'Potvrdit zamítnutí'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
