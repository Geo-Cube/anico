import { expect, test } from './support/fixtures.ts';
import {
  createAnimal,
  createTestBreeder,
  decideVerificationRequest,
  submitVerificationRequest,
  unique,
  waitForAnimalAccess,
} from './support/flows.ts';

test.describe('UC-02 Zvířata', () => {
  test('správa zvířat se odemkne až po doručení ověření a chovatel založí zvíře', async ({
    signIn,
  }) => {
    const breeder = await createTestBreeder(await signIn('owner'), 'Zvířecí');
    const admin = await signIn('admin');
    const { page } = breeder;

    await page.getByRole('link', { name: 'Moje zvířata' }).click();
    await expect(
      page.getByRole('heading', { name: 'Nejdřív ověřte chovatelský účet' }),
    ).toBeVisible();
    // Před ověřením odmítá i animal-service (vlastní projekce, ne UI).
    expect((await page.request.get('/api/animal/animals')).status()).toBe(403);

    await submitVerificationRequest(breeder);
    await decideVerificationRequest(admin, breeder.fullName, {
      decision: 'approve',
    });
    // Projekci animal-service plní jen událost breeder.verified z JetStreamu.
    await waitForAnimalAccess(breeder);

    await page.goto('/zvirata');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Moje zvířata' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Zatím nemáte žádná zvířata' }),
    ).toBeVisible();

    const name = `Bella ${unique()}`;
    const animalId = await createAnimal(breeder, name);
    await expect(page.getByText('Pes / Samice')).toBeVisible();
    await expect(page.getByText('Mops').first()).toBeVisible();

    await page.getByRole('link', { name: 'Moje zvířata' }).first().click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
    await page.getByRole('link', { name: `Zobrazit detail: ${name}` }).click();
    await expect(page).toHaveURL(`/zvirata/${animalId}`);
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });
});
