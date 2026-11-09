import type { AccountState, MyAccount } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor, unsubmittedAccount } from './server';

const mePath = '/api/breeder/breeders/me';
const submitPath = `${mePath}/verification-request`;
const path = '/overeni-chovatele';

const profile = {
  firstName: 'Jana',
  lastName: 'Nováková',
  emailAddress: 'jana@example.test',
  breedingStationName: 'Z Lipové aleje',
  breedingStationNumber: 'CZ-12345',
};

function accountIn(
  state: Exclude<AccountState, 'NOT_SUBMITTED'>,
  overrides: Partial<NonNullable<MyAccount['verificationRequest']>> = {},
): MyAccount {
  return {
    ...unsubmittedAccount,
    ...profile,
    accountState: state,
    isVerified: state === 'APPROVED',
    verificationRequest: {
      id: '123456789012345678901235',
      status: state,
      submittedAt: '2026-01-01T12:00:00.000Z',
      lastSubmittedAt: '2026-01-01T12:00:00.000Z',
      revision: 1,
      breedingStationCertificate: {
        fileName: 'osvedceni.pdf',
        contentType: 'application/pdf',
      },
      reviewedAt: state === 'PENDING' ? null : '2026-02-03T12:00:00.000Z',
      returnReason: null,
      rejectionReason: null,
      ...overrides,
    },
  };
}

/** Breeder-service v paměti: GET vrací uložený účet, POST ho nahradí odpovědí. */
function storeAccount(initial: MyAccount) {
  let stored = initial;
  server.use(http.get(mePath, () => HttpResponse.json(stored)));
  return (next: MyAccount) => {
    stored = next;
  };
}

function renderApp(initial = path) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter(routes, { initialEntries: [initial] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const pdf = (name = 'osvedceni-novy.pdf') =>
  new File(['%PDF-1.7'], name, { type: 'application/pdf' });

/** Pole formuláře podle popisku; povinná mají za popiskem hvězdičku. */
const control = (label: string) =>
  screen.getByLabelText(new RegExp(`^${label}( \\*)?$`));
const certificateInput = () => control('Osvědčení chovatelské stanice');

beforeEach(() => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor())),
  );
});

