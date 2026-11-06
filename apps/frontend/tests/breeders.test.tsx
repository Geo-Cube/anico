import type { AdminVerificationRequest } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { requestDetailKey, verificationKey } from '@/features/breeders/api';
import { anonymous, server, sessionFor } from './server';

const api = '/api/breeder/verification-requests';
const pending: AdminVerificationRequest = {
  id: '65a000000000000000000001',
  status: 'PENDING',
  submittedAt: '2026-10-30T08:15:00.000Z',
  lastSubmittedAt: '2026-10-31T08:15:00.000Z',
  revision: 2,
  breedingStationCertificate: {
    fileName: 'certifikat.pdf',
    contentType: 'application/pdf',
  },
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  returnReason: null,
  reviewHistory: [],
  breeder: {
    breederId: 'breeder-1',
    firstName: 'Karel',
    lastName: 'Novák',
    emailAddress: 'karel@example.test',
    breedingStationName: 'Modré údolí',
    breedingStationNumber: '1234/2024',
    isVerified: false,
  },
};
const rejectedByOther: AdminVerificationRequest = {
  ...pending,
  status: 'REJECTED',
  reviewedBy: '7c1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
  reviewedAt: '2026-11-01T09:40:00.000Z',
  rejectionReason: 'Nečitelný certifikát.',
};

function renderApp(path: string, client = createQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

/** Rozhodnutí čeká na `release`; `done` se splní, až ho MSW odešle. */
function heldResponse(response: () => Response) {
  let release!: () => void;
  let sent!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const done = new Promise<void>((resolve) => (sent = resolve));
  return {
    release,
    done,
    handler: async () => {
      await gate;
      sent();
      return response();
    },
  };
}

/** Doběhnutí zpožděné odpovědi včetně jejích callbacků. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

/** Schválit ověření → Potvrdit schválení (WF 07 s potvrzením). */
async function confirmApproval() {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Schválit ověření' }),
  );
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Potvrdit schválení',
    }),
  );
}

beforeEach(() => {
  server.use(
    http.get('/api/auth/session', () =>
      HttpResponse.json(sessionFor(['breeder', 'admin'])),
    ),
    http.get(`${api}/summary`, () =>
      HttpResponse.json({ pending: 3, returned: 0, approved: 1, rejected: 0 }),
    ),
    http.get('/api/animal/document-reviews', () =>
      HttpResponse.json({ items: [] }),
    ),
    http.get(api, () => HttpResponse.json({ items: [pending] })),
    http.get(`${api}/:id`, () => HttpResponse.json(pending)),
  );
});

describe('administrace ověření chovatelů – souběh', () => {
  it('409 doručená po odhlášení nevrátí data žádosti do cache', async () => {
    const conflict = heldResponse(() =>
      HttpResponse.json(
        { error: 'Verification already decided', current: rejectedByOther },
        { status: 409 },
      ),
    );
    server.use(http.post(`${api}/:id/decision`, conflict.handler));
    const client = createQueryClient();
    renderApp(`/administrace/chovatele/zadosti/${pending.id}`, client);
    await confirmApproval();

    server.use(http.get('/api/auth/session', anonymous));
    await client.invalidateQueries({ queryKey: ['session'] });
    await waitFor(() => expect(client.getQueryData(['session'])).toBeNull());

    conflict.release();
    await conflict.done;
    await settle();
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: verificationKey })
        .filter((query) => query.state.data !== undefined),
    ).toEqual([]);
  });

  it('změna revize při otevřeném dialogu ho zavře a schválí jen zkontrolovanou revizi', async () => {
    const decide = vi.fn<(body: unknown) => void>();
    server.use(
      http.post(`${api}/:id/decision`, async ({ request }) => {
        decide(await request.json());
        return HttpResponse.json({ ...pending, revision: 3 });
      }),
    );
    const client = createQueryClient();
    renderApp(`/administrace/chovatele/zadosti/${pending.id}`, client);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Schválit ověření' }),
    );
    await screen.findByRole('dialog');

    // detail se mezitím obnoví s opraveným podáním (revize 3)
    client.setQueryData(requestDetailKey(pending.id), {
      ...pending,
      revision: 3,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Chovatel mezitím žádost opravil/),
    ).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();

    await confirmApproval();
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith({
        decision: 'APPROVED',
        revision: 3,
      }),
    );
  });
});

