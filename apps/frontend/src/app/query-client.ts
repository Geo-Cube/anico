import type { Session } from '@anico/shared-schemas';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { forgetUser } from '@/features/auth/session';
import { isApiError } from '@/shared/lib/http';

export function createQueryClient() {
  // A 401 from any API means the server ended the session: drop the user's
  // data at once; the session guard then sends the browser to the login page.
  const onError = (error: unknown) => {
    if (isApiError(error, 'unauthorized')) forgetUser(client);
  };
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // Retry only outages; 4xx answers are final.
        retry: (failures, error) =>
          isApiError(error, 'unavailable') && failures < 1,
      },
      mutations: { retry: false },
    },
  });
  // The session ending (null) or another account in the same browser (e.g. a
  // login in another tab) must never leave data cached for the previous user.
  let userId: string | null | undefined;
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[0] !== 'session')
      return;
    const data = event.query.state.data as Session | null | undefined;
    if (data === undefined) return;
    const next = data?.identity.userId ?? null;
    if (userId !== undefined && next !== userId)
      client.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    userId = next;
  });
  return client;
}
