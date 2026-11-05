import {
  ConnectionStartResponseSchema,
  ProvidersResponseSchema,
  SessionSchema,
  type AuthProvider,
  type SafeReturnPath,
  type Session,
} from '@anico/shared-schemas';
import { apiRequest, isApiError } from '@/shared/lib/http';

export async function fetchProviders(signal?: AbortSignal) {
  const { providers } = await apiRequest('/api/auth/providers', {
    schema: ProvidersResponseSchema,
    ...(signal ? { signal } : {}),
  });
  return providers;
}

/** `null` means anonymous (401). Any other failure throws `unavailable`. */
export async function fetchSession(
  signal?: AbortSignal,
): Promise<Session | null> {
  try {
    return await apiRequest('/api/auth/session', {
      schema: SessionSchema,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (isApiError(error, 'unauthorized')) return null;
    throw error;
  }
}

/** A 401 means the server already ended the session; that counts as done. */
export async function logout(session: Session) {
  try {
    await apiRequest('/api/auth/logout', {
      method: 'POST',
      csrfToken: session.csrfToken,
    });
  } catch (error) {
    if (!isApiError(error, 'unauthorized')) throw error;
  }
}

const connectionHosts: Partial<Record<AuthProvider, string>> = {
  google: 'accounts.google.com',
  microsoft: 'login.microsoftonline.com',
};

/** Returns the provider URL; refuses anything but the provider's own host. */
export async function startConnection(
  session: Session,
  provider: AuthProvider,
) {
  const { url } = await apiRequest(`/api/auth/connections/${provider}`, {
    method: 'POST',
    csrfToken: session.csrfToken,
    schema: ConnectionStartResponseSchema,
  });
  const target = new URL(url);
  if (target.hostname !== connectionHosts[provider])
    throw new Error('Unexpected provider redirect');
  return target.href;
}

export function loginUrl(provider: AuthProvider, returnTo?: SafeReturnPath) {
  const path = `/api/auth/login/${provider}`;
  return returnTo
    ? `${path}?${new URLSearchParams({ returnTo }).toString()}`
    : path;
}
