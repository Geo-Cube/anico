import { animalBreeds, type Animal } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor, unsubmittedAccount } from './server';
import { ageLabel } from '@/features/animals/api';

const breed = animalBreeds('dog')[0]!;
const horseBreed = animalBreeds('horse')[0]!;
const animal: Animal = {
  id: '123456789012345678901234',
  ownerUserId: sessionFor().identity.userId,
  species: 'dog',
  breedId: breed.id,
  sex: 'male',
  name: 'Argo',
  birthDate: null,
  coatColor: null,
  weightKg: null,
  city: 'Praha',
  pedigreeNumber: null,
  microchipNumber: null,
  description: null,
  photos: [
    {
      id: '123456789012345678901235',
      fileName: 'argo.jpg',
      contentType: 'image/jpeg',
      size: 50,
      isPrimary: true,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  documentsState: 'PENDING',
};
/** Zvíře se dvěma fotografiemi; hlavní je první. */
const withTwoPhotos: Animal = {
  ...animal,
  weightKg: 12.5,
  photos: [
    animal.photos[0]!,
    {
      id: '123456789012345678901236',
      fileName: 'luna.jpg',
      contentType: 'image/jpeg',
      size: 60,
      isPrimary: false,
    },
  ],
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

/** Mezitím se ve stejném prohlížeči přihlásí jiný účet (např. v jiné záložce). */
async function switchAccount(client: ReturnType<typeof createQueryClient>) {
  const other = sessionFor(['breeder'], {
    identity: {
      ...sessionFor().identity,
      userId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
      email: 'petr@example.test',
    },
  });
  server.use(http.get('/api/auth/session', () => HttpResponse.json(other)));
  await client.invalidateQueries({ queryKey: ['session'] });
  await waitFor(() => expect(client.getQueryData(['session'])).toEqual(other));
}

/** Doběhnutí zpožděné odpovědi včetně jejích callbacků. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const field = (name: string) => screen.getByRole('textbox', { name });
const select = (name: string) => screen.getByRole('combobox', { name });
const button = (name: string) => screen.getByRole('button', { name });

/** Vyplní povinné údaje nového zvířete (WF 02). */
async function fillProfile() {
  await screen.findByRole('option', { name: breed.name });
  await userEvent.type(field('Jméno'), 'Argo');
  await userEvent.selectOptions(select('Plemeno'), breed.id);
}

beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    }),
  );
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor())),
    http.get('/api/breeder/breeders/me', () =>
      HttpResponse.json({
        ...unsubmittedAccount,
        accountState: 'APPROVED',
        isVerified: true,
      }),
    ),
    http.get('/api/animal/breeds/:species', ({ params }) =>
      HttpResponse.json({
        species: params.species,
        breeds: animalBreeds(params.species as 'dog' | 'horse'),
      }),
    ),
    http.get('/api/animal/animals', () =>
      HttpResponse.json({ items: [animal], nextCursor: null }),
    ),
    http.get('/api/animal/animals/:id', () => HttpResponse.json(animal)),
    http.get(
      '/api/animal/animals/:id/photos/:photoId/file',
      () =>
        new HttpResponse(null, { headers: { 'Content-Type': 'image/jpeg' } }),
    ),
  );
});

