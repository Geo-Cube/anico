import { expect, test } from './support/fixtures.ts';

test.describe('Přihlášení', () => {
  test('nepřihlášený návštěvník chráněné stránky skončí na přihlášení s návratovou adresou', async ({
    page,
  }) => {
    await page.goto('/zvirata?druh=dog');

    await expect(page).toHaveURL(
      '/prihlaseni?returnTo=%2Fzvirata%3Fdruh%3Ddog',
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Přihlášení' }),
    ).toBeVisible();
    // API za gateway bez relace neodpoví daty, ale chybou forwardAuth.
    const response = await page.request.get('/api/animal/animals');
    expect(response.status()).toBe(401);
  });
});
