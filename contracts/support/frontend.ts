import type { Session } from '@anico/shared-schemas';
import { fetchSession } from '@/features/auth/api';

/**
 * Spustí `queryFn` frontendového dotazu tak, jak ji volá React Query; API vrstva
 * z kontextu čte jen `signal`. (`symbol` = `skipToken` z `queryOptions`.)
 */
export async function run<R>(query: {
  queryFn?: ((context: never) => R | Promise<R>) | symbol;
}): Promise<R> {
  const { queryFn } = query;
  if (typeof queryFn !== 'function') throw new Error('Query without queryFn');
  return queryFn({ signal: new AbortController().signal } as never);
}

/** Aktuální relace přihlášeného prohlížeče (CSRF token pro mutace), přes frontend. */
export async function currentSession(): Promise<Session> {
  const session = await fetchSession();
  if (!session) throw new Error('Expected a signed-in browser');
  return session;
}