describe('Moje zvířata (WF 01)', () => {
  it('zobrazuje kartu s hlavní fotografií, stavem dokladů a další stránku', async () => {
    server.use(
      http.get('/api/animal/animals', ({ request }) =>
        new URL(request.url).searchParams.has('before')
          ? HttpResponse.json({
              items: [
                {
                  ...animal,
                  id: '123456789012345678abcdef',
                  name: 'Luna',
                  photos: [],
                  documentsState: 'NOT_SUBMITTED',
                },
              ],
              nextCursor: null,
            })
          : HttpResponse.json({ items: [animal], nextCursor: animal.id }),
      ),
    );
    renderApp('/zvirata');
    const card = (await screen.findByRole('heading', { name: 'Argo' })).closest(
      'li',
    )!;
    expect(
      within(card).getByRole('link', { name: 'Zobrazit detail: Argo' }),
    ).toHaveAttribute('href', `/zvirata/${animal.id}`);
    // karta stahuje zmenšeninu, ne originál
    expect(card.querySelector('img')).toHaveAttribute(
      'src',
      `/api/animal/animals/${animal.id}/photos/${animal.photos[0]!.id}/file?size=thumbnail`,
    );
    expect(card).toHaveTextContent('Doklady čekají na posouzení');
    await userEvent.click(button('Načíst další'));
    const luna = (await screen.findByRole('heading', { name: 'Luna' })).closest(
      'li',
    )!;
    expect(luna).toHaveTextContent('Bez fotografie');
    expect(luna).toHaveTextContent('Bez dokladů');
  });

  it('filtruje podle druhu, plemene daného druhu a pohlaví', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get('/api/animal/animals', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [animal], nextCursor: null });
      }),
    );
    const router = renderApp('/zvirata');
    await screen.findByRole('heading', { name: 'Argo' });
    expect(select('Plemeno')).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: 'Kůň' }));
    await screen.findByRole('option', { name: horseBreed.name });
    expect(
      screen.queryByRole('option', { name: breed.name }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(select('Plemeno'), horseBreed.id);
    await userEvent.click(screen.getByRole('radio', { name: 'Samice' }));
    await waitFor(() =>
      expect(Object.fromEntries(queries.at(-1)!)).toEqual({
        species: 'horse',
        breedId: horseBreed.id,
        sex: 'female',
        limit: '20',
      }),
    );

    // změna druhu zruší plemeno, které k novému druhu nepatří
    await userEvent.click(screen.getByRole('radio', { name: 'Pes' }));
    await waitFor(() =>
      expect(router.state.location.search).toBe('?sex=female&species=dog'),
    );
    expect(select('Plemeno')).toHaveValue('');
    await userEvent.click(button('Vymazat filtry'));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('rozlišuje prázdný seznam a filtr bez výsledku', async () => {
    server.use(
      http.get('/api/animal/animals', () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );
    renderApp('/zvirata?species=horse');
    expect(
      await screen.findByRole('heading', {
        name: 'Filtru neodpovídá žádné zvíře',
      }),
    ).toBeVisible();
    await userEvent.click(
      within(screen.getByRole('main')).getAllByRole('button', {
        name: 'Vymazat filtry',
      })[1]!,
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Zatím nemáte žádná zvířata',
      }),
    ).toBeVisible();
  });
});

