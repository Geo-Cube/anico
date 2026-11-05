import { z } from 'zod';
import { IdentitySchema } from './identity.js';

export const AuthProviderSchema = z.enum(['google', 'microsoft', 'apple']);

export const ProvidersResponseSchema = z.strictObject({
  providers: z.array(AuthProviderSchema),
});

export const SessionSchema = z.strictObject({
  identity: IdentitySchema,
  csrfToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  linkedProviders: z.array(AuthProviderSchema),
  canManageAccounts: z.boolean(),
});

export const ConnectionStartResponseSchema = z.strictObject({
  url: z.url({ protocol: /^https$/ }),
});

const pathCharacters = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/]*$/;
const queryCharacters = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]*$/;
const dotSegment = /(?:^|\/)\.{1,2}(?:\/|$)/;
const invalidEscape = /%(?![0-9A-Fa-f]{2})/;
const apiPath = /^\/api(?:\/|$)/i;

/**
 * In-app path the browser may return to after login. Only plain ASCII paths
 * on this origin qualify: no scheme, host, backslash, fragment, dot segment,
 * encoded path separator or API route. Anything else is rejected, not fixed up.
 */
export function isSafeReturnPath(value: string): boolean {
  if (value.length > 160) return false;
  const queryStart = value.indexOf('?');
  const path = queryStart === -1 ? value : value.slice(0, queryStart);
  const query = queryStart === -1 ? '' : value.slice(queryStart + 1);
  return (
    pathCharacters.test(path) &&
    !path.includes('//') &&
    !dotSegment.test(path) &&
    !apiPath.test(path) &&
    queryCharacters.test(query) &&
    !invalidEscape.test(query)
  );
}

export const SafeReturnPathSchema = z
  .string()
  .refine(isSafeReturnPath, 'Invalid return path');

/** Closed set of public login failure codes; never provider text or details. */
export const LoginErrorCodeSchema = z.enum([
  'LOGIN_CANCELLED',
  'LOGIN_EXPIRED',
  'LOGIN_FAILED',
  'ACCOUNT_DISABLED',
  'IDENTITY_ALREADY_LINKED',
  'RECENT_LOGIN_REQUIRED',
  'PROVIDER_UNAVAILABLE',
]);

export type AuthProvider = z.infer<typeof AuthProviderSchema>;
export type ProvidersResponse = z.infer<typeof ProvidersResponseSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type ConnectionStartResponse = z.infer<
  typeof ConnectionStartResponseSchema
>;
export type SafeReturnPath = z.infer<typeof SafeReturnPathSchema>;
export type LoginErrorCode = z.infer<typeof LoginErrorCodeSchema>;
