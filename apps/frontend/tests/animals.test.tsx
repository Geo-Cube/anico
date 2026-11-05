import { animalBreeds, type Animal } from '@anico/shared-schemas';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/app/query-client';
import { routes } from '@/app/routes';
import { server, sessionFor } from './server';

const breed = animalBreeds('dog')[0]!;
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
};
function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
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

describe('zvířata', () => {
  it('zobrazuje jméno, náhradní označení, hlavní fotografii a další stránku', async () => {
    server.use(
      http.get('/api/animal/animals', ({ request }) =>
        new URL(request.url).searchParams.has('before')
          ? HttpResponse.json({
              items: [
                {
                  ...animal,
                  id: '123456789012345678abcdef',
                  name: null,
                  photos: [],
                },
              ],
              nextCursor: null,
            })
          : HttpResponse.json({ items: [animal], nextCursor: animal.id }),
      ),
    );
    renderApp('/zvirata');
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Argo' })).toHaveAttribute(
      'src',
      `/api/animal/animals/${animal.id}/photos/${animal.photos[0]!.id}/file`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Načíst další' }));
    expect(
      await screen.findByRole('heading', {
        name: `Pes · ${breed.name} · abcdef`,
      }),
    ).toBeVisible();
  });

  it('vytváří jedním multipart požadavkem se zvoleným indexem a CSRF', async () => {
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
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: breed.name });
    await userEvent.selectOptions(
      await screen.findByLabelText('Plemeno'),
      breed.id,
    );
    await userEvent.type(screen.getByLabelText('Jméno'), 'Argo');
    await userEvent.upload(screen.getByLabelText('Přidat fotografie'), [
      new File(['one'], 'one.jpg', { type: 'image/jpeg' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ]);
    await userEvent.click(
      screen.getByRole('radio', { name: 'Hlavní: two.png' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Uložit zvíře' }));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get('x-csrf-token')).toBe('csrf-token');
    expect(requests[0]!.headers.get('content-type')).toContain(
      'multipart/form-data; boundary=',
    );
    expect(payload).toMatchObject({
      name: 'Argo',
      species: 'dog',
      breedId: breed.id,
      sex: 'male',
      primaryUploadIndex: 1,
    });
    expect(uploads).toHaveLength(2);
  });

  it('při úpravě maže prázdný údaj na null a odstraňuje fotografii přes JSON', async () => {
    let payload: unknown;
    server.use(
      http.patch('/api/animal/animals/:id', async ({ request }) => {
        expect(request.headers.get('content-type')).toBe('application/json');
        payload = await request.json();
        return HttpResponse.json({ ...animal, city: null, photos: [] });
      }),
    );
    renderApp(`/zvirata/${animal.id}/upravit`);
    await userEvent.clear(await screen.findByLabelText('Město'));
    await userEvent.click(
      screen.getByRole('button', { name: 'Odebrat argo.jpg' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Uložit zvíře' }));
    expect(await screen.findByRole('heading', { name: 'Argo' })).toBeVisible();
    expect(payload).toMatchObject({
      city: null,
      removePhotoIds: [animal.photos[0]!.id],
    });
    expect(payload).not.toHaveProperty('primaryPhotoId');
  });

  it('vysvětluje nutnost ověření chovatele bez odhlášení', async () => {
    server.use(
      http.get('/api/animal/animals', () =>
        HttpResponse.json(
          { error: 'Breeder is not verified' },
          { status: 403 },
        ),
      ),
    );
    const router = renderApp('/zvirata');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Nejdřív musí být ověřen tvůj chovatelský účet',
    );
    expect(
      screen.getByRole('link', { name: 'Přejít na účet' }),
    ).toHaveAttribute('href', '/ucet');
    expect(router.state.location.pathname).toBe('/zvirata');
  });

  it('maže až po potvrzení v dialogu včetně upozornění na doklady', async () => {
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
    expect(calls).toBe(0);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Zrušit' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Smazat zvíře' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Nenávratně smazat',
      }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/zvirata'),
    );
    expect(calls).toBe(1);
  });

  it.each([413, 415])('zobrazuje chybu uploadu %s', async (status) => {
    server.use(
      http.post('/api/animal/animals', () =>
        HttpResponse.json({ error: 'Photo rejected' }, { status }),
      ),
    );
    renderApp('/zvirata/nove');
    await screen.findByRole('option', { name: breed.name });
    await userEvent.selectOptions(
      await screen.findByLabelText('Plemeno'),
      breed.id,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Uložit zvíře' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 413 ? 'příliš velké' : 'JPEG nebo PNG',
    );
  });
});
