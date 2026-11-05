import type { Role, Session } from '@anico/shared-schemas';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

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

export const server = setupServer(
  http.get('/api/auth/providers', () =>
    HttpResponse.json({ providers: ['google', 'microsoft', 'apple'] }),
  ),
  http.get('/api/auth/session', anonymous),
);
