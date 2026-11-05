import type { Session } from '@anico/shared-schemas';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { fetchProviders, fetchSession, logout } from './api';

export const sessionQueryKey = ['session'] as const;

export const sessionQuery = queryOptions({
  queryKey: sessionQueryKey,
  queryFn: ({ signal }) => fetchSession(signal),
  staleTime: 30_000,
});

export const providersQuery = queryOptions({
  queryKey: ['auth', 'providers'],
  queryFn: ({ signal }) => fetchProviders(signal),
  staleTime: Infinity,
});

export function useSession() {
  return useQuery(sessionQuery);
}

const generations = new WeakMap<QueryClient, number>();

/**
 * Increases whenever cached user data is discarded (logout, 401, another
 * account). A request started under an older generation must not write its
 * result into the cache or navigate.
 */
export function sessionGeneration(client: QueryClient) {
  return generations.get(client) ?? 0;
}

/** Drops all non-session queries and starts a new session generation. */
export function discardUserData(client: QueryClient) {
  generations.set(client, sessionGeneration(client) + 1);
  client.getMutationCache().clear();
  client.removeQueries({
    predicate: (query) => query.queryKey[0] !== sessionQueryKey[0],
  });
}

/**
 * Removes everything cached for the current user and marks the session as
 * anonymous. Mutations are dropped too so no callback writes old data back.
 */
export function forgetUser(client: QueryClient) {
  discardUserData(client);
  client.setQueryData(sessionQueryKey, null);
}

/**
 * The client timer only asks the server again at `expiresAt`; the server
 * decides. Without this, an expired session would surface on the next call.
 */
export function useSessionExpiryCheck(session: Session) {
  const client = useQueryClient();
  useEffect(() => {
    const remaining = Date.parse(session.expiresAt) - Date.now();
    const timer = setTimeout(
      () => void client.invalidateQueries({ queryKey: sessionQueryKey }),
      Math.max(0, Math.min(remaining + 1000, 2_147_483_647)),
    );
    return () => clearTimeout(timer);
  }, [client, session.expiresAt]);
}

export type LoginPageState = { loggedOut?: boolean; sessionEnded?: boolean };

const logoutMarker = ['auth', 'logged-out'] as const;

/**
 * True after an explicit logout in this page load. The session guard reads it
 * in the same render that sees the session gone, so a logout is never shown
 * as an expired session. A new login is a full page load, which resets it.
 */
export const endedByLogout = (client: QueryClient) =>
  client.getQueryData<boolean>(logoutMarker) === true;

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const session = client.getQueryData(sessionQuery.queryKey);
      if (session) await logout(session);
    },
    onSuccess: async () => {
      await client.cancelQueries();
      forgetUser(client);
      // Synchronously after forgetUser: observers are notified only later.
      client.setQueryData(logoutMarker, true);
    },
  });
}
