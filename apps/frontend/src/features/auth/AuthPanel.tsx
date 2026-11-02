import { useEffect, useState } from 'react';
import { IdentitySchema, type Identity } from '@anico/shared-schemas';
type Session = { identity: Identity; csrfToken: string; expiresAt: string };
export function AuthPanel({
  onIdentity,
}: {
  onIdentity: (identity: Identity | null) => void;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [available, current] = await Promise.all([
          fetch('/api/auth/providers', {
            credentials: 'same-origin',
            redirect: 'error',
            signal: controller.signal,
          }),
          fetch('/api/auth/session', {
            credentials: 'same-origin',
            redirect: 'error',
            signal: controller.signal,
          }),
        ]);
        if (!available.ok) throw new Error('Auth unavailable');
        const data: unknown = await available.json();
        if (
          !data ||
          typeof data !== 'object' ||
          !('providers' in data) ||
          !Array.isArray(data.providers) ||
          !data.providers.every((p) =>
            ['google', 'microsoft', 'apple'].includes(p),
          )
        )
          throw new Error('Invalid provider response');
        setProviders(data.providers);
        if (current.status === 401) {
          setSession(null);
          onIdentity(null);
        } else {
          if (!current.ok) throw new Error('Session unavailable');
          const body = await current.json();
          const identity = IdentitySchema.parse(body.identity);
          if (
            typeof body.csrfToken !== 'string' ||
            typeof body.expiresAt !== 'string'
          )
            throw new Error('Invalid session');
          setSession({ ...body, identity });
          onIdentity(identity);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('Přihlášení není dostupné. Zkus stránku obnovit za chvíli.');
          onIdentity(null);
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [onIdentity]);
  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    const timer = setTimeout(
      () => {
        setSession(null);
        onIdentity(null);
        setError('Přihlášení vypršelo. Přihlas se znovu.');
      },
      Math.max(0, Math.min(remaining, 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [session, onIdentity]);
  async function logout() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { 'X-CSRF-Token': session.csrfToken },
      });
      if (response.status !== 204 && response.status !== 401)
        throw new Error('Logout failed');
      setSession(null);
      onIdentity(null);
    } catch {
      setError('Odhlášení se nepodařilo. Zkus to prosím znovu.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Přihlášení">
      {busy && <p role="status">Načítám přihlášení…</p>}
      {error && <p role="alert">{error}</p>}
      {session ? (
        <>
          <p>
            Přihlášen:{' '}
            {[session.identity.givenName, session.identity.familyName]
              .filter(Boolean)
              .join(' ') ||
              session.identity.email ||
              'uživatel'}
          </p>
          <button
            className="wf-btn"
            disabled={busy}
            onClick={() => void logout()}
          >
            Odhlásit se
          </button>
        </>
      ) : (
        !busy &&
        providers.map((provider) => (
          <p key={provider}>
            <a
              className="wf-btn wf-btn-primary"
              href={`/api/auth/login/${provider}`}
            >
              Přihlásit přes{' '}
              {
                (
                  {
                    google: 'Google',
                    microsoft: 'Microsoft',
                    apple: 'Apple',
                  } as Record<string, string>
                )[provider]
              }
            </a>
          </p>
        ))
      )}
      {!busy && !error && !session && providers.length === 0 && (
        <p>Přihlášení zatím není nakonfigurované.</p>
      )}
    </section>
  );
}
