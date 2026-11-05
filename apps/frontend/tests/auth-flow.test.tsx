import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { anonymous, server, sessionFor } from './server';

function renderApp(path: string) {
  const client = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { client, router };
}

const signedIn = (session = sessionFor()) =>
  server.use(http.get('/api/auth/session', () => HttpResponse.json(session)));

const providerLinks = async () =>
  (await screen.findAllByRole('link', { name: /Přihlásit přes/ })).map((link) =>
    link.getAttribute('href'),
  );

describe('login', () => {
  it('sends an anonymous visitor to the login page and keeps the requested page as returnTo', async () => {
    const { router } = renderApp('/ucet?zalozka=1');
    await screen.findByRole('heading', { name: 'Přihlášení' });
    expect(router.state.location.pathname).toBe('/prihlaseni');
    // Apple is hidden on plain HTTP: its callback requires HTTPS.
    expect(await providerLinks()).toEqual([
      '/api/auth/login/google?returnTo=%2Fucet%3Fzalozka%3D1',
      '/api/auth/login/microsoft?returnTo=%2Fucet%3Fzalozka%3D1',
    ]);
    expect(screen.queryByText(/vypršelo/)).not.toBeInTheDocument();
  });

  it('drops a return path that could leave the application', async () => {
    renderApp('/prihlaseni?returnTo=%2F%2Fattacker.example.test');
    expect(await providerLinks()).toEqual([
      '/api/auth/login/google',
      '/api/auth/login/microsoft',
    ]);
  });

  it('explains a login failure only for known codes', async () => {
    renderApp('/prihlaseni?error=LOGIN_CANCELLED');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Přihlášení bylo zrušeno',
    );
  });

  it('ignores unknown error codes in the URL', async () => {
    renderApp('/prihlaseni?error=%3Cscript%3E');
    await screen.findAllByRole('link', { name: /Přihlásit přes/ });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when no provider is configured', async () => {
    server.use(
      http.get('/api/auth/providers', () =>
        HttpResponse.json({ providers: [] }),
      ),
    );
    renderApp('/prihlaseni');
    expect(
      await screen.findByText('Přihlášení zatím není nakonfigurované.'),
    ).toBeInTheDocument();
  });

  it('continues to the safe returnTo when the visitor is already signed in', async () => {
    signedIn();
    const { router } = renderApp('/prihlaseni?returnTo=%2Fucet');
    await screen.findByRole('heading', { name: 'Můj účet' });
    expect(router.state.location.pathname).toBe('/ucet');
  });
});

describe('session availability', () => {
  it('offers a retry instead of the login page when the session cannot be checked', async () => {
    let calls = 0;
    server.use(
      http.get('/api/auth/session', () => {
        calls += 1;
        return calls <= 2
          ? HttpResponse.error()
          : HttpResponse.json(sessionFor());
      }),
    );
    const { router } = renderApp('/ucet');
    await screen.findByText('Služba je dočasně nedostupná', undefined, {
      timeout: 4000,
    });
    expect(router.state.location.pathname).toBe('/ucet');
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    await screen.findByRole('heading', { name: 'Můj účet' });
  });

  it('treats a gateway outage (5xx) as unavailable, not as logged out', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json({ error: 'Bad gateway' }, { status: 502 }),
      ),
    );
    const { router } = renderApp('/');
    await screen.findByText('Služba je dočasně nedostupná', undefined, {
      timeout: 4000,
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('asks the server again at expiry and sends the user to login only after its 401', async () => {
    let expired = false;
    server.use(
      http.get('/api/auth/session', () => {
        if (expired) return anonymous();
        expired = true;
        return HttpResponse.json(
          sessionFor(['breeder'], {
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          }),
        );
      }),
    );
    const { router } = renderApp('/ucet');
    expect(
      await screen.findByText('Přihlášení vypršelo. Přihlas se znovu.'),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('?returnTo=%2Fucet');
  });
});

describe('roles', () => {
  it('lets an administrator use the regular application', async () => {
    signedIn(sessionFor(['breeder', 'admin']));
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: /Vítej, Jana Nováková/ });
    expect(router.state.location.pathname).toBe('/');
    expect(
      screen.getByRole('link', { name: 'Administrace' }),
    ).toBeInTheDocument();
  });

  it('shows missing permission on an admin route without leaving it', async () => {
    signedIn();
    const { router } = renderApp('/administrace/chovatele');
    await screen.findByText('Nedostatečné oprávnění');
    expect(router.state.location.pathname).toBe('/administrace/chovatele');
    expect(
      screen.queryByRole('link', { name: 'Administrace' }),
    ).not.toBeInTheDocument();
  });

  it('opens the simulated breeder administration for an owner', async () => {
    signedIn(sessionFor(['breeder', 'owner']));
    renderApp('/administrace/chovatele');
    expect(await screen.findByText(/Simulace\./)).toBeInTheDocument();
  });
});

