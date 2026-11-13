import { expect, test } from './support/fixtures.ts';
import {
  createTestBreeder,
  decideVerificationRequest,
  submitVerificationRequest,
} from './support/flows.ts';

test.describe('UC-01 Ověření chovatele', () => {
  test('administrátor schválí žádost s certifikátem a chovatel je ověřený', async ({
    signIn,
  }) => {
    const breeder = await createTestBreeder(await signIn('owner'), 'Schválená');
    const admin = await signIn('admin');

    await submitVerificationRequest(breeder);
    await breeder.page.goto('/');
    await expect(
      breeder.page.getByText(
        'Žádost o ověření čeká na posouzení administrátorem.',
      ),
    ).toBeVisible();

    await decideVerificationRequest(admin, breeder.fullName, {
      decision: 'approve',
    });
    // Schválená žádost už není mezi čekajícími, je ve filtru Schválené.
    await expect(
      admin.getByRole('link', {
        name: `Posoudit žádost: ${breeder.fullName}`,
      }),
    ).toHaveCount(0);
    await admin.getByRole('link', { name: 'Schválené' }).click();
    await expect(
      admin
        .getByRole('row')
        .filter({ hasText: breeder.fullName })
        .getByText('Schváleno'),
    ).toBeVisible();

    await breeder.page.goto('/');
    await expect(
      breeder.page.getByRole('heading', { name: 'Účet ověřen' }),
    ).toBeVisible();
    await expect(
      breeder.page.getByText(
        'Váš chovatelský účet je ověřen. Můžete pokračovat ke svým zvířatům.',
      ),
    ).toBeVisible();
    await breeder.page.goto('/overeni-chovatele');
    await expect(
      breeder.page.getByRole('heading', { name: 'Účet je ověřen' }),
    ).toBeVisible();
  });

  test('vrácenou žádost chovatel doplní a administrátor ji pak schválí', async ({
    signIn,
  }) => {
    const breeder = await createTestBreeder(await signIn('owner'), 'Vrácená');
    const admin = await signIn('admin');
    const reason = `Doplňte čitelné číslo stanice ${breeder.fullName}`;

    await submitVerificationRequest(breeder);
    await decideVerificationRequest(admin, breeder.fullName, {
      decision: 'return',
      reason,
    });

    const { page } = breeder;
    await page.goto('/');
    await expect(
      page.getByText('Žádost byla vrácena k doplnění.'),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Doplnit žádost' }).click();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Doplnit žádost o ověření',
      }),
    ).toBeVisible();
    await expect(page.getByText(`Důvod: ${reason}`)).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Číslo chovatelské stanice' })
      .fill('CZ-12345');
    await page
      .getByRole('button', { name: 'Odeslat doplněnou žádost' })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Doplněná žádost byla odeslána' }),
    ).toBeVisible();

    await admin.goto('/administrace/chovatele/zadosti');
    await admin
      .getByRole('link', { name: `Posoudit žádost: ${breeder.fullName}` })
      .click();
    await expect(admin.getByText('Opravené podání (verze 2)')).toBeVisible();
    await expect(admin.getByText('CZ-12345')).toBeVisible();
    await decideVerificationRequest(admin, breeder.fullName, {
      decision: 'approve',
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Účet ověřen' }),
    ).toBeVisible();
  });

  test('zamítnutí je konečné a chovatel zůstane bez přístupu ke zvířatům', async ({
    signIn,
  }) => {
    const breeder = await createTestBreeder(await signIn('owner'), 'Zamítnutá');
    const admin = await signIn('admin');
    const reason = `Certifikát nepatří stanici ${breeder.fullName}`;

    await submitVerificationRequest(breeder);
    await decideVerificationRequest(admin, breeder.fullName, {
      decision: 'reject',
      reason,
    });

    const { page } = breeder;
    await page.goto('/overeni-chovatele');
    await expect(
      page.getByRole('heading', { name: 'Žádost byla zamítnuta' }),
    ).toBeVisible();
    await expect(page.getByText(`Důvod: ${reason}`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Odeslat/ })).toHaveCount(0);

    await page.goto('/zvirata');
    await expect(
      page.getByRole('heading', { name: 'Nejdřív ověřte chovatelský účet' }),
    ).toBeVisible();
    expect((await page.request.get('/api/animal/animals')).status()).toBe(403);
  });
});
