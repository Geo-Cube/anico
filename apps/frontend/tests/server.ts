import type { MyAccount, Role, Session } from '@anico/shared-schemas';
import type { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { expect } from 'vitest';

export function sessionFor(
  roles: Role[] = ['breeder'],
  overrides: Partial<Session> = {},
): Session {
  return {
    identity: {
      userId: '0b9a3c55-1f0e-4a43-9a51-2f4a8d8d1e01',
      givenName: 'Jana',
      familyName: 'Nováková',
      email: 'jana@example.test',
      roles,
    },
    csrfToken: 'csrf-token',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    linkedProviders: ['google'],
    canManageAccounts: true,
    ...overrides,
  };
}

export const anonymous = () =>
  HttpResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });

export const unsubmittedAccount: MyAccount = {
  accountState: 'NOT_SUBMITTED',
  breederId: '123456789012345678901234',
  firstName: null,
  lastName: null,
  emailAddress: null,
  breedingStationName: null,
  breedingStationNumber: null,
  isVerified: false,
  verificationRequest: null,
};

export const server = setupServer(
  http.get('/api/auth/providers', () =>
    HttpResponse.json({ providers: ['google', 'microsoft', 'apple'] }),
  ),
  http.get('/api/auth/session', anonymous),
  http.get('/api/breeder/breeders/me', () =>
    HttpResponse.json(unsubmittedAccount),
  ),
);

export const approvedAccount: MyAccount = {
  ...unsubmittedAccount,
  accountState: 'APPROVED',
  isVerified: true,
};

/** Přihlášený a ověřený chovatel (výchozí stav testů zvířat a dokladů). */
export function useApprovedBreeder(roles?: Role[]) {
  server.use(
    http.get('/api/auth/session', () => HttpResponse.json(sessionFor(roles))),
    http.get('/api/breeder/breeders/me', () =>
      HttpResponse.json(approvedAccount),
    ),
  );
}

/** Relace jiného účtu se stejnými rolemi. */
export function otherSessionFor(roles?: Role[]): Session {
  const base = sessionFor(roles);
  return {
    ...base,
    identity: {
      ...base.identity,
      userId: '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b',
      email: 'petr@example.test',
    },
  };
}

/** Mezitím se ve stejném prohlížeči přihlásí jiný účet (např. v jiné záložce). */
export async function switchAccount(client: QueryClient, roles?: Role[]) {
  const other = otherSessionFor(roles);
  server.use(http.get('/api/auth/session', () => HttpResponse.json(other)));
  await client.invalidateQueries({ queryKey: ['session'] });
  await waitFor(() => expect(client.getQueryData(['session'])).toEqual(other));
}
