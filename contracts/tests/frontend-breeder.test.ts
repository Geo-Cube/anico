/**
 * breeder-service → frontend (UC-01): skutečné funkce `features/verification/api.ts`
 * a `features/breeders/api.ts` proti skutečnému breeder-service za gateway, ve všech
 * stavech žádosti, ve kterých se tvar odpovědi mění.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MyAccount, VerificationStatus } from '@anico/shared-schemas';
import {
  accountConflict,
  downloadMyCertificate,
  myAccountQuery,
  rejectedFields,
  submitVerificationRequest,
} from '@/features/verification/api';
import {
  decideRequest,
  decisionConflict,
  downloadCertificate,
  requestDetailQuery,
  requestListQuery,
  summaryQuery,
} from '@/features/breeders/api';
import { isApiError } from '@/shared/lib/http';
import { currentSession, run } from '../support/frontend.js';
import {
  startStack,
  type SignedInBrowser,
  type Stack,
} from '../support/stack.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const certificate = () =>
  new File([PDF], 'osvědčení.pdf', { type: 'application/pdf' });
const fields = (name: string) => ({
  firstName: 'Jana',
  lastName: name,
  emailAddress: `${name}@example.test`,
  breedingStationName: `Stanice ${name}`,
  breedingStationNumber: '123456',
});

let stack: Stack;
let admin: SignedInBrowser;

/** Chovatel se přihlásí, otevře účet a podá žádost; vrací id žádosti. */
async function submitted(name: string) {
  const breeder = await stack.login(name);
  const empty = await run(myAccountQuery);
  expect(empty).toMatchObject({
    accountState: 'NOT_SUBMITTED',
    breederId: breeder.userId,
    isVerified: false,
    verificationRequest: null,
  });
  const account = await submitVerificationRequest(
    fields(name),
    certificate(),
    (await currentSession()).csrfToken,
  );
  expect(account.accountState).toBe('PENDING');
  return { breeder, id: account.verificationRequest!.id };
}
async function asAdmin() {
  stack.use(admin);
  return (await currentSession()).csrfToken;
}
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isApiError(error)) throw new Error('Expected an API error');
  return error;
}

beforeAll(async () => {
  stack = await startStack();
  vi.stubGlobal('fetch', stack.fetch);
  admin = await stack.login('posuzovatelka', { role: 'admin' });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await stack?.close();
});

describe('účet chovatele (MyAccountSchema)', () => {
  it('nepodaná, podaná, duplicitní a neplatná žádost včetně těla 409 a 400', async () => {
    const { id } = await submitted('podavajici');
    const account = await run(myAccountQuery);
    expect(account.verificationRequest).toMatchObject({
      id,
      status: 'PENDING',
      revision: 1,
      reviewedAt: null,
      rejectionReason: null,
      returnReason: null,
      breedingStationCertificate: {
        fileName: 'osvědčení.pdf',
        contentType: 'application/pdf',
      },
    });
    expect(
      Buffer.from(await (await downloadMyCertificate()).arrayBuffer()),
    ).toEqual(PDF);

    const csrf = (await currentSession()).csrfToken;
    const duplicate = await failure(
      submitVerificationRequest(fields('podavajici'), certificate(), csrf),
    );
    expect(accountConflict(duplicate)).toEqual({ current: account });

    await stack.login('neplatna');
    await run(myAccountQuery);
    const invalid = await failure(
      submitVerificationRequest(
        { ...fields('neplatna'), emailAddress: 'není e-mail' },
        certificate(),
        (await currentSession()).csrfToken,
      ),
    );
    expect(invalid.kind).toBe('rejected');
    expect(rejectedFields(invalid)).toEqual(['emailAddress']);
  });
});

