import { useState, useCallback } from 'react';
import type { Identity } from '@anico/shared-schemas';
import { AuthPanel } from './features/auth/AuthPanel';
import { BreederVerification } from './components/BreederVerification';

export function App() {
  const [activePage, setActivePage] = useState<'home' | 'admin'>('home');

  const [identity, setIdentity] = useState<Identity | null>(null);
  const onIdentity = useCallback((value: Identity | null) => {
    setIdentity(value);
    if (
      !value ||
      !value.roles.some((role) => role === 'admin' || role === 'owner')
    )
      setActivePage('home');
  }, []);
  const canAdmin =
    identity?.roles.some((role) => role === 'admin' || role === 'owner') ??
    false;
  return (
    <main>
      <AuthPanel onIdentity={onIdentity} />
      {activePage === 'home' || !canAdmin ? (
        <div className="welcome-screen">
          <h1 className="welcome-title">AniCo</h1>
          <p>Vítejte v AniCo.</p>
          {canAdmin && (
            <div className="welcome-buttons">
              <button
                className="wf-btn wf-btn-primary"
                onClick={() => setActivePage('admin')}
              >
                Přejít do administrace chovatelů &rarr;
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
