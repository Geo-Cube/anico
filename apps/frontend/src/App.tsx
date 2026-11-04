import { useState, useCallback } from 'react';
import type { Identity } from '@anico/shared-schemas';
import { AuthPanel } from './features/auth/AuthPanel';
import { BreederVerification } from './components/BreederVerification';
// DOČASNÉ: vstup do ukázky dokladů (UC-03), nahradí ho záložka v detailu zvířete.
import {
  AnimalDocumentsFeature,
  MOCK_ANIMALS,
} from './features/animal-documents';

function isAdmin(identity: Identity) {
  return identity.roles.some((role) => role === 'admin' || role === 'owner');
}

export function App() {
  const [activePage, setActivePage] = useState<'home' | 'admin' | 'documents'>(
    'home',
  );

  const [identity, setIdentity] = useState<Identity | null>(null);
  const onIdentity = useCallback((value: Identity | null) => {
    setIdentity(value);
    if (!value) setActivePage('home');
    else if (!isAdmin(value))
      setActivePage((page) => (page === 'admin' ? 'home' : page));
  }, []);
  const canAdmin = identity ? isAdmin(identity) : false;
  return (
    <main>
      <AuthPanel onIdentity={onIdentity} />
      {activePage === 'documents' ? (
        // DOČASNÉ: ukázka dokladů (UC-03), viz vstup výše.
        <div
          className="admin-screen"
          style={{ maxWidth: '1180px', margin: '0 auto', padding: '1rem' }}
        >
          <div className="wf-back-nav">
            <button
              className="wf-btn-back"
              onClick={() => setActivePage('home')}
            >
              &larr; Zpět na úvod
            </button>
          </div>

          <AnimalDocumentsFeature
            animal={MOCK_ANIMALS[0]}
            onBack={() => setActivePage('home')}
          />
        </div>
      ) : activePage === 'home' || !canAdmin ? (
        <div className="welcome-screen">
          <h1 className="welcome-title">AniCo</h1>
          <p>Vítejte v AniCo.</p>
          {identity && (
            <div className="welcome-buttons">
              {canAdmin && (
                <button
                  className="wf-btn wf-btn-primary"
                  onClick={() => setActivePage('admin')}
                >
                  Přejít do administrace chovatelů &rarr;
                </button>
              )}
              <button
                className="wf-btn wf-btn-primary"
                onClick={() => setActivePage('documents')}
              >
                Doklady zvířete (ukázka) &rarr;
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          className="admin-screen"
          style={{ maxWidth: '1180px', margin: '0 auto', padding: '1rem' }}
        >
          <div className="wf-back-nav">
            <button
              className="wf-btn-back"
              onClick={() => setActivePage('home')}
            >
              &larr; Zpět na úvod
            </button>
          </div>

          <BreederVerification />
        </div>
      )}
    </main>
  );
}
