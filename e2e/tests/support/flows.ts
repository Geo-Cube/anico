import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';
import { pdfFile } from './files.ts';

/** Krátký náhodný suffix – data testů se nepřekrývají ani při paralelním běhu. */
export const unique = () => randomUUID().slice(0, 8);

export interface Breeder {
  page: Page;
  fullName: string;
}

/**
 * Administrátor/vlastník založí na `/testovaci-ucty` testovací účet chovatele
 * a přepne se do něj. Stránka `actor` pak patří chovateli.
 */
export async function createTestBreeder(
  actor: Page,
  familyName: string,
): Promise<Breeder> {
  const fullName = `Jana ${familyName} ${unique()}`;
  const [givenName, ...rest] = fullName.split(' ');
  await actor.goto('/testovaci-ucty');
  // Viditelný popisek obsahuje aria-hidden „*“; přístupné jméno je čisté.
  await actor
    .getByRole('textbox', { name: 'Jméno', exact: true })
    .fill(givenName!);
  await actor
    .getByRole('textbox', { name: 'Příjmení', exact: true })
    .fill(rest.join(' '));
  await actor.getByRole('button', { name: 'Založit účet' }).click();
  await expect(
    actor.getByText(`Testovací účet ${fullName} je založený.`),
  ).toBeVisible();
  await actor.getByRole('button', { name: `Přepnout na ${fullName}` }).click();
  await expect(
    actor.getByRole('heading', { name: `Vítejte, ${fullName}` }),
  ).toBeVisible();
  await expect(
    actor.getByRole('region', { name: 'Testovací účet' }),
  ).toContainText(fullName);
  return { page: actor, fullName };
}

/** Chovatel podá žádost o ověření s certifikátem (PDF) z přehledu. */
export async function submitVerificationRequest(breeder: Breeder) {
  const { page } = breeder;
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Účet neověřen' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Podat žádost o ověření' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Žádost o ověření' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Název chovatelské stanice' })
    .fill(`Stanice ${breeder.fullName}`);
  await page
    .getByRole('textbox', { name: 'Číslo chovatelské stanice' })
    .fill(`CZ-${unique()}`);
  await page
    .getByLabel('Osvědčení chovatelské stanice')
    .setInputFiles(pdfFile('osvedceni.pdf', 'Osvedceni chovatelske stanice'));
  await page.getByRole('button', { name: 'Odeslat žádost' }).click();
  await expect(
    page.getByRole('heading', { name: 'Žádost byla odeslána' }),
  ).toBeVisible();
}

export type RequestDecision =
  | { decision: 'approve' }
  | { decision: 'return'; reason: string }
  | { decision: 'reject'; reason: string };

/** Administrátor rozhodne čekající žádost konkrétního chovatele. */
export async function decideVerificationRequest(
  admin: Page,
  breederName: string,
  outcome: RequestDecision,
) {
  await admin.goto('/administrace/chovatele/zadosti');
  await expect(
    admin.getByRole('heading', { level: 1, name: 'Žádosti chovatelů' }),
  ).toBeVisible();
  await admin
    .getByRole('link', { name: `Posoudit žádost: ${breederName}` })
    .click();
  await expect(
    admin.getByRole('heading', { name: 'Posoudit žádost chovatele' }),
  ).toBeVisible();
  const dialogs = {
    approve: ['Schválit ověření', 'Potvrdit schválení'],
    return: ['Vrátit k doplnění', 'Potvrdit vrácení'],
    reject: ['Zamítnout', 'Potvrdit zamítnutí'],
  } as const;
  const [open, confirm] = dialogs[outcome.decision];
  await admin.getByRole('button', { name: open, exact: true }).click();
  const dialog = admin.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (outcome.decision !== 'approve')
    await dialog.getByRole('textbox').fill(outcome.reason);
  await dialog.getByRole('button', { name: confirm }).click();
  const saved = {
    approve: 'Ověření účtu bylo schváleno.',
    return: 'Žádost byla vrácena chovateli k doplnění.',
    reject: 'Ověření účtu bylo zamítnuto.',
  } as const;
  await expect(admin.getByText(saved[outcome.decision])).toBeVisible();
}

/**
 * Čeká, než animal-service přijme `breeder.verified` z NATS do své projekce.
 * Polluje se API přes gateway (forwardAuth, bez reloadu stránky).
 */
export async function waitForAnimalAccess(breeder: Breeder) {
  await expect
    .poll(
      async () =>
        (await breeder.page.request.get('/api/animal/animals')).status(),
      { message: 'animal-service má přijmout breeder.verified přes NATS' },
    )
    .toBe(200);
}

/** Ověřený chovatel založí zvíře; vrací jeho ID z URL detailu. */
export async function createAnimal(breeder: Breeder, name: string) {
  const { page } = breeder;
  await page.goto('/zvirata');
  // Odkaz je v záhlaví stránky a u prázdného seznamu ještě jednou.
  await page.getByRole('link', { name: 'Přidat zvíře' }).first().click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Přidat zvíře' }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: 'Jméno', exact: true }).fill(name);
  await page
    .getByRole('combobox', { name: 'Plemeno' })
    .selectOption({ label: 'Mops' });
  // Radio je vizuálně skryté (sr-only); uživatel kliká na jeho popisek.
  await page.getByText('Samice', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Samice' })).toBeChecked();
  await page.getByRole('button', { name: 'Pokračovat na fotografie' }).click();
  await page.getByRole('button', { name: 'Uložit zvíře' }).click();
  await expect(page.getByText(`Zvíře ${name} bylo přidáno.`)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  const id = /\/zvirata\/([^/]+)$/.exec(new URL(page.url()).pathname)?.[1];
  expect(id).toBeTruthy();
  return id!;
}

/** Celé UC-01 až po odemčení zvířat – příprava pro UC-02/UC-03 a autorizaci. */
export async function verifiedBreeder(
  actor: Page,
  admin: Page,
  familyName: string,
) {
  const breeder = await createTestBreeder(actor, familyName);
  await submitVerificationRequest(breeder);
  await decideVerificationRequest(admin, breeder.fullName, {
    decision: 'approve',
  });
  await waitForAnimalAccess(breeder);
  return breeder;
}
