import {
  expect,
  forgeIdentityToken,
  stackEnv,
  test,
} from './support/fixtures.ts';
import type { Identity } from './support/fixtures.ts';
import {
  createAnimal,
  createTestBreeder,
  unique,
  verifiedBreeder,
} from './support/flows.ts';

test.describe('Autorizace', () => {
  test('chovatel nemá přístup do administrace', async ({ signIn }) => {
    const { page } = await createTestBreeder(
      await signIn('owner'),
      'Bezprávná',
    );

    await expect(
      page
        .getByRole('navigation', { name: 'Hlavní navigace' })
        .getByRole('link', { name: 'Administrace' }),
    ).toHaveCount(0);
    for (const path of [
      '/administrace/chovatele/zadosti',
      '/administrace/chovatele/doklady',
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: 'Nedostatečné oprávnění' }),
      ).toBeVisible();
    }
    // Ochrana není jen v UI: backendy odmítnou roli chovatele samy.
    expect(
      (await page.request.get('/api/breeder/verification-requests')).status(),
    ).toBe(403);
    expect(
      (await page.request.get('/api/animal/document-reviews')).status(),
    ).toBe(403);
  });

  test('chovatel nedosáhne na zvíře jiného chovatele ani podvrženou identitou', async ({
    signIn,
    playwright,
  }) => {
    const admin = await signIn('admin');
    const owner = await verifiedBreeder(
      await signIn('owner'),
      admin,
      'Majitelka',
    );
    const intruder = await verifiedBreeder(
      await signIn('owner'),
      admin,
      'Vetřelkyně',
    );
    const name = `Daisy ${unique()}`;
    const animalId = await createAnimal(owner, name);
    const path = `/api/animal/animals/${animalId}`;

    await intruder.page.goto(`/zvirata/${animalId}`);
    await expect(
      intruder.page.getByText(
        'Zvíře nebo fotografie nebyly nalezeny, nebo k nim nemáte přístup.',
      ),
    ).toBeVisible();
    await expect(intruder.page.getByRole('heading', { name })).toHaveCount(0);

    expect((await owner.page.request.get(path)).status()).toBe(200);
    expect((await intruder.page.request.get(path)).status()).toBe(404);

    // Platně podepsaná identita majitelky v klientské hlavičce. Přímo
    // animal-service by ji přijala; gateway ji ale vždy nahradí identitou
    // z relace (forwardAuth authResponseHeaders).
    const session = await owner.page.request.get('/api/auth/session');
    const identity = (await session.json()).identity as Identity;
    const forged = { 'x-anico-identity': await forgeIdentityToken(identity) };
    const direct = await fetch(
      `${stackEnv('E2E_ANIMAL_SERVICE_URL')}/animals/${animalId}`,
      {
        headers: forged,
      },
    );
    expect(direct.status).toBe(200);

    expect(
      (await intruder.page.request.get(path, { headers: forged })).status(),
    ).toBe(404);
    const anonymous = await playwright.request.newContext({
      baseURL: stackEnv('E2E_BASE_URL'),
    });
    try {
      expect((await anonymous.get(path, { headers: forged })).status()).toBe(
        401,
      );
    } finally {
      await anonymous.dispose();
    }
  });
});
