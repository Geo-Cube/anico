import {
  animalBreeds,
  type Animal,
  type AnimalDocument,
  type AnimalDocumentHistory,
  type AnimalDocumentList,
  type DocumentAnimal,
  type DocumentReview,
} from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor, unsubmittedAccount } from './server';

const api = '/api/animal';
const breed = animalBreeds('dog')[0]!;
const animal: Animal = {
  id: '123456789012345678901234',
  ownerUserId: sessionFor().identity.userId,
  species: 'dog',
  breedId: breed.id,
  sex: 'female',
  name: 'Luna',
  birthDate: null,
  coatColor: null,
  weightKg: null,
  city: null,
  pedigreeNumber: null,
  microchipNumber: '203098100123456',
  description: null,
  photos: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentsState: 'PENDING',
};

const version = (
  id: string,
  overrides: Partial<AnimalDocument> = {},
): AnimalDocument => ({
  id,
  animalId: animal.id,
  documentType: 'PEDIGREE',
  versionNumber: 1,
  previousDocumentId: null,
  isCurrent: true,
  file: {
    fileName: `${id.slice(-4)}.pdf`,
    contentType: 'application/pdf',
    size: 2048,
  },
  assessmentStatus: 'PENDING',
  submittedAt: '2026-11-01T08:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
  rejectionReason: null,
  ...overrides,
});

const reviewed = {
  reviewedBy: '7c1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
  reviewedAt: '2026-11-02T09:00:00.000Z',
};
const rejectedV1 = version('aaaaaaaaaaaaaaaaaaaa0001', {
  ...reviewed,
  isCurrent: false,
  assessmentStatus: 'REJECTED',
  rejectionReason: 'Nečitelné číslo čipu.',
  file: { fileName: 'pruk-v1.pdf', contentType: 'application/pdf', size: 2048 },
});
const rejectedV2 = version('aaaaaaaaaaaaaaaaaaaa0002', {
  ...reviewed,
  versionNumber: 2,
  previousDocumentId: rejectedV1.id,
  assessmentStatus: 'REJECTED',
  rejectionReason: 'Chybí razítko plemenné knihy.',
  file: { fileName: 'pruk-v2.pdf', contentType: 'application/pdf', size: 2048 },
});
const pendingHealth = version('bbbbbbbbbbbbbbbbbbbb0001', {
  documentType: 'HEALTH_RESULTS',
  file: { fileName: 'dkk.png', contentType: 'image/png', size: 4096 },
});
const approvedBreeding = version('cccccccccccccccccccc0001', {
  ...reviewed,
  documentType: 'BREEDING_APPROVAL',
  assessmentStatus: 'APPROVED',
  file: { fileName: 'chovnost.jpg', contentType: 'image/jpeg', size: 2048 },
});
const list: AnimalDocumentList = {
  animalId: animal.id,
  documentsState: 'PENDING',
  documents: [rejectedV2, pendingHealth, approvedBreeding],
};
const documentAnimal: DocumentAnimal = {
  id: animal.id,
  ownerUserId: animal.ownerUserId,
  name: animal.name,
  species: animal.species,
  breedId: animal.breedId,
  sex: animal.sex,
  microchipNumber: null,
};
const pedigreeHistory: AnimalDocumentHistory = {
  animalId: animal.id,
  animal: documentAnimal,
  documentType: 'PEDIGREE',
  versions: [rejectedV1, rejectedV2],
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

const pdf = (name: string) =>
  new File(['%PDF-1.7'], name, { type: 'application/pdf' });

beforeEach(() => {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor())),
    http.get('/api/breeder/breeders/me', () =>
      HttpResponse.json({
        ...unsubmittedAccount,
        accountState: 'APPROVED',
        isVerified: true,
      }),
    ),
    http.get(`${api}/animals/:id`, () => HttpResponse.json(animal)),
    http.get(`${api}/animals/:id/documents`, () => HttpResponse.json(list)),
    http.get(`${api}/animals/:id/documents/:documentId/history`, () =>
      HttpResponse.json(pedigreeHistory),
    ),
  );
});