describe('ověřený chovatel', () => {
  it('neověřenému chovateli vysvětlí ověření a API zvířat nevolá', async () => {
    const list = vi.fn(() =>
      HttpResponse.json({ items: [animal], nextCursor: null }),
    );
    server.use(
      http.get('/api/breeder/breeders/me', () =>
        HttpResponse.json(unsubmittedAccount),
      ),
      http.get('/api/animal/animals', list),
    );
    renderApp('/zvirata/nove');
    expect(
      await screen.findByRole('heading', {
        name: 'Nejdřív ověřte chovatelský účet',
      }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Podat žádost o ověření' }),
    ).toHaveAttribute('href', '/overeni-chovatele');
    expect(list).not.toHaveBeenCalled();
  });

  it('vysvětlí 403 animal-service (projekce ještě nedorazila) bez odhlášení', async () => {
    server.use(
      http.get('/api/animal/animals', () =>
        HttpResponse.json(
          { error: 'Breeder is not verified' },
          { status: 403 },
        ),
      ),
    );
    const router = renderApp('/zvirata');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Nejdřív musí být ověřen váš chovatelský účet',
    );
    expect(router.state.location.pathname).toBe('/zvirata');
    // cesta dál: stav ověření na účtu
    await userEvent.click(
      within(alert).getByRole('link', { name: 'Přejít na účet' }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/ucet'));
  });

  it('výpadek ověření chovatele vysvětlí a opakování seznam načte', async () => {
    let calls = 0;
    server.use(
      http.get('/api/animal/animals', () =>
        ++calls <= 2
          ? HttpResponse.json(
              { error: 'Breeder verification unavailable' },
              { status: 503 },
            )
          : HttpResponse.json({ items: [animal], nextCursor: null }),
      ),
    );
    renderApp('/zvirata');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Ověření chovatelského účtu je dočasně nedostupné.',
    );
    // výpadek nevyžaduje nové ověření účtu
    expect(
      within(alert).queryByRole('link', { name: 'Přejít na účet' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Zkusit znovu' }),
    );
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('nedostupná plemena ve filtru lze načíst znovu', async () => {
    let calls = 0;
    server.use(
      http.get('/api/animal/breeds/:species', () =>
        ++calls <= 2
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({
              species: 'horse',
              breeds: animalBreeds('horse'),
            }),
      ),
    );
    renderApp('/zvirata?species=horse');
    await screen.findByRole('heading', { name: 'Argo' });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Služba je dočasně nedostupná');
    expect(select('Plemeno')).toBeDisabled();
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Zkusit znovu' }),
    );
    await screen.findByRole('option', { name: horseBreed.name });
    expect(select('Plemeno')).toBeEnabled();
  });
});

describe('Přidání zvířete (WF 02, 03)', () => {
  it('nabízí plemena jen vybraného druhu a změna druhu plemeno zruší', async () => {
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: breed.name });
    expect(
      screen.queryByRole('option', { name: horseBreed.name }),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(select('Plemeno'), breed.id);
    await userEvent.selectOptions(select('Druh'), 'horse');
    await screen.findByRole('option', { name: horseBreed.name });
    expect(
      screen.queryByRole('option', { name: breed.name }),
    ).not.toBeInTheDocument();
    expect(select('Plemeno')).toHaveValue('');
  });

  it('nepustí dál bez povinných údajů a ukáže české chyby u polí', async () => {
    const submit = vi.fn(() => HttpResponse.json(animal, { status: 201 }));
    server.use(http.post('/api/animal/animals', submit));
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: breed.name });
    await userEvent.click(button('Pokračovat na fotografie'));
    expect(field('Jméno')).toHaveAccessibleDescription(
      'Vyplňte jméno zvířete.',
    );
    expect(select('Plemeno')).toHaveAccessibleDescription('Vyberte plemeno.');
    await waitFor(() => expect(field('Jméno')).toHaveFocus());
    expect(
      screen.queryByRole('heading', { name: 'Fotografie' }),
    ).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('odmítne budoucí datum narození podle českého dne a nekladnou hmotnost', async () => {
    // 23:30 UTC 6. 11. je v Česku už 7. 11. (00:30 SEČ): „dnes“ i „zítra“ se liší od UTC.
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-06T23:30:00Z'),
    });
    try {
      renderApp('/zvirata/nove');
      await fillProfile();
      const date = screen.getByLabelText('Datum narození');
      await userEvent.type(field('Hmotnost (kg)'), '0');
      // jsdom zahodí neúplné datum, proto celá hodnota najednou místo psaní po znacích
      fireEvent.change(date, { target: { value: '2026-11-07' } });
      await userEvent.click(button('Pokračovat na fotografie'));
      expect(date).not.toHaveAccessibleDescription(
        'Datum narození nesmí být v budoucnosti.',
      );
      expect(field('Hmotnost (kg)')).toHaveAccessibleDescription(
        'Hmotnost musí být větší než 0 kg.',
      );

      fireEvent.change(date, { target: { value: '2026-11-08' } });
      await userEvent.click(button('Pokračovat na fotografie'));
      expect(date).toHaveAccessibleDescription(
        'Datum narození nesmí být v budoucnosti.',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('ukládá údaje i fotografie jedním multipart požadavkem a potvrdí výsledek', async () => {
    const requests: Request[] = [];
    let payload: unknown;
    let uploads: FormDataEntryValue[] = [];
    server.use(
      http.post('/api/animal/animals', async ({ request }) => {
        requests.push(request);
        const data = await request.formData();
        payload = JSON.parse(String(data.get('animal')));
        uploads = data.getAll('photos');
        return HttpResponse.json(animal, { status: 201 });
      }),
    );
    const router = renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.type(field('Hmotnost (kg)'), '12,5');
    await userEvent.click(screen.getByRole('radio', { name: 'Samice' }));
    await userEvent.click(button('Pokračovat na fotografie'));
    const photosHeading = await screen.findByRole('heading', {
      name: 'Fotografie',
    });
    await waitFor(() => expect(photosHeading).toHaveFocus());
    expect(requests).toHaveLength(0);
    await userEvent.upload(screen.getByLabelText(/Přidat fotografie/), [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ]);
    expect(
      screen.getByRole('radio', { name: 'Hlavní fotografie: one.jpg' }),
    ).toBeChecked();
    await userEvent.click(
      screen.getByRole('radio', { name: 'Hlavní fotografie: two.png' }),
    );
    await userEvent.click(button('Uložit zvíře'));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get('x-csrf-token')).toBe('csrf-token');
    expect(payload).toMatchObject({
      name: 'Argo',
      species: 'dog',
      breedId: breed.id,
      sex: 'female',
      weightKg: 12.5,
      primaryUploadIndex: 1,
    });
    expect(uploads).toHaveLength(2);

    const result = screen.getByText('Zvíře Argo bylo přidáno.');
    await userEvent.click(button('Zavřít zprávu'));
    expect(result).not.toBeInTheDocument();
  });

  it('odmítne jiný formát než JPEG/PNG už při výběru', async () => {
    renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.upload(
      screen.getByLabelText(/Přidat fotografie/),
      [
        new File(['gif'], 'anim.gif', { type: 'image/gif' }),
        new File(['ok'], 'ok.png', { type: 'image/png' }),
      ],
      { applyAccept: false },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'anim.gif: fotografie musí být JPEG nebo PNG.',
    );
    expect(
      screen.queryByRole('radio', { name: 'Hlavní fotografie: anim.gif' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Hlavní fotografie: ok.png' }),
    ).toBeChecked();
    await userEvent.click(button('Zavřít zprávu'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('zrušení v kroku fotografií nic neuloží', async () => {
    const submit = vi.fn(() => HttpResponse.json(animal, { status: 201 }));
    server.use(http.post('/api/animal/animals', submit));
    const router = renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.click(button('Zrušit'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/zvirata'),
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([413, 415])(
    'zobrazí zavíratelnou chybu uploadu %s',
    async (status) => {
      server.use(
        http.post('/api/animal/animals', () =>
          HttpResponse.json({ error: 'Photo rejected' }, { status }),
        ),
      );
      renderApp('/zvirata/nove');
      await fillProfile();
      await userEvent.click(button('Pokračovat na fotografie'));
      await userEvent.click(button('Uložit zvíře'));
      expect(await screen.findByRole('alert')).toHaveTextContent(
        status === 413 ? 'příliš velké' : 'JPEG nebo PNG',
      );
      await userEvent.click(button('Zavřít zprávu'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('uložení odeslané pod předchozím účtem nezapíše cache ani nepřesměruje', async () => {
    const save = heldResponse(() => HttpResponse.json(animal, { status: 201 }));
    server.use(http.post('/api/animal/animals', save.handler));
    const client = createQueryClient();
    const router = renderApp('/zvirata/nove', client);
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.click(button('Uložit zvíře'));
    await switchAccount(client);
    save.release();
    await save.done;
    await settle();
    expect(client.getQueryData(['animals', animal.id])).toBeUndefined();
    expect(router.state.location.pathname).toBe('/zvirata/nove');
  });

  it('odmítne nečíselnou a příliš velkou hmotnost a hranici 2000 kg přijme', async () => {
    renderApp('/zvirata/nove');
    await fillProfile();
    const weight = field('Hmotnost (kg)');
    await userEvent.type(weight, 'dvanáct');
    await userEvent.click(button('Pokračovat na fotografie'));
    expect(weight).toHaveAccessibleDescription(
      'Zadejte hmotnost číslem, například 12,5.',
    );
    await userEvent.clear(weight);
    await userEvent.type(weight, '2000,5');
    await userEvent.click(button('Pokračovat na fotografie'));
    expect(weight).toHaveAccessibleDescription(
      'Hmotnost může být nejvýše 2000 kg.',
    );
    await userEvent.clear(weight);
    await userEvent.type(weight, '2000');
    await userEvent.click(button('Pokračovat na fotografie'));
    expect(
      await screen.findByRole('heading', { name: 'Fotografie' }),
    ).toBeVisible();
  });

  it('krok Fotografie nepustí bez povinných údajů a návrat zachová vyplněné', async () => {
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: breed.name });
    await userEvent.click(button('Fotografie'));
    expect(field('Jméno')).toHaveAccessibleDescription(
      'Vyplňte jméno zvířete.',
    );
    expect(
      screen.queryByRole('heading', { name: 'Fotografie' }),
    ).not.toBeInTheDocument();

    await fillProfile();
    await userEvent.click(button('Fotografie'));
    await screen.findByRole('heading', { name: 'Fotografie' });
    await userEvent.click(button('Zpět na údaje'));
    await screen.findByRole('heading', { name: 'Údaje zvířete' });
    expect(field('Jméno')).toHaveValue('Argo');
    expect(select('Plemeno')).toHaveValue(breed.id);
  });

  it('odmítne fotografii nad 10 MiB a fotografie nad limit 10 na zvíře', async () => {
    renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    const big = new File(['big'], 'velka.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    const photos = Array.from(
      { length: 11 },
      (_, index) =>
        new File([String(index)], `foto-${index}.png`, { type: 'image/png' }),
    );
    await userEvent.upload(screen.getByLabelText(/Přidat fotografie/), [
      big,
      ...photos,
    ]);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('velka.jpg: soubor je větší než 10 MiB.');
    expect(alert).toHaveTextContent(
      'foto-10.png: zvíře může mít nejvýše 10 fotografií.',
    );
    expect(
      screen.getAllByRole('radio', { name: /^Hlavní fotografie:/ }),
    ).toHaveLength(10);
    expect(screen.getByText(/přetáhněte \(10\/10\)/)).toBeVisible();
    expect(
      screen.queryByRole('radio', { name: 'Hlavní fotografie: velka.jpg' }),
    ).not.toBeInTheDocument();
  });

  it('přetažené soubory kontroluje stejně jako vybrané', async () => {
    renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    const dropZone = screen.getByText('Přidat fotografie').closest('label')!;
    fireEvent.dragOver(dropZone);
    fireEvent.drop(dropZone, {
      dataTransfer: {
        files: [
          new File(['gif'], 'anim.gif', { type: 'image/gif' }),
          new File(['ok'], 'pretazena.png', { type: 'image/png' }),
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'anim.gif: fotografie musí být JPEG nebo PNG.',
    );
    expect(
      screen.getByRole('radio', { name: 'Hlavní fotografie: pretazena.png' }),
    ).toBeChecked();
  });

  it('odebrání nahrané fotografie zachová zvolenou hlavní, po odebrání hlavní je hlavní první', async () => {
    let payload: unknown;
    let uploads: FormDataEntryValue[] = [];
    server.use(
      http.post('/api/animal/animals', async ({ request }) => {
        const data = await request.formData();
        payload = JSON.parse(String(data.get('animal')));
        uploads = data.getAll('photos');
        return HttpResponse.json(animal, { status: 201 });
      }),
    );
    renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.upload(
      screen.getByLabelText(/Přidat fotografie/),
      ['a.jpg', 'b.jpg', 'c.jpg'].map(
        (name) => new File([name], name, { type: 'image/jpeg' }),
      ),
    );
    const primary = (name: string) =>
      screen.getByRole('radio', { name: `Hlavní fotografie: ${name}` });
    await userEvent.click(primary('c.jpg'));
    await userEvent.click(button('Odebrat a.jpg'));
    expect(primary('c.jpg')).toBeChecked();
    await userEvent.click(button('Odebrat c.jpg'));
    expect(primary('b.jpg')).toBeChecked();
    expect(
      screen.getAllByRole('radio', { name: /^Hlavní fotografie:/ }),
    ).toHaveLength(1);

    await userEvent.click(button('Uložit zvíře'));
    await screen.findByText('Zvíře Argo bylo přidáno.');
    expect(uploads).toHaveLength(1);
    expect(payload).toMatchObject({ primaryUploadIndex: 0 });
  });

  it('plemeno, které sdílený katalog nezná, neodešle a vysvětlí to', async () => {
    const submit = vi.fn(() => HttpResponse.json(animal, { status: 201 }));
    server.use(
      http.get('/api/animal/breeds/:species', () =>
        HttpResponse.json({
          species: 'dog',
          breeds: [
            ...animalBreeds('dog'),
            { id: 'nove-plemeno', name: 'Nové' },
          ],
        }),
      ),
      http.post('/api/animal/animals', submit),
    );
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: 'Nové' });
    await userEvent.type(field('Jméno'), 'Argo');
    await userEvent.selectOptions(select('Plemeno'), 'nove-plemeno');
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.click(button('Uložit zvíře'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Údaje nejsou platné. Zkontrolujte formulář.',
    );
    expect(submit).not.toHaveBeenCalled();
    await userEvent.click(button('Zavřít zprávu'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('serverem odmítnutá pole vyjmenuje česky a bez duplicit', async () => {
    server.use(
      http.post('/api/animal/animals', () =>
        HttpResponse.json(
          {
            error: 'Validation failed',
            issues: [
              { path: ['name'], message: 'Too long' },
              { path: ['name'], message: 'Invalid' },
              { path: ['photos', 1], message: 'Too big' },
              { path: ['primaryUploadIndex'], message: 'Out of range' },
              // neznámé nebo poškozené položky se nevypisují
              { path: ['ownerUserId'], message: 'Unrecognized' },
              { path: [0], message: 'Index' },
              { path: 'name', message: 'Not an array' },
              { message: 'No path' },
              null,
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const router = renderApp('/zvirata/nove');
    await fillProfile();
    await userEvent.click(button('Pokračovat na fotografie'));
    await userEvent.click(button('Uložit zvíře'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Údaje nejsou platné. Zkontrolujte formulář.',
    );
    expect(within(alert).getByText(/^Zkontrolujte:/)).toHaveTextContent(
      /^Zkontrolujte: Jméno, Fotografie\.$/,
    );
    expect(router.state.location.pathname).toBe('/zvirata/nove');
  });

  it('nedostupná plemena ve formuláři nepustí dál, dokud se nenačtou', async () => {
    let calls = 0;
    server.use(
      http.get('/api/animal/breeds/:species', () =>
        ++calls <= 2
          ? new HttpResponse(null, { status: 503 })
          : HttpResponse.json({ species: 'dog', breeds: animalBreeds('dog') }),
      ),
    );
    renderApp('/zvirata/nove');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Služba je dočasně nedostupná');
    expect(button('Pokračovat na fotografie')).toBeDisabled();
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Zkusit znovu' }),
    );
    await screen.findByRole('option', { name: breed.name });
    expect(button('Pokračovat na fotografie')).toBeEnabled();
  });
});

describe('Úprava zvířete (WF 05, 06)', () => {
  it('maže prázdný údaj na null a odstraňuje fotografii přes JSON', async () => {
    let payload: unknown;
    server.use(
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        expect(request.headers.get('content-type')).toBe('application/json');
        payload = await request.json();
        return HttpResponse.json({ ...animal, city: null, photos: [] });
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Obec'));
    await userEvent.click(button('Fotografie'));
    await userEvent.click(button('Odebrat argo.jpg'));
    await userEvent.click(button('Uložit změny'));
    expect(
      await screen.findByText('Změny zvířete Argo byly uloženy.'),
    ).toBeVisible();
    expect(payload).toEqual({
      city: null,
      removePhotoIds: [animal.photos[0]!.id],
    });
  });

  it('posílá jen změněný údaj a nesahá na hlavní fotografii', async () => {
    let payload: unknown;
    server.use(
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ...animal, city: 'Brno' });
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Obec'));
    await userEvent.type(field('Obec'), 'Brno');
    await userEvent.click(button('Uložit změny'));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(payload).toEqual({ city: 'Brno' });
  });

  it('posílá při změně plemene současně druh i plemeno', async () => {
    const nextBreed = animalBreeds('dog')[1]!;
    let payload: unknown;
    server.use(
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ...animal, breedId: nextBreed.id });
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: nextBreed.name });
    await userEvent.selectOptions(select('Plemeno'), nextBreed.id);
    await userEvent.click(button('Uložit změny'));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(payload).toEqual({ species: 'dog', breedId: nextBreed.id });
  });

  it('bez změn se vrátí na detail bez PATCH požadavku', async () => {
    const patch = vi.fn(() => HttpResponse.json(animal));
    server.use(http.patch('/api/animal/animals/:id', patch));
    const router = renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.click(button('Uložit změny'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`),
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('zrušení zahodí změny a nic neuloží', async () => {
    const patch = vi.fn(() => HttpResponse.json(animal));
    server.use(http.patch('/api/animal/animals/:id', patch));
    const client = createQueryClient();
    const router = renderApp(`/zvirata/${animal.id}/upravit`, client);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Jméno'));
    await userEvent.type(field('Jméno'), 'Jiné jméno');
    await userEvent.click(button('Zrušit'));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`);
    expect(patch).not.toHaveBeenCalled();
  });

  it('nenačtené zvíře formulář nenabídne a opakování ho načte', async () => {
    let calls = 0;
    server.use(
      http.get('/api/animal/animals/:id', () =>
        ++calls === 1
          ? HttpResponse.json({ error: 'Animal not found' }, { status: 404 })
          : HttpResponse.json(animal),
      ),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Zvíře nebo fotografie nebyly nalezeny');
    expect(
      screen.queryByRole('button', { name: 'Uložit změny' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(alert).getByRole('button', { name: 'Zkusit znovu' }),
    );
    expect(await screen.findByRole('textbox', { name: 'Jméno' })).toHaveValue(
      'Argo',
    );
  });

  it('nepustí uložení s vymazaným jménem', async () => {
    const patch = vi.fn(() => HttpResponse.json(animal));
    server.use(http.patch('/api/animal/animals/:id', patch));
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Jméno'));
    await userEvent.click(button('Uložit změny'));
    expect(field('Jméno')).toHaveAccessibleDescription(
      'Vyplňte jméno zvířete.',
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it('hmotnost s desetinnou čárkou nepovažuje za změnu a uloží jen popis', async () => {
    let payload: unknown;
    server.use(
      http.get('/api/animal/animals/:id', () =>
        HttpResponse.json(withTwoPhotos),
      ),
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json({ ...withTwoPhotos, description: 'Klidný' });
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    expect(field('Hmotnost (kg)')).toHaveValue('12,5');
    await userEvent.type(field('Popis'), 'Klidný');
    await userEvent.click(button('Uložit změny'));
    await screen.findByText('Změny zvířete Argo byly uloženy.');
    expect(payload).toEqual({ description: 'Klidný' });
  });

  it('změní hlavní fotografii na jinou uloženou', async () => {
    let payload: unknown;
    server.use(
      http.get('/api/animal/animals/:id', () =>
        HttpResponse.json(withTwoPhotos),
      ),
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        payload = await request.json();
        return HttpResponse.json(withTwoPhotos);
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.click(button('Fotografie'));
    await userEvent.click(
      screen.getByRole('radio', { name: 'Hlavní fotografie: luna.jpg' }),
    );
    await userEvent.click(button('Uložit změny'));
    await screen.findByText('Změny zvířete Argo byly uloženy.');
    expect(payload).toEqual({ primaryPhotoId: withTwoPhotos.photos[1]!.id });
  });

  it('při souběžné změně (409) ponechá rozpracované údaje', async () => {
    server.use(
      http.patch('/api/animal/animals/:id', () =>
        HttpResponse.json({ error: 'Animal changed' }, { status: 409 }),
      ),
    );
    const router = renderApp(`/zvirata/${animal.id}/upravit`);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Obec'));
    await userEvent.type(field('Obec'), 'Brno');
    await userEvent.click(button('Uložit změny'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Zvíře mezitím změnil jiný požadavek.',
    );
    expect(router.state.location.pathname).toBe(
      `/zvirata/${animal.id}/upravit`,
    );
    expect(field('Obec')).toHaveValue('Brno');
    await userEvent.click(button('Zavřít zprávu'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uložení potvrzené až po přepnutí účtu nepřesměruje nový účet', async () => {
    let reads = 0;
    const reload = heldResponse(() => HttpResponse.json(animal));
    server.use(
      http.get('/api/animal/animals/:id', () =>
        ++reads === 1 ? HttpResponse.json(animal) : reload.handler(),
      ),
      http.patch('/api/animal/animals/:id', () =>
        HttpResponse.json({ ...animal, city: 'Brno' }),
      ),
    );
    const client = createQueryClient();
    const router = renderApp(`/zvirata/${animal.id}/upravit`, client);
    await screen.findByRole('option', { name: breed.name });
    await userEvent.clear(field('Obec'));
    await userEvent.type(field('Obec'), 'Brno');
    await userEvent.click(button('Uložit změny'));
    // PATCH prošel, aplikace právě obnovuje uložené zvíře
    await waitFor(() => expect(reads).toBe(2));
    await switchAccount(client);
    reload.release();
    await reload.done;
    await settle();
    expect(router.state.location.pathname).toBe(
      `/zvirata/${animal.id}/upravit`,
    );
    expect(client.getQueryData<Animal>(['animals', animal.id])?.city).not.toBe(
      'Brno',
    );
  });
});

describe('Odstranění zvířete (WF 07, 08)', () => {
  it('maže až po potvrzení a na seznamu potvrdí výsledek', async () => {
    let calls = 0;
    server.use(
      http.delete('/api/animal/animals/:id', ({ request }) => {
        expect(request.headers.get('x-csrf-token')).toBe('csrf-token');
        calls++;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const router = renderApp(`/zvirata/${animal.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Smazat zvíře' }),
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('všechny doklady');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Zrušit' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls).toBe(0);
    await userEvent.click(button('Smazat zvíře'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nenávratně smazat',
      }),
    );
    expect(await screen.findByText('Zvíře Argo bylo smazáno.')).toBeVisible();
    expect(router.state.location.pathname).toBe('/zvirata');
    expect(calls).toBe(1);
  });

  it('smazání odeslané pod předchozím účtem nepřesměruje nový účet', async () => {
    const remove = heldResponse(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete('/api/animal/animals/:id', remove.handler));
    const client = createQueryClient();
    const router = renderApp(`/zvirata/${animal.id}`, client);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Smazat zvíře' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nenávratně smazat',
      }),
    );
    await switchAccount(client);
    remove.release();
    await remove.done;
    await settle();
    expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`);
  });

  it('Escape zavře potvrzení bez smazání a vrátí focus na spouštěč', async () => {
    const remove = vi.fn(() => new HttpResponse(null, { status: 204 }));
    server.use(http.delete('/api/animal/animals/:id', remove));
    renderApp(`/zvirata/${animal.id}`);
    const trigger = await screen.findByRole('button', { name: 'Smazat zvíře' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement),
    );
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(remove).not.toHaveBeenCalled();
  });

  it('neúspěšné smazání vysvětlí v dialogu a zvíře ponechá', async () => {
    server.use(
      http.delete('/api/animal/animals/:id', () =>
        HttpResponse.json({ error: 'Internal error' }, { status: 500 }),
      ),
    );
    const router = renderApp(`/zvirata/${animal.id}`);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Smazat zvíře' }),
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nenávratně smazat',
      }),
    );
    expect(
      await within(screen.getByRole('dialog')).findByText(
        'Služba je dočasně nedostupná. Zkuste to prosím znovu.',
      ),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(`/zvirata/${animal.id}`);

    // po zavření a novém otevření se stará chyba neukazuje
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Zrušit',
      }),
    );
    await userEvent.click(button('Smazat zvíře'));
    expect(
      within(screen.getByRole('dialog')).queryByText(
        /Služba je dočasně nedostupná/,
      ),
    ).not.toBeInTheDocument();
  });
});

describe('Detail zvířete (WF 04)', () => {
  it('nenalezené zvíře nabídne cestu zpět i opakování', async () => {
    let calls = 0;
    server.use(
      http.get('/api/animal/animals/:id', () =>
        ++calls === 1
          ? HttpResponse.json({ error: 'Animal not found' }, { status: 404 })
          : HttpResponse.json(animal),
      ),
    );
    renderApp(`/zvirata/${animal.id}`);
    expect(
      await screen.findByText(
        'Zvíře nebo fotografie nebyly nalezeny, nebo k nim nemáte přístup.',
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole('main')).getByRole('link', {
        name: 'Moje zvířata',
      }),
    ).toHaveAttribute('href', '/zvirata');
    await userEvent.click(button('Zkusit znovu'));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
  });

  it('přepíná mezi fotografiemi a ukáže vyplněnou hmotnost', async () => {
    server.use(
      http.get('/api/animal/animals/:id', () =>
        HttpResponse.json(withTwoPhotos),
      ),
    );
    renderApp(`/zvirata/${animal.id}`);
    const main = await screen.findByRole('img', { name: 'Argo – argo.jpg' });
    expect(main).toHaveAttribute(
      'src',
      `/api/animal/animals/${animal.id}/photos/${withTwoPhotos.photos[0]!.id}/file?size=preview`,
    );
    expect(screen.getByText('Hlavní fotografie')).toBeVisible();
    expect(screen.getByText('12,5 kg')).toBeVisible();

    const luna = button('Zobrazit luna.jpg');
    await userEvent.click(luna);
    expect(luna).toHaveAttribute('aria-pressed', 'true');
    expect(button('Zobrazit argo.jpg (hlavní)')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(
      screen.getByRole('img', { name: 'Argo – luna.jpg' }),
    ).toHaveAttribute(
      'src',
      `/api/animal/animals/${animal.id}/photos/${withTwoPhotos.photos[1]!.id}/file?size=preview`,
    );
    expect(screen.queryByText('Hlavní fotografie')).not.toBeInTheDocument();
  });
});

describe('věk na kartě', () => {
  it.each([
    ['2026-11-06', '2026-11-20', 'méně než měsíc'],
    ['2026-05-07', '2026-11-06', '5 měsíců'],
    ['2025-11-07', '2026-11-06', '11 měsíců'],
    ['2025-11-06', '2026-11-06', '1 rok'],
    ['2023-11-06', '2026-11-06', '3 roky'],
    ['2021-11-06', '2026-11-06', '5 let'],
  ])('%s k %s je „%s“', (birthDate, today, label) => {
    expect(ageLabel(birthDate, today)).toBe(label);
  });
});
