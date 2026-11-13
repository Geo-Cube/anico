import { expect, test } from './support/fixtures.ts';
import { pdfFile } from './support/files.ts';
import { createAnimal, unique, verifiedBreeder } from './support/flows.ts';

test.describe('UC-03 Doklady zvířat', () => {
  test('administrátor posoudí doklady a chovatel vidí schválení i důvod zamítnutí', async ({
    signIn,
  }) => {
    const admin = await signIn('admin');
    const breeder = await verifiedBreeder(
      await signIn('owner'),
      admin,
      'Dokladová',
    );
    const { page } = breeder;
    const name = `Rex ${unique()}`;
    await createAnimal(breeder, name);

    await page.getByRole('link', { name: 'Nahrát doklady' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Nahrát doklady' }),
    ).toBeVisible();
    await page
      .getByLabel('Soubory dokladů')
      .setInputFiles([
        pdfFile('pruka-puvodu.pdf', 'Prukaz puvodu'),
        pdfFile('vysetreni.pdf', 'Vysetreni kycli'),
      ]);
    await page
      .getByRole('combobox', { name: 'Typ dokladu pro pruka-puvodu.pdf' })
      .selectOption({ label: 'Průkaz původu' });
    await page
      .getByRole('combobox', { name: 'Typ dokladu pro vysetreni.pdf' })
      .selectOption({ label: 'Výsledky zdravotních vyšetření' });
    await page.getByRole('button', { name: 'Odeslat k posouzení' }).click();
    await expect(
      page.getByText('2 doklady byly odeslány k posouzení.'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('listitem', { name: 'Průkaz původu: pruka-puvodu.pdf' })
        .getByText('Čeká na posouzení'),
    ).toBeVisible();

    const reason = `Výsledek vyšetření nepatří zvířeti ${name}`;
    await admin.goto('/administrace/chovatele/doklady');
    await admin
      .getByRole('link', { name: `Posoudit doklad: ${name}, Průkaz původu` })
      .click();
    await expect(
      admin.getByRole('heading', { level: 1, name: 'Posoudit doklad' }),
    ).toBeVisible();
    await admin.getByRole('button', { name: 'Schválit doklad' }).click();
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'Potvrdit schválení' })
      .click();
    await expect(
      admin.getByText(`Doklad Průkaz původu zvířete ${name} byl schválen.`),
    ).toBeVisible();

    await admin
      .getByRole('link', {
        name: `Posoudit doklad: ${name}, Výsledky zdravotních vyšetření`,
      })
      .click();
    await admin.getByRole('button', { name: 'Zamítnout', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Důvod zamítnutí' }).fill(reason);
    await dialog.getByRole('button', { name: 'Potvrdit zamítnutí' }).click();
    await expect(
      admin.getByText(
        `Doklad Výsledky zdravotních vyšetření zvířete ${name} byl zamítnut.`,
      ),
    ).toBeVisible();

    await page.reload();
    await expect(
      page
        .getByRole('listitem', { name: 'Průkaz původu: pruka-puvodu.pdf' })
        .getByText('Schváleno'),
    ).toBeVisible();
    const rejected = page.getByRole('listitem', {
      name: 'Výsledky zdravotních vyšetření: vysetreni.pdf',
    });
    await expect(rejected.getByText('Zamítnuto')).toBeVisible();
    await expect(
      rejected.getByText(`Důvod zamítnutí: ${reason}`),
    ).toBeVisible();
    await expect(
      rejected.getByRole('link', {
        name: 'Doplnit doklad Výsledky zdravotních vyšetření (vysetreni.pdf)',
      }),
    ).toBeVisible();
  });
});