describe('doklady zvířete – chovatel', () => {
  it('profil ukazuje doklady se stavy, důvod zamítnutí a doplnění jen u zamítnutého (WF 01, 08)', async () => {
    renderApp(`/zvirata/${animal.id}`);
    const rejected = await screen.findByRole('listitem', {
      name: 'Průkaz původu: pruk-v2.pdf',
    });
    expect(rejected).toHaveTextContent('Zamítnuto');
    expect(rejected).toHaveTextContent(
      'Důvod zamítnutí: Chybí razítko plemenné knihy.',
    );
    expect(
      within(rejected).getByRole('link', { name: /^Doplnit doklad/ }),
    ).toHaveAttribute(
      'href',
      `/zvirata/${animal.id}/doklady/${rejectedV2.id}/doplnit`,
    );
    for (const name of [
      'Výsledky zdravotních vyšetření: dkk.png',
      'Doklad o chovnosti: chovnost.jpg',
    ]) {
      const item = screen.getByRole('listitem', { name });
      expect(
        within(item).queryByRole('link', { name: /^Doplnit doklad/ }),
      ).not.toBeInTheDocument();
    }
    expect(
      screen.getByRole('listitem', {
        name: 'Doklad o chovnosti: chovnost.jpg',
      }),
    ).toHaveTextContent('Schváleno');
  });

  it('nedovolí odeslat bez souboru, bez typu ani s nepodporovaným formátem (WF 02)', async () => {
    const submit = vi.fn();
    server.use(http.post(`${api}/animals/:id/documents`, submit));
    const user = userEvent.setup({ applyAccept: false });
    renderApp(`/zvirata/${animal.id}/doklady/nahrat`);
    const send = await screen.findByRole('button', {
      name: 'Odeslat k posouzení',
    });

    await user.click(send);
    expect(
      screen.getByText('Vyberte alespoň jeden soubor.'),
    ).toBeInTheDocument();

    await user.upload(screen.getByLabelText('Soubory dokladů'), [
      pdf('pruk.pdf'),
      new File(['x'], 'scan.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ]);
    const unsupported = screen.getByRole('listitem', { name: 'scan.docx' });
    expect(unsupported).toHaveTextContent('Nepodporovaný formát');
    await user.click(send);
    expect(
      screen.getByText('Ke každému souboru vyberte typ dokladu.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Odeberte soubory, které nelze nahrát (označené červeně).',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: 'Typ dokladu pro pruk.pdf' }),
    ).toHaveAccessibleDescription('Vyberte typ dokladu.');
    expect(submit).not.toHaveBeenCalled();
  });

  it('odešle více dokladů s typy jedním požadavkem a ukáže zavíratelnou zprávu (WF 02, 03, 08)', async () => {
    let body: FormData | undefined;
    server.use(
      http.post(`${api}/animals/:id/documents`, async ({ request }) => {
        expect(request.headers.get('X-CSRF-Token')).toBe('csrf-token');
        body = await request.formData();
        return HttpResponse.json(
          {
            animalId: animal.id,
            documentsState: 'PENDING',
            documents: [pendingHealth, pendingHealth],
          },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup({ applyAccept: false });
    const router = renderApp(`/zvirata/${animal.id}/doklady/nahrat`);
    await user.upload(await screen.findByLabelText('Soubory dokladů'), [
      pdf('pruk.pdf'),
      new File(['x'], 'scan.docx', { type: 'application/msword' }),
      new File(['png'], 'dkk.png', { type: 'image/png' }),
    ]);
    await user.click(screen.getByRole('button', { name: 'Odebrat scan.docx' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Typ dokladu pro pruk.pdf' }),
      'PEDIGREE',
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Typ dokladu pro dkk.png' }),
      'HEALTH_RESULTS',
    );
    await user.click(
      screen.getByRole('button', { name: 'Odeslat k posouzení' }),
    );

    const message = await screen.findByText(
      '2 doklady byly odeslány k posouzení. Výsledek uvidíte u dokladů.',
    );
    expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`);
    expect(body?.getAll('documentTypes')).toEqual([
      'PEDIGREE',
      'HEALTH_RESULTS',
    ]);
    // jsdom `File` projde do MSW bez názvu a obsahu; pořadí nesou typy výše.
    expect(body?.getAll('files')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Zavřít zprávu' }));
    expect(message).not.toBeInTheDocument();
  });

  it('historie ukazuje všechny verze a doplnění jen u aktuální zamítnuté verze', async () => {
    renderApp(`/zvirata/${animal.id}/doklady/${rejectedV1.id}`);
    const history = await screen.findByRole('list', { name: 'Historie verzí' });
    const [newest, oldest] = within(history).getAllByRole('listitem');
    expect(newest).toHaveTextContent('Verze 2aktuální');
    expect(oldest).toHaveTextContent('Důvod zamítnutí: Nečitelné číslo čipu.');
    expect(
      within(history).getAllByRole('link', { name: /^Doplnit doklad/ }),
    ).toHaveLength(1);
    expect(
      within(newest!).getByRole('link', { name: /^Doplnit doklad/ }),
    ).toBeInTheDocument();
  });

  it('nahrazenou verzi doplnit nelze', async () => {
    renderApp(`/zvirata/${animal.id}/doklady/${rejectedV1.id}/doplnit`);
    expect(
      await screen.findByRole('heading', {
        name: 'Tento doklad už nelze doplnit',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Odeslat novou verzi' }),
    ).not.toBeInTheDocument();
  });

  it('aktuální zamítnutou verzi doplní nová verze a výsledek je zavíratelná zpráva (WF 09)', async () => {
    let uploaded: File | undefined;
    server.use(
      http.post(
        `${api}/animals/:id/documents/:documentId/versions`,
        async ({ request, params }) => {
          expect(params.documentId).toBe(rejectedV2.id);
          uploaded = (await request.formData()).get('file') as File;
          return HttpResponse.json(
            version('aaaaaaaaaaaaaaaaaaaa0003', {
              versionNumber: 3,
              previousDocumentId: rejectedV2.id,
            }),
            { status: 201 },
          );
        },
      ),
    );
    const user = userEvent.setup({ applyAccept: false });
    renderApp(`/zvirata/${animal.id}/doklady/${rejectedV2.id}/doplnit`);

    expect(
      await screen.findByText(/Chybí razítko plemenné knihy\./),
    ).toHaveTextContent('Důvod zamítnutí: Chybí razítko plemenné knihy.');
    const send = screen.getByRole('button', { name: 'Odeslat novou verzi' });
    await user.click(send);
    const input = screen.getByLabelText(/Opravený soubor/);
    expect(input).toHaveAccessibleDescription(
      'PDF, JPEG nebo PNG, nejvýše 10 MiB Vyberte soubor s opraveným dokladem.',
    );
    await user.upload(
      input,
      new File(['x'], 'pruk.txt', { type: 'text/plain' }),
    );
    expect(
      screen.getByText('Nepodporovaný formát. Nahrajte PDF, JPEG nebo PNG.'),
    ).toBeInTheDocument();
    await user.click(send);
    expect(uploaded).toBeUndefined();

    await user.upload(input, pdf('pruk-v3.pdf'));
    await user.click(send);
    expect(
      await screen.findByText(
        'Nová verze dokladu Průkaz původu byla odeslána k posouzení.',
      ),
    ).toBeInTheDocument();
    expect(uploaded).toBeDefined();
  });

  it('stáhne doklad pod uloženým názvem a chybu stažení zobrazí', async () => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:document'),
        revokeObjectURL: vi.fn(),
      }),
    );
    let fail = true;
    server.use(
      http.get(`${api}/animals/:id/documents/:documentId/file`, () =>
        fail
          ? HttpResponse.json({ error: 'Document not found' }, { status: 404 })
          : new HttpResponse('%PDF-1.7', {
              headers: { 'Content-Type': 'application/pdf' },
            }),
      ),
    );
    renderApp(`/zvirata/${animal.id}`);
    const download = await screen.findByRole('button', {
      name: 'Stáhnout pruk-v2.pdf',
    });
    await userEvent.click(download);
    expect(
      await screen.findByText('Soubor nebyl nalezen.'),
    ).toBeInTheDocument();

    fail = false;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    await userEvent.click(download);
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(click.mock.contexts[0]).toMatchObject({
      download: 'pruk-v2.pdf',
      href: 'blob:document',
    });
    click.mockRestore();
  });
});

describe('doklady zvířete – administrátor', () => {
  const pendingV3 = version('aaaaaaaaaaaaaaaaaaaa0003', {
    versionNumber: 3,
    previousDocumentId: rejectedV2.id,
    file: {
      fileName: 'pruk-v3.pdf',
      contentType: 'application/pdf',
      size: 2048,
    },
  });
  const review: DocumentReview = {
    document: pendingV3,
    animal: documentAnimal,
  };
  const history: AnimalDocumentHistory = {
    ...pedigreeHistory,
    versions: [rejectedV1, { ...rejectedV2, isCurrent: false }, pendingV3],
  };

  beforeEach(() => {
    server.use(
      http.get('/api/auth/session', () =>
        HttpResponse.json(sessionFor(['breeder', 'admin'])),
      ),
      http.get('/api/breeder/verification-requests/summary', () =>
        HttpResponse.json({
          pending: 0,
          returned: 0,
          approved: 0,
          rejected: 0,
        }),
      ),
      http.get(`${api}/document-reviews`, () =>
        HttpResponse.json({ items: [review] }),
      ),
      http.get(`${api}/animals/:id/documents/:documentId/history`, () =>
        HttpResponse.json(history),
      ),
    );
  });

  it('z přehledu přes frontu posoudí a zamítne doklad s důvodem a vrátí se do fronty (WF 04–07)', async () => {
    let decision: unknown;
    server.use(
      http.post(
        `${api}/animals/:id/documents/:documentId/decision`,
        async ({ request }) => {
          decision = await request.json();
          return HttpResponse.json({
            ...pendingV3,
            ...reviewed,
            assessmentStatus: 'REJECTED',
            rejectionReason: 'Razítko chybí i ve verzi 3.',
          });
        },
      ),
    );
    const router = renderApp('/administrace/chovatele');
    await userEvent.click(
      await screen.findByRole('link', { name: 'Zobrazit doklady' }),
    );
    const row = (await screen.findByText('Luna')).closest('tr')!;
    expect(row).toHaveTextContent('Neuvedeno');
    expect(row).toHaveTextContent('verze 3');
    await userEvent.click(
      within(row).getByRole('link', {
        name: 'Posoudit doklad: Luna, Průkaz původu',
      }),
    );

    expect(
      await screen.findByText(
        'Neuvedeno – bez čísla čipu nelze doklad ověřit.',
      ),
    ).toBeInTheDocument();
    const versions = screen.getByRole('list', { name: 'Historie verzí' });
    expect(within(versions).getAllByRole('listitem')).toHaveLength(3);
    expect(versions).toHaveTextContent('Chybí razítko plemenné knihy.');

    await userEvent.click(screen.getByRole('button', { name: 'Zamítnout' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit zamítnutí' }),
    );
    expect(
      within(dialog).getByText('Důvod zamítnutí je povinný.'),
    ).toBeInTheDocument();
    expect(decision).toBeUndefined();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: /Důvod zamítnutí/ }),
      'Razítko chybí i ve verzi 3.',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit zamítnutí' }),
    );

    const notice = await screen.findByText(
      'Doklad Průkaz původu zvířete Luna byl zamítnut. Chovatel uvidí důvod u dokladu.',
    );
    expect(decision).toEqual({
      decision: 'REJECTED',
      rejectionReason: 'Razítko chybí i ve verzi 3.',
    });
    expect(router.state.location.pathname).toBe(
      '/administrace/chovatele/doklady',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Zavřít zprávu' }),
    );
    expect(notice).not.toBeInTheDocument();
  });

  it('posouzený doklad mimo frontu ukáže údaje o zvířeti z historie bez tlačítek posouzení', async () => {
    server.use(
      http.get(`${api}/document-reviews`, () =>
        HttpResponse.json({ items: [] }),
      ),
    );
    renderApp(`/administrace/chovatele/doklady/${animal.id}/${rejectedV1.id}`);
    expect(
      await screen.findByRole('heading', { name: 'Luna' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Neuvedeno – bez čísla čipu nelze doklad ověřit.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Schválit doklad' }),
    ).not.toBeInTheDocument();
  });

  it('schválení se uloží až po potvrzení; souběžné rozhodnutí (409) ukáže uložený výsledek', async () => {
    const approved = {
      ...pendingV3,
      ...reviewed,
      assessmentStatus: 'APPROVED' as const,
    };
    let decided = false;
    server.use(
      http.post(`${api}/animals/:id/documents/:documentId/decision`, () => {
        decided = true;
        return HttpResponse.json(
          { error: 'Document already decided', current: approved },
          { status: 409 },
        );
      }),
      http.get(`${api}/animals/:id/documents/:documentId/history`, () =>
        HttpResponse.json(
          decided
            ? {
                ...history,
                versions: [...history.versions.slice(0, 2), approved],
              }
            : history,
        ),
      ),
    );
    renderApp(`/administrace/chovatele/doklady/${animal.id}/${pendingV3.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Schválit doklad' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      'Opravdu chcete schválit doklad Průkaz původu zvířete Luna?',
    );
    expect(decided).toBe(false);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Potvrdit schválení' }),
    );
    expect(
      await screen.findByText(
        'Jiný administrátor už o tomto dokladu rozhodl. Zobrazuji uložený výsledek.',
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Schválit doklad' }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Zamítnout' }),
    ).not.toBeInTheDocument();
  });
});
