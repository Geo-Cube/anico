/**
 * auth-service → frontend: skutečné funkce `apps/frontend/src/features/{auth,test-accounts}/api.ts`
 * (tytéž cesty a Zod schémata jako v prohlížeči) proti skutečnému auth-service za gateway.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  fetchProviders,
  fetchSession,
  logout,
  startConnection,
} from '@/features/auth/api';
import {
  createTestAccount,
  returnToOwnAccount,
  switchToTestAccount,
  testAccountsQuery,
} from '@/features/test-accounts/api';
import { isApiError } from '@/shared/lib/http';
import { currentSession, run } from '../support/frontend.js';
import { Browser, startStack, type Stack } from '../support/stack.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
  vi.stubGlobal('fetch', stack.fetch);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await stack?.close();
});

describe('auth-service odpovědi projdou schématy frontendu', () => {
  it('seznam providerů (ProvidersResponseSchema)', async () => {
    stack.use(new Browser());
    expect(await fetchProviders()).toEqual(['google', 'microsoft']);
  });

  it('anonymní relace je 401, kterou frontend chápe jako odhlášení', async () => {
    stack.use(new Browser());
    expect(await fetchSession()).toBeNull();
  });

  it('relace chovatele, propojení dalšího providera a odhlášení (SessionSchema, ConnectionStartResponseSchema)', async () => {
    const breeder = await stack.login('chovatelka');
    const session = await currentSession();
    expect(session.identity).toMatchObject({
      userId: breeder.userId,
      roles: ['breeder'],
      email: 'chovatelka@example.test',
    });
    expect(session.linkedProviders).toEqual(['google']);
    expect(session.canManageAccounts).toBe(true);
    expect(session.canUseTestAccounts).toBe(false);
    expect(session.testAccountActor).toBeUndefined();

    const providerUrl = await startConnection(session, 'microsoft');
    expect(new URL(providerUrl).hostname).toBe('login.microsoftonline.com');
    const linked = await stack.completeProviderLogin(
      'microsoft',
      providerUrl,
      'chovatelka-ms',
    );
    expect(linked.status).toBe(303);
    expect((await currentSession()).linkedProviders.toSorted()).toEqual([
      'google',
      'microsoft',
    ]);

    await logout(await currentSession());
    expect(await fetchSession()).toBeNull();
  });

  it('testovací účty: seznam, založení, přepnutí a návrat (TestAccountsResponseSchema, TestAccountSchema, testAccountActor)', async () => {
    const admin = await stack.login('administratorka', { role: 'admin' });
    const own = await currentSession();
    expect(own.identity.roles.toSorted()).toEqual(['admin', 'breeder']);
    expect(own.canUseTestAccounts).toBe(true);
    expect(await run(testAccountsQuery)).toEqual([]);

    const created = await createTestAccount(
      { givenName: 'Testovací', familyName: 'Chovatel' },
      own.csrfToken,
    );
    expect(created.createdBy).toBe(admin.userId);
    expect(created.identity.roles).toEqual(['breeder']);
    expect(await run(testAccountsQuery)).toEqual([created]);

    await switchToTestAccount(created.identity.userId, own.csrfToken);
    const switched = await currentSession();
    expect(switched.identity.userId).toBe(created.identity.userId);
    expect(switched.canManageAccounts).toBe(false);
    expect(switched.testAccountActor).toEqual({
      userId: admin.userId,
      givenName: 'Jana',
      familyName: 'administratorka',
    });
    // propojení vyžaduje čerstvé skutečné přihlášení: 401 s kódem, který frontend nevykládá jako odhlášení
    const relogin = await startConnection(switched, 'microsoft').catch(
      (caught: unknown) => caught,
    );
    expect(isApiError(relogin, 'rejected')).toBe(true);
    expect(isApiError(relogin) && relogin.code).toBe('RECENT_LOGIN_REQUIRED');

    await returnToOwnAccount(switched.csrfToken);
    const back = await currentSession();
    expect(back.identity.userId).toBe(admin.userId);
    expect(back.testAccountActor).toBeUndefined();
  });

  it('chybový kód OWNER_REQUIRED, který frontend rozlišuje', async () => {
    await stack.login('druha-administratorka', { role: 'admin' });
    const session = await currentSession();
    const error = await createTestAccount(
      { givenName: 'Testovací', familyName: 'Admin', admin: true },
      session.csrfToken,
    ).catch((caught: unknown) => caught);
    expect(isApiError(error, 'forbidden')).toBe(true);
    expect(isApiError(error) && error.code).toBe('OWNER_REQUIRED');
  });
});
