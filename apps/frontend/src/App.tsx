import { useState } from 'react';
import { BreederVerification } from './components/BreederVerification';

export function App() {
  const [activePage, setActivePage] = useState<'home' | 'admin'>('home');

  return (
    <main>
      {activePage === 'home' ? (
        <div className="welcome-screen">
          <h1 className="welcome-title">AniCo</h1>
          <p>Vítejte v AniCo.</p>
          <div className="welcome-buttons">
            <button
              className="wf-btn wf-btn-primary"
              onClick={() => setActivePage('admin')}
            >
              Přejít do administrace chovatelů &rarr;
            </button>
          </div>
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
