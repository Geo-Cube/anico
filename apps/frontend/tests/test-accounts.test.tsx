import type { Session, TestAccount } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor } from './server';

const tester: TestAccount = {
  identity: {
    userId: '5d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a',
    givenName: 'Testovací',
    familyName: 'Chovatel',
    email: 'tester-5d3c2b1a@anico.test',
    roles: ['breeder'],
  },
  createdAt: '2026-11-09T08:00:00.000Z',
  createdBy: '0b9a3c55-1f0e-4a43-9a51-2f4a8d8d1e01',
};

function renderApp(path: string) {
  const client = createQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client };
}

/** Server-side cookie swap: the session endpoint answers for whoever is "logged in". */
function serverWithSwitching() {
  const admin = sessionFor(['breeder', 'admin'], { canUseTestAccounts: true });
  const asTester: Session = {
    ...sessionFor(['breeder'], { canUseTestAccounts: true }),
    identity: tester.identity,
    csrfToken: 'tester-csrf',
    canManageAccounts: false,
    testAccountActor: {
      userId: admin.identity.userId,
      givenName: 'Jana',
      familyName: 'Nováková',
    },
  };
  let current = admin;
  const accounts: TestAccount[] = [];
  const calls: Array<{ path: string; csrf: string | null; body?: unknown }> =
    [];
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(current)),
    http.get('/api/auth/test-accounts', () => HttpResponse.json({ accounts })),
    http.post('/api/auth/test-accounts', async ({ request }) => {
      calls.push({
        path: 'create',
        csrf: request.headers.get('x-csrf-token'),
        body: await request.json(),
      });
      accounts.push(tester);
      return HttpResponse.json(tester, { status: 201 });
    }),
    http.post(
      '/api/auth/test-accounts/:userId/session',
      ({ request, params }) => {
        calls.push({
          path: `switch:${String(params.userId)}`,
          csrf: request.headers.get('x-csrf-token'),
        });
        current = asTester;
        return new HttpResponse(null, { status: 204 });
      },
    ),
    http.post('/api/auth/test-accounts/return', ({ request }) => {
      calls.push({ path: 'return', csrf: request.headers.get('x-csrf-token') });
      current = admin;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { calls };
}

describe('testovací účty na vývojovém prostředí', () => {
  it('administrátor založí účet, přepne se do něj a vrátí se zpět', async () => {
    const user = userEvent.setup();
    const { calls } = serverWithSwitching();
    const { router } = renderApp('/');

    await user.click(
      await screen.findByRole('link', { name: 'Testovací účty' }),
    );
    expect(
      await screen.findByText('Zatím tu není žádný testovací účet.'),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Jméno/), 'Testovací');
    await user.type(screen.getByLabelText(/^Příjmení/), 'Chovatel');
    await user.click(screen.getByRole('button', { name: 'Založit účet' }));
    expect(
      await screen.findByText('Testovací účet Testovací Chovatel je založený.'),
    ).toBeInTheDocument();
    expect(calls[0]).toEqual({
      path: 'create',
      csrf: 'csrf-token',
      body: { givenName: 'Testovací', familyName: 'Chovatel', admin: false },
    });

    await user.click(
      await screen.findByRole('button', {
        name: 'Přepnout na Testovací Chovatel',
      }),
    );
    const banner = await screen.findByRole('region', {
      name: 'Testovací účet',
    });
    expect(banner).toHaveTextContent(
      'Testovací účet Testovací Chovatel. Přepnuto z účtu Jana Nováková.',
    );
    expect(router.state.location.pathname).toBe('/');
    expect(calls[1]).toEqual({
      path: `switch:${tester.identity.userId}`,
      csrf: 'csrf-token',
    });
    // The test breeder has no admin navigation.
    expect(screen.queryByRole('link', { name: 'Administrace' })).toBeNull();

    await user.click(
      within(banner).getByRole('button', { name: 'Vrátit se do svého účtu' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Testovací účet' }),
      ).toBeNull(),
    );
    // The return uses the CSRF token of the test session it ends.
    expect(calls[2]).toEqual({ path: 'return', csrf: 'tester-csrf' });
    expect(router.state.location.pathname).toBe('/testovaci-ucty');
    expect(
      screen.getByRole('link', { name: 'Administrace' }),
    ).toBeInTheDocument();
  });

  it('bez oprávnění nebo mimo vývojové prostředí stránku nenabízí', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFor(['breeder'])),
      ),
    );
    renderApp('/testovaci-ucty');
    expect(
      await screen.findByText('Testovací účty nejsou dostupné'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Testovací účty' })).toBeNull();
  });

  it('chovatel s vypnutou možností dostane nedostatečné oprávnění', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(
          sessionFor(['breeder'], { canUseTestAccounts: false }),
        ),
      ),
    );
    renderApp('/testovaci-ucty');
    expect(
      await screen.findByText('Nedostatečné oprávnění'),
    ).toBeInTheDocument();
  });
});
