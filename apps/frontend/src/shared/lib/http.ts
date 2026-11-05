import type { ZodType } from 'zod';

/**
 * - `unauthorized`: 401, the session is gone; only this leads to the login page.
 * - `forbidden`: 403, signed in but not allowed; show it in place.
 * - `rejected`: other 4xx with a business code, e.g. RECENT_LOGIN_REQUIRED.
 * - `unavailable`: network error, 5xx or an invalid response; offer retry.
 */
export type ApiErrorKind =
  'unauthorized' | 'forbidden' | 'rejected' | 'unavailable';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status?: number,
    readonly code?: string,
    readonly issues?: unknown,
  ) {
    super(code ?? kind);
    this.name = 'ApiError';
  }
}

export function isApiError(
  error: unknown,
  kind?: ApiErrorKind,
): error is ApiError {
  return error instanceof ApiError && (!kind || error.kind === kind);
}

type RequestOptions<T> = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Required by the gateway for every state-changing request. */
  csrfToken?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Omit for endpoints answering 204. */
  schema?: ZodType<T>;
};

async function errorBody(
  response: Response,
): Promise<{ code?: string; issues?: unknown }> {
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') return {};
    return {
      ...('error' in body && typeof body.error === 'string'
        ? { code: body.error }
        : {}),
      ...('issues' in body ? { issues: body.issues } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Same-origin JSON request. `redirect: 'error'` turns an expired Cloudflare
 * Access redirect on dev into `unavailable`, never into a fake logout.
 */
export async function apiRequest<T = undefined>(
  path: string,
  { method = 'GET', csrfToken, body, signal, schema }: RequestOptions<T> = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart)
    headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      redirect: 'error',
      ...(signal ? { signal } : {}),
      ...(body === undefined
        ? {}
        : { body: multipart ? body : JSON.stringify(body) }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError('unavailable');
  }
  if (!response.ok) {
    const { code, issues } = await errorBody(response);
    if (response.status === 401 && code !== 'RECENT_LOGIN_REQUIRED')
      throw new ApiError('unauthorized', 401, code, issues);
    if (response.status === 403)
      throw new ApiError('forbidden', 403, code, issues);
    if (response.status >= 400 && response.status < 500)
      throw new ApiError('rejected', response.status, code, issues);
    throw new ApiError('unavailable', response.status, code, issues);
  }
  if (!schema) return undefined as T;
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ApiError('unavailable', response.status, 'INVALID_RESPONSE');
  }
}