describe('administrace žádostí (Admin*/List/Summary schémata)', () => {
  it('vrácení, oprava, zastaralé rozhodnutí, schválení a opakované rozhodnutí', async () => {
    const { breeder, id } = await submitted('vracena');
    let csrf = await asAdmin();
    const pending = await run(requestDetailQuery(id));
    expect(pending).toMatchObject({
      status: 'PENDING',
      reviewedBy: null,
      reviewHistory: [],
      breeder: { breederId: breeder.userId, isVerified: false },
    });
    expect(
      Buffer.from(await (await downloadCertificate(id)).arrayBuffer()),
    ).toEqual(PDF);

    const returned = await decideRequest(
      id,
      { decision: 'RETURNED', revision: 1, returnReason: 'Chybí razítko' },
      csrf,
    );
    expect(returned).toMatchObject({
      status: 'RETURNED',
      reviewedBy: admin.userId,
      returnReason: 'Chybí razítko',
      reviewHistory: [{ decision: 'RETURNED', revision: 1 }],
    });

    stack.use(breeder);
    const toFix: MyAccount = await run(myAccountQuery);
    expect(toFix.accountState).toBe('RETURNED');
    expect(toFix.verificationRequest?.returnReason).toBe('Chybí razítko');
    // oprava bez nového souboru ponechá uložený certifikát
    const corrected = await submitVerificationRequest(
      fields('vracena'),
      null,
      (await currentSession()).csrfToken,
    );
    expect(corrected.verificationRequest).toMatchObject({
      status: 'PENDING',
      revision: 2,
      returnReason: null,
    });

    csrf = await asAdmin();
    const stale = decisionConflict(
      await failure(
        decideRequest(id, { decision: 'APPROVED', revision: 1 }, csrf),
      ),
    );
    expect(stale).toMatchObject({
      reason: 'stale',
      current: { id, status: 'PENDING', revision: 2 },
    });

    const approved = await decideRequest(
      id,
      { decision: 'APPROVED', revision: 2 },
      csrf,
    );
    expect(approved).toMatchObject({
      status: 'APPROVED',
      reviewHistory: [
        { decision: 'RETURNED', revision: 1 },
        { decision: 'APPROVED', revision: 2 },
      ],
      breeder: { isVerified: true },
    });
    const again = decisionConflict(
      await failure(
        decideRequest(
          id,
          { decision: 'REJECTED', revision: 2, rejectionReason: 'Pozdě' },
          csrf,
        ),
      ),
    );
    expect(again).toEqual({ reason: 'already-decided', current: approved });

    stack.use(breeder);
    expect(await run(myAccountQuery)).toMatchObject({
      accountState: 'APPROVED',
      isVerified: true,
      verificationRequest: { status: 'APPROVED', revision: 2 },
    });
  });

  it('zamítnutí a seznamy i souhrn ve všech stavech', async () => {
    const { breeder, id } = await submitted('zamitnuta');
    await submitted('cekajici');
    const { id: returnedId } = await submitted('vracena-podruhe');
    const { id: approvedId } = await submitted('schvalena');
    const csrf = await asAdmin();
    const rejected = await decideRequest(
      id,
      {
        decision: 'REJECTED',
        revision: 1,
        rejectionReason: 'Neplatné osvědčení',
      },
      csrf,
    );
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      rejectionReason: 'Neplatné osvědčení',
    });
    await decideRequest(
      returnedId,
      { decision: 'RETURNED', revision: 1, returnReason: 'Doplňte číslo' },
      csrf,
    );
    await decideRequest(
      approvedId,
      { decision: 'APPROVED', revision: 1 },
      csrf,
    );

    const summary = await run(summaryQuery);
    const statuses: VerificationStatus[] = [
      'PENDING',
      'RETURNED',
      'APPROVED',
      'REJECTED',
    ];
    for (const status of statuses) {
      const { items } = await run(requestListQuery(status));
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.status === status)).toBe(true);
      expect(summary[status.toLowerCase() as keyof typeof summary]).toBe(
        items.length,
      );
    }

    stack.use(breeder);
    expect(await run(myAccountQuery)).toMatchObject({
      accountState: 'REJECTED',
      isVerified: false,
      verificationRequest: { rejectionReason: 'Neplatné osvědčení' },
    });
    // chovatel do administrace nesmí; frontend to rozliší jako `forbidden`
    expect((await failure(run(summaryQuery))).kind).toBe('forbidden');
  });
});