describe('logout and cached user data', () => {
  it('removes every cached query of the previous user and confirms the logout', async () => {
    signedIn();
    let loggedOut = false;
    server.use(
      http.post('/api/auth/logout', ({ request }) => {
        loggedOut = request.headers.get('X-CSRF-Token') === 'csrf-token';
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { client, router } = renderApp('/');
    await screen.findByRole('heading', { name: /Vítej/ });
    client.setQueryData(['animals'], [{ name: 'Brix' }]);
    server.use(http.get('/api/auth/session', anonymous));
    await userEvent.click(
      screen.getByRole('button', { name: /Uživatelská nabídka/ }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Odhlásit se' }),
    );
    expect(await screen.findByText('Odhlášení proběhlo.')).toBeInTheDocument();
    expect(loggedOut).toBe(true);
    expect(router.state.location.pathname).toBe('/prihlaseni');
    expect(client.getQueryData(['animals'])).toBeUndefined();
    expect(screen.queryByText(/vypršelo/)).not.toBeInTheDocument();
    // Closing clears the history state, so a reload cannot show it again.
    await userEvent.click(
      screen.getByRole('button', { name: 'Zavřít oznámení' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Odhlášení proběhlo.')).not.toBeInTheDocument(),
    );
    expect(router.state.location.state).toBeNull();
  });

  it('keeps the session and reports a logout that did not reach the server', async () => {
    signedIn();
    server.use(http.post('/api/auth/logout', () => HttpResponse.error()));
    const { router } = renderApp('/');
    await screen.findByRole('heading', { name: /Vítej/ });
    await userEvent.click(
      screen.getByRole('button', { name: /Uživatelská nabídka/ }),
    );
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Odhlásit se' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Odhlášení se nepodařilo',
    );
    expect(router.state.location.pathname).toBe('/');
  });

  it('drops cached data when another account appears in the session', () => {
    const client = createQueryClient();
    client.setQueryData(['session'], sessionFor());
    client.setQueryData(['animals'], [{ name: 'Brix' }]);
    const other = sessionFor();
    other.identity = { ...other.identity, userId: crypto.randomUUID() };
    client.setQueryData(['session'], other);
    expect(client.getQueryData(['animals'])).toBeUndefined();
  });
});

describe('account linking', () => {
  it('ends the session on a 401 from any API and returns to the page after login', async () => {
    signedIn();
    const { router } = renderApp('/ucet');
    await screen.findByRole('heading', { name: 'Můj účet' });
    server.use(
      http.post('/api/auth/connections/microsoft', () => anonymous()),
      http.get('/api/auth/session', anonymous),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Propojit Microsoft' }),
    );
    expect(
      await screen.findByText('Přihlášení vypršelo. Přihlas se znovu.'),
    ).toBeInTheDocument();
    expect(router.state.location.search).toBe('?returnTo=%2Fucet');
  });

  it('keeps the user signed in when linking needs a fresh login', async () => {
    signedIn();
    server.use(
      http.post('/api/auth/connections/microsoft', () =>
        HttpResponse.json({ error: 'RECENT_LOGIN_REQUIRED' }, { status: 401 }),
      ),
    );
    const { router } = renderApp('/ucet');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Propojit Microsoft' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nejdřív odhlas a znovu přihlas',
    );
    expect(router.state.location.pathname).toBe('/ucet');
  });

  it('shows a failed link callback on the account page', async () => {
    signedIn();
    renderApp('/ucet?error=IDENTITY_ALREADY_LINKED');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'už patří jinému účtu AniCo',
    );
    const linked = screen.getByRole('list');
    expect(within(linked).getByText('Google')).toBeInTheDocument();
  });
});

describe('session loading', () => {
  it('does not show the login page while the session is still loading', async () => {
    let release!: () => void;
    server.use(
      http.get(
        '/api/auth/session',
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(HttpResponse.json(sessionFor()));
          }),
      ),
    );
    const { router } = renderApp('/ucet');
    expect(await screen.findByText('Načítám AniCo…')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/ucet');
    release();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Můj účet' })).toBeVisible(),
    );
  });
});