describe('administrace ověření chovatelů', () => {
  it('přehled ukazuje počty čekajících žádostí a dokladů z API', async () => {
    server.use(
      http.get(`${api}/summary`, () =>
        HttpResponse.json({
          pending: 3,
          returned: 2,
          approved: 0,
          rejected: 0,
        }),
      ),
    );
    renderApp('/administrace/chovatele');
    expect(
      await screen.findByText('3 žádosti čekají na posouzení'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('0 dokladů čeká na posouzení'),
    ).toBeInTheDocument();
  });

  it('otevře administraci i vlastníkovi bez role admin', async () => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFor(['breeder', 'owner'])),
      ),
    );
    renderApp('/administrace/chovatele');
    expect(
      await screen.findByText('3 žádosti čekají na posouzení'),
    ).toBeInTheDocument();
  });

  it('fronta posílá zvolený filtr stavu a zobrazí prázdný stav', async () => {
    const statuses: (string | null)[] = [];
    server.use(
      http.get(api, ({ request }) => {
        const status = new URL(request.url).searchParams.get('status');
        statuses.push(status);
        return HttpResponse.json({
          items: status === 'PENDING' ? [pending] : [],
        });
      }),
    );
    renderApp('/administrace/chovatele/zadosti');
    const row = (await screen.findByRole('rowheader', { name: 'Karel Novák' }))
      .parentElement!;
    expect(within(row).getByText('Ověření chovatele')).toBeInTheDocument();
    expect(within(row).getByText('K posouzení')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Zamítnuté' }));
    expect(
      await screen.findByText('V tomto stavu nejsou žádné žádosti chovatelů.'),
    ).toBeInTheDocument();
    expect(statuses).toEqual(['PENDING', 'REJECTED']);
  });

  it('chyba načtení fronty nabídne opakování', async () => {
    let calls = 0;
    server.use(
      http.get(api, () => {
        calls++;
        return calls <= 2
          ? HttpResponse.json({ error: 'Internal' }, { status: 500 })
          : HttpResponse.json({ items: [pending] });
      }),
    );
    renderApp('/administrace/chovatele/zadosti');
    await userEvent.click(
      await screen.findByRole('button', { name: /Zkusit znovu/ }),
    );
    expect(
      await screen.findByRole('rowheader', { name: 'Karel Novák' }),
    ).toBeInTheDocument();
  });

  it('zamítnutí bez důvodu neodešle, s důvodem uloží a vrátí na frontu se zprávou', async () => {
    const decide = vi.fn<(body: unknown, csrf: string | null) => void>();
    server.use(
      http.post(`${api}/:id/decision`, async ({ request }) => {
        decide(await request.json(), request.headers.get('X-CSRF-Token'));
        return HttpResponse.json(rejectedByOther);
      }),
    );
    const router = renderApp(`/administrace/chovatele/zadosti/${pending.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Zamítnout' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit zamítnutí' }),
    );
    expect(
      within(dialog).getByText('Důvod zamítnutí je povinný.'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByRole('textbox'), '   ');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit zamítnutí' }),
    );
    expect(decide).not.toHaveBeenCalled();

    await userEvent.type(
      within(dialog).getByRole('textbox'),
      ' Nečitelný certifikát. ',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit zamítnutí' }),
    );
    expect(
      await screen.findByText(/Ověření účtu bylo zamítnuto/),
    ).toBeInTheDocument();
    expect(decide).toHaveBeenCalledWith(
      {
        decision: 'REJECTED',
        revision: 2,
        rejectionReason: 'Nečitelný certifikát.',
      },
      'csrf-token',
    );
    expect(router.state.location.pathname).toBe(
      '/administrace/chovatele/zadosti',
    );
    expect(router.state.location.search).toBe('?stav=PENDING');

    await userEvent.click(
      screen.getByRole('button', { name: 'Zavřít oznámení' }),
    );
    expect(
      screen.queryByText(/Ověření účtu bylo zamítnuto/),
    ).not.toBeInTheDocument();
  });

  it('konflikt 409 zobrazí uložený výsledek jiného administrátora', async () => {
    server.use(
      http.post(`${api}/:id/decision`, () =>
        HttpResponse.json(
          { error: 'Verification already decided', current: rejectedByOther },
          { status: 409 },
        ),
      ),
    );
    const router = renderApp(`/administrace/chovatele/zadosti/${pending.id}`);
    await confirmApproval();
    expect(
      await screen.findByText(/Jiný administrátor už o této žádosti rozhodl/),
    ).toBeInTheDocument();
    expect(screen.getByText('Nečitelný certifikát.')).toBeInTheDocument();
    expect(screen.getByText(rejectedByOther.reviewedBy!)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Schválit ověření' }),
    ).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      `/administrace/chovatele/zadosti/${pending.id}`,
    );
  });

  it('chyba serveru při rozhodnutí zůstane na detailu a dovolí opakovat', async () => {
    server.use(
      http.post(`${api}/:id/decision`, () =>
        HttpResponse.json({ error: 'Internal' }, { status: 500 }),
      ),
    );
    renderApp(`/administrace/chovatele/zadosti/${pending.id}`);
    await confirmApproval();
    const dialog = screen.getByRole('dialog');
    expect(
      await within(dialog).findByText(/Rozhodnutí se nepodařilo uložit/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Potvrdit schválení' }),
    ).toBeEnabled();
  });

  it('schválení se uloží až po potvrzení v dialogu', async () => {
    const decide = vi.fn<(body: unknown) => void>();
    server.use(
      http.post(`${api}/:id/decision`, async ({ request }) => {
        decide(await request.json());
        return HttpResponse.json({
          ...pending,
          status: 'APPROVED',
          reviewedBy: sessionFor().identity.userId,
          reviewedAt: '2026-11-06T10:00:00.000Z',
          breeder: { ...pending.breeder, isVerified: true },
        });
      }),
    );
    const router = renderApp(`/administrace/chovatele/zadosti/${pending.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Schválit ověření' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Zrušit',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(decide).not.toHaveBeenCalled();

    await confirmApproval();
    expect(
      await screen.findByText(/Ověření účtu bylo schváleno/),
    ).toBeInTheDocument();
    expect(decide).toHaveBeenCalledWith({ decision: 'APPROVED', revision: 2 });
    expect(router.state.location.pathname).toBe(
      '/administrace/chovatele/zadosti',
    );
  });

  it('neexistující žádost zobrazí stav nenalezeno', async () => {
    server.use(
      http.get(`${api}/:id`, () =>
        HttpResponse.json({ error: 'Not found' }, { status: 404 }),
      ),
    );
    renderApp('/administrace/chovatele/zadosti/65a0000000000000000000ff');
    expect(
      await screen.findByRole('heading', { name: 'Žádost nebyla nalezena' }),
    ).toBeInTheDocument();
  });

  it('stáhne certifikát přes API a chybu stažení zobrazí', async () => {
    const createObjectURL = vi.fn(() => 'blob:certificate');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    );
    let fail = true;
    server.use(
      http.get(`${api}/:id/certificate`, () =>
        fail
          ? HttpResponse.json({ error: 'Not found' }, { status: 404 })
          : new HttpResponse('%PDF-1.7', {
              headers: { 'Content-Type': 'application/pdf' },
            }),
      ),
    );
    renderApp(`/administrace/chovatele/zadosti/${pending.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Stáhnout' }),
    );
    expect(
      await screen.findByText('Certifikát nebyl nalezen.'),
    ).toBeInTheDocument();

    fail = false;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Stáhnout' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(click.mock.contexts[0]).toMatchObject({
      download: 'certifikat.pdf',
      href: 'blob:certificate',
    });
    click.mockRestore();
  });
});
