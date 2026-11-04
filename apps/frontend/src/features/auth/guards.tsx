import {
  isSafeReturnPath,
  type Role,
  type Session,
} from '@anico/shared-schemas';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, use, useRef, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ForbiddenState, UnavailableState } from '@/shared/ui/state-panel';
import {
  endedByLogout,
  useSession,
  useSessionExpiryCheck,
  type LoginPageState,
} from './session';

// Holds the last confirmed session for the protected subtree. Children read
// it here, not from the query, so they never render with a just-ended session
// while `RequireSession` is replacing them with the login redirect.
const SessionContext = createContext<Session | null>(null);
function SessionExpiryCheck({ session }: { session: Session }) {
  useSessionExpiryCheck(session);
  return null;
}

/**
 * Only a confirmed anonymous answer (401) leads to the login page. An outage
 * keeps the user where they are and offers a retry.
 */
export function RequireSession({ loading }: { loading: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  const client = useQueryClient();
  const hadSession = useRef(false);
  if (session.data) {
    hadSession.current = true;
    return (
      <SessionContext value={session.data}>
        <SessionExpiryCheck session={session.data} />
        <Outlet />
      </SessionContext>
    );
  }
  if (session.data === null) {
    if (endedByLogout(client))
      return (
        <Navigate
          to="/prihlaseni"
          replace
          state={{ loggedOut: true } satisfies LoginPageState}
        />
      );
    const current = location.pathname + location.search;
    const search =
      current !== '/' && isSafeReturnPath(current)
        ? `?${new URLSearchParams({ returnTo: current }).toString()}`
        : '';
    return (
      <Navigate
        to={`/prihlaseni${search}`}
        replace
        state={{ sessionEnded: hadSession.current } satisfies LoginPageState}
      />
    );
  }
  if (session.isError)
    return (
      <main className="flex min-h-screen items-center px-5">
        <UnavailableState
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      </main>
    );
  return loading;
}

/** Session of the signed-in user; only valid below `RequireSession`. */
export function useCurrentSession() {
  const session = use(SessionContext);
  if (!session)
    throw new Error('useCurrentSession is used outside RequireSession');
  return session;
}

export const canAdminister = (session: Session) =>
  session.identity.roles.some((role) => role === 'admin' || role === 'owner');

/**
 * UX only: hides screens the user cannot use. Every backend still enforces
 * the role (`requireRole`) on its own endpoints.
 */
export function RequireRole({ roles }: { roles: Role[] }) {
  const session = useCurrentSession();
  return session.identity.roles.some((role) => roles.includes(role)) ? (
    <Outlet />
  ) : (
    <ForbiddenState />
  );
}
