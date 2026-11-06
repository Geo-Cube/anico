import type {
  MyAccount,
  Role,
  VerificationStatus,
} from '@anico/shared-schemas';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor, unsubmittedAccount } from './server';

function reviewedAccount(
  status: VerificationStatus,
  overrides: Partial<NonNullable<MyAccount['verificationRequest']>> = {},
): MyAccount {
  return {
    ...unsubmittedAccount,
    accountState: status,
    isVerified: status === 'APPROVED',
    verificationRequest: {
      id: '123456789012345678901235',
      status,
      submittedAt: '2026-01-01T12:00:00.000Z',
      lastSubmittedAt: '2026-01-01T12:00:00.000Z',
      revision: 1,
      breedingStationCertificate: {
        fileName: 'osvedceni.pdf',
        contentType: 'application/pdf',
      },
      reviewedAt: status === 'PENDING' ? null : '2026-02-03T12:00:00.000Z',
      returnReason: null,
      rejectionReason: null,
      ...overrides,
    },
  };
}

function respondWith(account: MyAccount) {
  server.use(
    http.get('/api/breeder/breeders/me', () => HttpResponse.json(account)),
  );
}

function renderApp(path = '/') {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor())),
  );
});

describe('stav ověření chovatele', () => {
  it.each(['/', '/ucet'])('ukazuje čekající žádost na %s', async (path) => {
    respondWith(reviewedAccount('PENDING'));
    renderApp(path);
    const heading = await screen.findByRole('heading', {
      name: 'Účet neověřen',
    });
    expect(heading.parentElement).toHaveClass('border-destructive');
    expect(
      screen.getByText('Žádost o ověření čeká na posouzení administrátorem.'),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Pokračovat' }),
    ).not.toBeInTheDocument();
  });

  it('vysvětluje stav před prvním odesláním', async () => {
    renderApp();
    expect(
      await screen.findByText(
        'Žádost o ověření chovatele jste zatím neodeslali.',
      ),
    ).toBeVisible();
  });

  it('ukazuje důvod zamítnutí a datum rozhodnutí', async () => {
    respondWith(
      reviewedAccount('REJECTED', { rejectionReason: 'Doklad není platný.' }),
    );
    renderApp();
    expect(await screen.findByText('Důvod: Doklad není platný.')).toBeVisible();
    expect(screen.getByText('Žádost o ověření byla zamítnuta.')).toBeVisible();
    const date = screen.getByText(
      new Date('2026-02-03T12:00:00.000Z').toLocaleDateString('cs-CZ'),
    );
    expect(date).toHaveAttribute('datetime', '2026-02-03T12:00:00.000Z');
  });

  it('ukazuje vrácení k doplnění a poznámku administrátora', async () => {
    respondWith(
      reviewedAccount('RETURNED', { returnReason: 'Přiložte čitelný doklad.' }),
    );
    renderApp();
    expect(
      await screen.findByText('Žádost byla vrácena k doplnění.'),
    ).toBeVisible();
    expect(screen.getByText('Důvod: Přiložte čitelný doklad.')).toBeVisible();
  });

  it('ověřenému chovateli umožní pokračovat ke zvířatům', async () => {
    respondWith(reviewedAccount('APPROVED'));
    server.use(
      http.get('/api/animal/animals', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    const router = renderApp();
    const heading = await screen.findByRole('heading', { name: 'Účet ověřen' });
    expect(heading.parentElement).toHaveClass('border-accent-foreground');
    await userEvent.click(screen.getByRole('link', { name: 'Pokračovat' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/zvirata'),
    );
  });

  it.each<Role[]>([
    ['admin'],
    ['admin', 'breeder'],
    ['owner', 'breeder'],
    ['owner'],
  ])('pro role %j nezakládá profil chovatele', async (...roles) => {
    const handler = vi.fn(() => HttpResponse.json(unsubmittedAccount));
    server.use(
      http.get('/api/auth/session', () => HttpResponse.json(sessionFor(roles))),
      http.get('/api/breeder/breeders/me', handler),
    );
    renderApp();
    await screen.findByRole('heading', { name: 'Vítejte, Jana Nováková' });
    expect(handler).not.toHaveBeenCalled();
    expect(screen.queryByText('Účet neověřen')).not.toBeInTheDocument();
    expect(screen.queryByText('Účet ověřen')).not.toBeInTheDocument();
  });

  it('během načítání oznamuje stav', async () => {
    server.use(
      http.get('/api/breeder/breeders/me', async () => {
        await delay(100);
        return HttpResponse.json(unsubmittedAccount);
      }),
    );
    renderApp();
    expect(
      await screen.findByText('Načítám stav ověření účtu…'),
    ).toHaveAttribute('role', 'status');
    await screen.findByRole('heading', { name: 'Účet neověřen' });
  });

  it('při chybě nabídne opakování a po něm načte stav', async () => {
    server.use(
      http.get(
        '/api/breeder/breeders/me',
        () => new HttpResponse(null, { status: 503 }),
      ),
    );
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Stav ověření účtu se nepodařilo načíst.',
    );
    respondWith(reviewedAccount('APPROVED'));
    await userEvent.click(screen.getByRole('button', { name: 'Zkusit znovu' }));
    expect(
      await screen.findByRole('heading', { name: 'Účet ověřen' }),
    ).toBeVisible();
  });

  it('při 403 nezobrazuje neověřený účet, ale chybějící oprávnění', async () => {
    server.use(
      http.get('/api/breeder/breeders/me', () =>
        HttpResponse.json({ error: 'FORBIDDEN' }, { status: 403 }),
      ),
    );
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'K zobrazení stavu ověření účtu nemáte oprávnění.',
    );
    expect(screen.queryByText('Účet neověřen')).not.toBeInTheDocument();
  });

  it('po návratu do okna načte nové rozhodnutí', async () => {
    respondWith(reviewedAccount('PENDING'));
    renderApp();
    await screen.findByRole('heading', { name: 'Účet neověřen' });
    respondWith(reviewedAccount('APPROVED'));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(
      await screen.findByRole('heading', { name: 'Účet ověřen' }),
    ).toBeVisible();
    act(() => focusManager.setFocused(undefined));
  });
});
