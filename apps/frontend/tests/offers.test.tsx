import type { OfferDetail } from '@anico/shared-schemas';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { animalId, dogBreed } from './fixtures';
import { renderApp, withoutRetry } from './render-app';
import { server, useApprovedBreeder } from './server';

const offerId = '6740a1b2c3d4e5f601234567';
const photoIds = ['6740a1b2c3d4e5f601234501', '6740a1b2c3d4e5f601234502'];

const offer = (overrides: Partial<OfferDetail> = {}): OfferDetail => ({
  id: offerId,
  animalId,
  regionId: 'jihomoravsky',
  validFrom: '2026-11-18T15:30:00.000Z',
  validTo: null,
  message: 'Nabízím krytí.\nPodrobnosti domluvíme.',
  status: 'ACTIVE',
  animal: {
    name: 'Rex z Modrého údolí',
    species: 'dog',
    breedId: dogBreed.id,
    sex: 'male',
    birthDate: '2022-05-14',
    coatColor: null,
    weightKg: 31,
    city: 'Brno',
    pedigreeNumber: 'CZ 123456',
    microchipNumber: '203098100123456',
    description: null,
    photos: [
      { id: photoIds[0]!, isPrimary: true },
      { id: photoIds[1]!, isPrimary: false },
    ],
  },
  verification: {
    verified: true,
    documentTypes: ['PEDIGREE', 'BREEDING_APPROVAL'],
  },
  canSendInquiry: true,
  inquiryUnavailableReason: null,
  ...overrides,
});

const respond = (body: object, status = 200) =>
  server.use(
    http.get(`/api/animal/offers/${offerId}`, () =>
      HttpResponse.json(body, { status }),
    ),
  );

const open = () => renderApp(`/nabidky/${offerId}`, withoutRetry());

beforeEach(() => useApprovedBreeder());

describe('Detail nabídky (US-06)', () => {
  it('zobrazí nabídku podle kontraktu', async () => {
    respond(offer());
    open();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Rex z Modrého údolí',
      }),
    ).toBeVisible();
    expect(screen.getByText(/Jihomoravský kraj/)).toBeVisible();
    expect(screen.getByText(/Bez omezení/)).toBeVisible();
    expect(screen.getByText(dogBreed.name)).toBeVisible();
    expect(screen.getByText('31 kg')).toBeVisible();
    expect(screen.getByText('CZ 123456')).toBeVisible();
    expect(screen.getByText('203098100123456')).toBeVisible();
    expect(screen.getByText('Ověřeno')).toBeVisible();
    expect(screen.getByText('Průkaz původu')).toBeVisible();
    expect(screen.getByText('Doklad o chovnosti')).toBeVisible();
    expect(screen.getByText(/Nabízím krytí\./)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fotografie načítá jen přes nabídku ve zmenšeninách, bez originálu', async () => {
    respond(offer());
    open();

    const main = await screen.findByRole('img', {
      name: 'Fotografie 1 ze 2 – Rex z Modrého údolí',
    });
    expect(main).toHaveAttribute(
      'src',
      `/api/animal/offers/${offerId}/photos/${photoIds[0]}/file?size=preview`,
    );
    const thumbnails = screen
      .getByRole('list', { name: 'Miniatury fotografií' })
      .querySelectorAll('img');
    expect([...thumbnails].map((img) => img.getAttribute('src'))).toEqual(
      photoIds.map(
        (id) =>
          `/api/animal/offers/${offerId}/photos/${id}/file?size=thumbnail`,
      ),
    );
    expect(
      screen.queryByRole('link', { name: 'Otevřít v plné velikosti' }),
    ).not.toBeInTheDocument();
  });

  it('bez schválených dokladů ukáže, že zvíře není ověřené', async () => {
    respond(offer({ verification: { verified: false, documentTypes: [] } }));
    open();

    expect(await screen.findAllByText('Bez ověřených dokladů')).toHaveLength(2);
    expect(screen.queryByText('Ověřeno')).not.toBeInTheDocument();
  });

  it.each([
    [
      'vlastní stažená nabídka',
      { status: 'WITHDRAWN', inquiryUnavailableReason: 'OWN_OFFER' },
      'Toto je vaše nabídka. Stav: Stažená.',
    ],
    [
      'odeslaná poptávka',
      { inquiryUnavailableReason: 'INQUIRY_PENDING' },
      'Poptávku k této nabídce jste již odeslali. Čeká na vyřízení.',
    ],
    [
      'neaktivní nabídka',
      { status: 'EXPIRED', inquiryUnavailableReason: 'NOT_ACTIVE' },
      'Nabídka již není aktivní. Odeslání poptávky není možné.',
    ],
  ] as const)(
    '%s vysvětlí, proč nelze poptávat',
    async (_, overrides, text) => {
      respond(offer({ ...overrides, canSendInquiry: false }));
      open();

      expect(await screen.findByText(text)).toBeVisible();
    },
  );

  it('nedostupná nabídka (404) nerozliší neexistující a neaktivní', async () => {
    respond({ error: 'Offer not found' }, 404);
    open();

    expect(
      await screen.findByRole('heading', { name: 'Nabídka není dostupná' }),
    ).toBeVisible();
    expect(
      screen.getByText('Nabídka není dostupná nebo již není aktivní.'),
    ).toBeVisible();
  });

  it('výpadek služby nabídne opakování', async () => {
    respond({ error: 'Breeder verification unavailable' }, 503);
    open();

    expect(
      await screen.findByRole('button', { name: 'Zkusit znovu' }),
    ).toBeVisible();
  });

  it('odpověď s polem mimo kontrakt nevykreslí (např. název souboru fotky)', async () => {
    const body = offer();
    respond({
      ...body,
      animal: {
        ...body.animal,
        photos: [{ id: photoIds[0], isPrimary: true, fileName: 'rex-gps.jpg' }],
      },
    });
    open();

    expect(
      await screen.findByRole('button', { name: 'Zkusit znovu' }),
    ).toBeVisible();
    expect(screen.queryByText(/rex-gps/)).not.toBeInTheDocument();
    expect(screen.queryByText('Rex z Modrého údolí')).not.toBeInTheDocument();
  });
});