describe('žádost o ověření chovatele (WF 02/03)', () => {
  it('nový chovatel odešle údaje i osvědčení a na přehledu vidí čekající žádost', async () => {
    const save = storeAccount(unsubmittedAccount);
    let body: FormData | undefined;
    let csrf: string | null = null;
    server.use(
      http.post(submitPath, async ({ request }) => {
        csrf = request.headers.get('X-CSRF-Token');
        body = await request.formData();
        const pending = accountIn('PENDING');
        save(pending);
        return HttpResponse.json(pending, { status: 201 });
      }),
    );
    const user = userEvent.setup({ applyAccept: false });
    const router = renderApp('/');

    await user.click(
      await screen.findByRole('link', { name: 'Podat žádost o ověření' }),
    );
    expect(router.state.location.pathname).toBe(path);
    // Jméno a e-mail převezme z přihlášení, údaje stanice doplní chovatel.
    await screen.findByRole('button', { name: 'Odeslat žádost' });
    expect(control('Jméno')).toHaveValue('Jana');
    expect(control('Příjmení')).toHaveValue('Nováková');
    expect(control('E-mail')).toHaveValue('jana@example.test');
    await user.type(control('Název chovatelské stanice'), '  Z Lipové aleje ');
    await user.type(control('Číslo chovatelské stanice'), 'CZ-12345');
    await user.upload(certificateInput(), pdf('osvedceni.pdf'));
    await user.click(screen.getByRole('button', { name: 'Odeslat žádost' }));

    const confirmation = await screen.findByRole('heading', {
      name: 'Žádost byla odeslána',
    });
    expect(confirmation).toBeVisible();
    expect(csrf).toBe('csrf-token');
    expect(
      Object.fromEntries(
        Object.keys(profile).map((key) => [key, body?.get(key)]),
      ),
    ).toEqual(profile);
    expect(body?.has('breedingStationCertificate')).toBe(true);

    await user.click(
      within(confirmation.parentElement as HTMLElement).getByRole('link', {
        name: 'Zpět na přehled',
      }),
    );
    expect(
      await screen.findByText(
        'Žádost o ověření čeká na posouzení administrátorem.',
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Podat žádost o ověření' }),
    ).not.toBeInTheDocument();
  });

  it('neplatné údaje a chybějící, velké nebo nepodporované osvědčení zablokuje před odesláním', async () => {
    const submit = vi.fn(() => HttpResponse.json({}, { status: 500 }));
    server.use(http.post(submitPath, submit));
    const user = userEvent.setup({ applyAccept: false });
    const router = renderApp();
    const send = await screen.findByRole('button', { name: 'Odeslat žádost' });

    await user.clear(control('E-mail'));
    await user.type(control('E-mail'), 'jana@');
    await user.click(send);
    expect(control('E-mail')).toHaveAccessibleDescription(
      'Zadejte platnou e-mailovou adresu.',
    );
    expect(control('Název chovatelské stanice')).toHaveAccessibleDescription(
      'Vyplňte název chovatelské stanice.',
    );
    expect(certificateInput()).toHaveAccessibleDescription(
      'PDF, JPEG nebo PNG, nejvýše 5 MiB Vyberte soubor osvědčení chovatelské stanice.',
    );

    await user.upload(
      certificateInput(),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'velky.pdf', {
        type: 'application/pdf',
      }),
    );
    expect(screen.getByText('Soubor je větší než 5 MiB.')).toBeVisible();
    await user.upload(
      certificateInput(),
      new File(['x'], 'osvedceni.docx', { type: 'application/msword' }),
    );
    expect(
      screen.getByText('Nepodporovaný formát. Nahrajte PDF, JPEG nebo PNG.'),
    ).toBeVisible();
    await user.click(send);
    expect(submit).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('heading', { name: 'Žádost byla odeslána' }),
    ).not.toBeInTheDocument();

    // A1: zrušení nic neukládá a vrátí na přehled.
    await user.click(screen.getByRole('button', { name: 'Zrušit' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: '400 s polem',
      response: () =>
        HttpResponse.json(
          {
            error: 'Validation failed',
            issues: [{ path: ['breedingStationNumber'], message: 'Too long' }],
          },
          { status: 400 },
        ),
      label: 'Číslo chovatelské stanice',
      message:
        'Číslo chovatelské stanice: hodnotu server nepřijal. Zkontrolujte ji.',
    },
    {
      name: '413',
      response: () =>
        HttpResponse.json({ error: 'Payload too large' }, { status: 413 }),
      label: 'Osvědčení chovatelské stanice',
      message: 'Soubor je větší než 5 MiB.',
    },
    {
      name: '415',
      response: () =>
        HttpResponse.json(
          { error: 'Certificate must be a PDF, JPEG or PNG file' },
          { status: 415 },
        ),
      label: 'Osvědčení chovatelské stanice',
      message:
        'Soubor podle obsahu není PDF, JPEG ani PNG. Nahrajte jiný soubor.',
    },
  ])(
    'odmítnutí serverem ($name) označí pole a nic netvrdí jako odeslané',
    async ({ response, label, message }) => {
      storeAccount({ ...unsubmittedAccount, ...profile });
      server.use(http.post(submitPath, response));
      const user = userEvent.setup({ applyAccept: false });
      renderApp();
      await user.upload(
        await screen.findByLabelText(/^Osvědčení chovatelské stanice/),
        pdf(),
      );
      await user.click(screen.getByRole('button', { name: 'Odeslat žádost' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Žádost nebyla odeslána. Opravte označená pole.',
      );
      expect(control(label)).toHaveAccessibleDescription(
        expect.stringContaining(message),
      );
      expect(
        screen.queryByRole('heading', { name: 'Žádost byla odeslána' }),
      ).not.toBeInTheDocument();
    },
  );

  it('při výpadku nabídne opakování a formulář ponechá', async () => {
    storeAccount({ ...unsubmittedAccount, ...profile });
    const submit = vi
      .fn()
      .mockReturnValueOnce(new HttpResponse(null, { status: 503 }))
      .mockReturnValueOnce(
        HttpResponse.json(accountIn('PENDING'), { status: 201 }),
      );
    server.use(http.post(submitPath, () => submit()));
    const user = userEvent.setup({ applyAccept: false });
    renderApp();
    await user.upload(
      await screen.findByLabelText(/^Osvědčení chovatelské stanice/),
      pdf(),
    );
    const send = screen.getByRole('button', { name: 'Odeslat žádost' });
    await user.click(send);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Žádost se nepodařilo odeslat, služba je dočasně nedostupná. Zkuste to prosím znovu.',
    );
    await user.click(send);
    expect(
      await screen.findByRole('heading', { name: 'Žádost byla odeslána' }),
    ).toBeVisible();
  });

  it('při 409 ukáže aktuální stav žádosti místo formuláře', async () => {
    storeAccount({ ...unsubmittedAccount, ...profile });
    server.use(
      http.post(submitPath, () =>
        HttpResponse.json(
          {
            error: 'Verification already submitted',
            current: accountIn('PENDING'),
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup({ applyAccept: false });
    renderApp();
    await user.upload(
      await screen.findByLabelText(/^Osvědčení chovatelské stanice/),
      pdf(),
    );
    await user.click(screen.getByRole('button', { name: 'Odeslat žádost' }));

    expect(
      await screen.findByRole('heading', { name: 'Žádost čeká na posouzení' }),
    ).toBeVisible();
    expect(
      screen.getByText(/Žádost už byla mezitím odeslána nebo posouzena/),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Odeslat žádost' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Žádost byla odeslána' }),
    ).not.toBeInTheDocument();
  });
});

describe('oprava vrácené žádosti (ADR-0004)', () => {
  const returned = accountIn('RETURNED', {
    returnReason: 'Číslo stanice nesouhlasí s osvědčením.',
  });

  it('bez nového souboru pošle jen údaje a ponechá uložené osvědčení', async () => {
    const save = storeAccount(returned);
    let body: FormData | undefined;
    server.use(
      http.post(submitPath, async ({ request }) => {
        body = await request.formData();
        const pending = accountIn('PENDING', { revision: 2 });
        save(pending);
        return HttpResponse.json(pending, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    renderApp();

    expect(
      await screen.findByText('Důvod: Číslo stanice nesouhlasí s osvědčením.'),
    ).toBeVisible();
    expect(screen.getByText('osvedceni.pdf')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Stáhnout osvedceni.pdf' }),
    ).toBeEnabled();
    const number = control('Číslo chovatelské stanice');
    expect(number).toHaveValue('CZ-12345');
    await user.clear(number);
    await user.type(number, 'CZ-54321');
    await user.click(
      screen.getByRole('button', { name: 'Odeslat doplněnou žádost' }),
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Doplněná žádost byla odeslána',
      }),
    ).toBeVisible();
    expect(body?.get('breedingStationNumber')).toBe('CZ-54321');
    expect(body?.get('firstName')).toBe('Jana');
    expect(body?.has('breedingStationCertificate')).toBe(false);
  });

  it('s novým souborem pošle i nové osvědčení', async () => {
    storeAccount(returned);
    let body: FormData | undefined;
    server.use(
      http.post(submitPath, async ({ request }) => {
        body = await request.formData();
        return HttpResponse.json(accountIn('PENDING', { revision: 2 }), {
          status: 201,
        });
      }),
    );
    const user = userEvent.setup({ applyAccept: false });
    renderApp();
    await user.upload(
      await screen.findByLabelText(/^Osvědčení chovatelské stanice/),
      pdf('citelny-sken.pdf'),
    );
    expect(
      screen.getByText('Vybraný soubor po odeslání nahradí uložené osvědčení.'),
    ).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Odeslat doplněnou žádost' }),
    );
    await screen.findByRole('heading', {
      name: 'Doplněná žádost byla odeslána',
    });
    expect(body?.has('breedingStationCertificate')).toBe(true);
  });
});

describe('stavy bez formuláře', () => {
  it.each([
    { state: 'PENDING' as const, heading: 'Žádost čeká na posouzení' },
    { state: 'APPROVED' as const, heading: 'Účet je ověřen' },
    { state: 'REJECTED' as const, heading: 'Žádost byla zamítnuta' },
  ])(
    '$state: vysvětlí stav a formulář nenabízí',
    async ({ state, heading }) => {
      storeAccount(
        accountIn(state, {
          rejectionReason: state === 'REJECTED' ? 'Neplatné osvědčení.' : null,
        }),
      );
      const submit = vi.fn();
      server.use(http.post(submitPath, submit));
      renderApp();

      const panel = (await screen.findByRole('heading', { name: heading }))
        .parentElement as HTMLElement;
      expect(
        within(panel).getByRole('link', { name: 'Zpět na přehled' }),
      ).toHaveAttribute('href', '/');
      if (state === 'REJECTED')
        expect(
          within(panel).getByText('Důvod: Neplatné osvědčení.'),
        ).toBeVisible();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Osvědčení chovatelské stanice'),
      ).not.toBeInTheDocument();
      expect(submit).not.toHaveBeenCalled();
    },
  );
});
