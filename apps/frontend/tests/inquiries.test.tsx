import type { SubmitInquiryResponse } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import type { OfferSummary } from '@/features/inquiries/offer-summary';
import { server, sessionFor, unsubmittedAccount } from './server';

// Mock hlavičky nabídky je konstanta; testy nedostupné nabídky ho přepíší.
const summary = vi.hoisted(() => ({
  override: {} as Partial<OfferSummary>,
}));
vi.mock('@/features/inquiries/offer-summary', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/inquiries/offer-summary')>();
  return {
    ...actual,
    useOfferSummary: (offerId: string) => ({
      ...actual.useOfferSummary(offerId),
      ...summary.override,
    }),
  };
});

const offerId = '64f000000000000000000002';
const formPath = `/nabidky/${offerId}/poptavka`;
const sentPath = `${formPath}/odeslano`;
const endpoint = `/api/animal/offers/${offerId}/inquiries`;

const inquiry: SubmitInquiryResponse = {
  id: '64f000000000000000000001',
  offerId,
  animalName: 'Luna',
  // Jiný kraj než v mocku hlavičky: potvrzení musí brát data z odpovědi.
  regionId: 'plzensky',
  message: 'Zajímá mě krytí.\nOzvěte se prosím.',
  status: 'PENDING',
  submittedAt: '2026-11-20T18:30:00.000Z',
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

/** Odpověď API čeká na `release`; `done` se splní, až ji MSW odešle. */
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

type Captured = { csrf: string | null; body: unknown };

/** Zaznamená každé odeslání poptávky a odpoví `response`. */
function answerWith(response: () => Response) {
  const requests: Captured[] = [];
  server.use(
    http.post(endpoint, async ({ request }) => {
      requests.push({
        csrf: request.headers.get('X-CSRF-Token'),
        body: await request.json(),
      });
      return response();
    }),
  );
  return requests;
}

const error = (status: number, body: Record<string, unknown>) => () =>
  HttpResponse.json(body, { status });

/** Doběhnutí zpožděné odpovědi včetně jejích callbacků. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const messageField = () => screen.findByRole('textbox', { name: /Zpráva/ });
const submitButton = () =>
  screen.getByRole('button', { name: /Odeslat poptávku|Odesílám/ });

async function writeAndSubmit(text: string) {
  await userEvent.type(await messageField(), text);
  await userEvent.click(submitButton());
}

beforeEach(() => {
  summary.override = {};
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor())),
    http.get('/api/breeder/breeders/me', () =>
      HttpResponse.json({
        ...unsubmittedAccount,
        accountState: 'APPROVED',
        isVerified: true,
      }),
    ),
  );
});

describe('UC-07 formulář poptávky (WF 01)', () => {
  it('ukáže souhrn nabídky, povinné pole Zpráva a text souhlasu', async () => {
    renderApp(formPath);

    expect(
      await screen.findByRole('heading', { name: 'Odeslat poptávku' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Rex z Modrého údolí' }),
    ).toHaveAttribute('href', `/nabidky/${offerId}`);
    expect(
      screen.getByText('Pes · Labradorský retrívr · Jihomoravský kraj'),
    ).toBeInTheDocument();
    const field = await messageField();
    expect(field).toHaveAttribute('aria-required', 'true');
    expect(field).toHaveAttribute('maxLength', '1000');
    expect(screen.getByText('0 / 1000')).toBeInTheDocument();
    expect(
      screen.getByText(/souhlasíte se zpřístupněním svých kontaktních údajů/),
    ).toBeInTheDocument();
    // Vlastní zvíře se nevybírá.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('prázdnou zprávu ani zprávu jen z mezer neodešle a označí pole', async () => {
    const requests = answerWith(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    renderApp(formPath);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Odeslat poptávku' }),
    );
    const field = await messageField();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(
      screen.getByText('Napište zprávu pro majitele nabídky.'),
    ).toBeInTheDocument();

    await writeAndSubmit('   ');
    expect(
      screen.getByText('Napište zprávu pro majitele nabídky.'),
    ).toBeInTheDocument();
    await settle();
    expect(requests).toHaveLength(0);
  });

  it('odešle oříznutou zprávu s CSRF a ukáže potvrzení z odpovědi (WF 02)', async () => {
    const requests = answerWith(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    const router = renderApp(formPath);

    await writeAndSubmit('  Zajímá mě krytí.  ');

    expect(await screen.findByText('Poptávka byla odeslána.')).toBeVisible();
    expect(router.state.location.pathname).toBe(sentPath);
    expect(requests).toEqual([
      { csrf: 'csrf-token', body: { message: 'Zajímá mě krytí.' } },
    ]);
    expect(
      screen.getByRole('heading', { name: 'Potvrzení odeslání' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('Plzeňský kraj')).toBeInTheDocument();
    expect(screen.getByText('Čeká na vyřízení')).toBeInTheDocument();
    expect(screen.getByText(/Zajímá mě krytí\.\s+Ozvěte se/)).toBeVisible();
    expect(
      screen.getByText(/Kontaktní údaje zatím nejsou dostupné/),
    ).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute(
      'dateTime',
      inquiry.submittedAt,
    );
    expect(
      screen.getByRole('link', { name: 'Zpět na nabídky' }),
    ).toHaveAttribute('href', '/nabidky');
    // `replace`: formulář už v historii není.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('během odesílání zamkne formulář; dvojklik pošle jediný požadavek', async () => {
    const response = heldResponse(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    let calls = 0;
    server.use(
      http.post(endpoint, () => {
        calls += 1;
        return response.handler();
      }),
    );
    renderApp(formPath);

    await userEvent.type(await messageField(), 'Zajímá mě krytí.');
    await userEvent.dblClick(submitButton());

    expect(
      await screen.findByRole('button', { name: /Odesílám…/ }),
    ).toBeDisabled();
    expect(await messageField()).toBeDisabled();
    await userEvent.click(submitButton());
    response.release();
    await response.done;
    expect(await screen.findByText('Poptávka byla odeslána.')).toBeVisible();
    expect(calls).toBe(1);
  });

  it('409 neaktivní nabídky (A4) ukáže stav místo formuláře, bez potvrzení', async () => {
    answerWith(
      error(409, {
        error: 'Offer is no longer active',
        current: { id: offerId, status: 'WITHDRAWN' },
      }),
    );
    const router = renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(
      await screen.findByRole('heading', { name: 'Nabídka již není aktivní' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zpět na nabídky' }),
    ).toHaveAttribute('href', '/nabidky');
    expect(screen.queryByText(/WITHDRAWN/)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(formPath);
  });

  it('409 duplicitní poptávky (A3) nabídne návrat na detail i seznam', async () => {
    answerWith(error(409, { error: 'Inquiry is already pending' }));
    renderApp(`${formPath}?region=plzensky`);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(
      await screen.findByRole('heading', {
        name: 'Poptávka už čeká na vyřízení',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/už máte odeslanou poptávku, která čeká na vyřízení/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zpět na detail nabídky' }),
    ).toHaveAttribute('href', `/nabidky/${offerId}?region=plzensky`);
    expect(
      screen.getByRole('link', { name: 'Zpět na nabídky' }),
    ).toBeInTheDocument();
  });

  it('jiný konflikt 409 ukáže chybu ve formuláři', async () => {
    answerWith(error(409, { error: 'Offer changed concurrently' }));
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nabídka se mezitím změnila. Zkuste to prosím znovu.',
    );
  });

  it.each([
    [
      'Offer owner is not verified',
      'Majitel této nabídky zatím nemá ověřený účet. Poptávku teď nelze odeslat.',
    ],
    [
      'Breeder is not verified',
      'Nejdřív musí být ověřen váš chovatelský účet. Poptávku zatím nelze odeslat.',
    ],
    ['Forbidden', 'K této operaci nemáte oprávnění.'],
  ])(
    '403 „%s“ ukáže chybu ve formuláři a zpráva v poli zůstane',
    async (code, text) => {
      answerWith(error(403, { error: code }));
      const router = renderApp(formPath);

      await writeAndSubmit('Zajímá mě krytí.');

      expect(await screen.findByRole('alert')).toHaveTextContent(text);
      expect(await messageField()).toHaveValue('Zajímá mě krytí.');
      expect(router.state.location.pathname).toBe(formPath);
    },
  );

  it('404 ukáže „Nabídka nebyla nalezena“', async () => {
    answerWith(error(404, { error: 'Offer not found' }));
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(
      await screen.findByRole('heading', { name: 'Nabídka nebyla nalezena' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nabídka neexistuje nebo už není dostupná.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('400 s příliš dlouhou zprávou označí pole; úprava textu chybu skryje', async () => {
    answerWith(
      error(400, {
        error: 'Validation failed',
        issues: [{ code: 'too_big', path: ['message'], message: 'Too big' }],
      }),
    );
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    const field = await messageField();
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(
      screen.getByText('Zpráva může mít nejvýše 1000 znaků.'),
    ).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.type(field, '!');
    expect(
      screen.queryByText('Zpráva může mít nejvýše 1000 znaků.'),
    ).not.toBeInTheDocument();
  });

  it('400 s prázdnou zprávou ze serveru označí pole jako povinné', async () => {
    answerWith(
      error(400, {
        error: 'Validation failed',
        issues: [{ code: 'too_small', path: ['message'] }],
      }),
    );
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(
      await screen.findByText('Napište zprávu pro majitele nabídky.'),
    ).toBeInTheDocument();
  });

  it('413 označí pole zprávou o příliš dlouhé zprávě', async () => {
    answerWith(error(413, { error: 'Payload too large' }));
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(
      await screen.findByText('Zpráva je příliš dlouhá.'),
    ).toBeInTheDocument();
  });

  it.each([
    [
      'neplatné ID v cestě',
      {
        error: 'Validation failed',
        issues: [{ code: 'invalid_format', path: ['offerId'] }],
      },
    ],
    ['Invalid JSON', { error: 'Invalid JSON' }],
  ])(
    '400 bez chyby zprávy (%s) ukáže obecnou chybu ve formuláři',
    async (_, body) => {
      answerWith(error(400, body));
      renderApp(formPath);

      await writeAndSubmit('Zajímá mě krytí.');

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Poptávku se nepodařilo odeslat. Zkontrolujte zprávu a zkuste to znovu.',
      );
      expect(await messageField()).not.toHaveAttribute('aria-invalid');
    },
  );

  it('503 ukáže chybu ve formuláři a nové kliknutí pošle požadavek znovu', async () => {
    let failures = 1;
    const requests = answerWith(() =>
      failures-- > 0
        ? HttpResponse.json(
            { error: 'Breeder verification unavailable' },
            { status: 503 },
          )
        : HttpResponse.json(inquiry, { status: 201 }),
    );
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Služba je dočasně nedostupná, zkuste to znovu.',
    );
    expect(await messageField()).toHaveValue('Zajímá mě krytí.');
    // Žádné automatické opakování.
    await settle();
    expect(requests).toHaveLength(1);

    await userEvent.click(submitButton());
    expect(await screen.findByText('Poptávka byla odeslána.')).toBeVisible();
    expect(requests).toHaveLength(2);
  });

  it('chybu ve formuláři lze zavřít', async () => {
    answerWith(() => HttpResponse.error());
    renderApp(formPath);

    await writeAndSubmit('Zajímá mě krytí.');
    await screen.findByRole('alert');
    await userEvent.click(
      screen.getByRole('button', { name: 'Zavřít zprávu' }),
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await messageField()).toHaveValue('Zajímá mě krytí.');
  });

  it('Zrušit vrátí na detail nabídky bez požadavku', async () => {
    const requests = answerWith(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    const router = renderApp(`${formPath}?region=plzensky`);

    await userEvent.type(await messageField(), 'Rozepsaná zpráva');
    await userEvent.click(screen.getByRole('button', { name: 'Zrušit' }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/nabidky/${offerId}`),
    );
    expect(router.state.location.search).toBe('?region=plzensky');
    expect(requests).toHaveLength(0);
  });

  it('po přihlášení jiného účtu během odesílání nezobrazí potvrzení', async () => {
    const response = heldResponse(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    server.use(http.post(endpoint, response.handler));
    const client = createQueryClient();
    const router = renderApp(formPath, client);

    await writeAndSubmit('Zajímá mě krytí.');
    await screen.findByRole('button', { name: /Odesílám…/ });
    const base = sessionFor();
    const other = {
      ...base,
      identity: { ...base.identity, userId: crypto.randomUUID() },
    };
    server.use(http.get('/api/auth/session', () => HttpResponse.json(other)));
    client.setQueryData(['session'], other);
    response.release();
    await response.done;
    await settle();

    expect(router.state.location.pathname).toBe(formPath);
    expect(
      screen.queryByText('Poptávka byla odeslána.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['neaktivní', { isActive: false }],
    ['vlastní', { isOwnOffer: true }],
  ])('u %s nabídky formulář nezobrazí', async (_, override) => {
    summary.override = override;
    renderApp(formPath);

    expect(
      await screen.findByRole('heading', {
        name: 'Na tuto nabídku nelze odeslat poptávku',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zpět na detail nabídky' }),
    ).toHaveAttribute('href', `/nabidky/${offerId}`);
  });

  it('neověřenému chovateli formulář nezobrazí', async () => {
    server.use(
      http.get('/api/breeder/breeders/me', () =>
        HttpResponse.json(unsubmittedAccount),
      ),
    );
    renderApp(formPath);

    expect(
      await screen.findByRole('heading', {
        name: 'Nejdřív ověřte chovatelský účet',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('tlačítko na detailu nabídky (US-06) vede na formulář', async () => {
    const router = renderApp(`/nabidky/${offerId}`);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Odeslat poptávku' }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe(formPath));
    expect(await messageField()).toBeInTheDocument();
  });
});

describe('UC-07 potvrzení odeslání (WF 02)', () => {
  it('bez state (reload, přímý odkaz) potvrzení nezobrazí a nic neodešle', async () => {
    const requests = answerWith(() =>
      HttpResponse.json(inquiry, { status: 201 }),
    );
    renderApp(sentPath);

    expect(
      await screen.findByRole('heading', {
        name: 'Potvrzení už není k dispozici',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zpět na detail nabídky' }),
    ).toHaveAttribute('href', `/nabidky/${offerId}`);
    await settle();
    expect(requests).toHaveLength(0);
  });

  it('state jiné nabídky nebo neplatný state nezobrazí', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: [
        {
          pathname: sentPath,
          state: {
            inquiry: { ...inquiry, offerId: '64f000000000000000000099' },
          },
        },
      ],
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('heading', {
        name: 'Potvrzení už není k dispozici',
      }),
    ).toBeInTheDocument();
  });

  it('zavření potvrzení skryje zprávu, zbytek obrazovky zůstane', async () => {
    answerWith(() => HttpResponse.json(inquiry, { status: 201 }));
    renderApp(formPath);
    await writeAndSubmit('Zajímá mě krytí.');
    await screen.findByText('Poptávka byla odeslána.');

    await userEvent.click(
      screen.getByRole('button', { name: 'Zavřít zprávu' }),
    );

    expect(
      screen.queryByText('Poptávka byla odeslána.'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Potvrzení odeslání' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('Čeká na vyřízení')).toBeInTheDocument();
  });
});
