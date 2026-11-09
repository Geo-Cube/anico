import {
  TestAccountSchema,
  TestAccountsResponseSchema,
  type CreateTestAccountInput,
} from '@anico/shared-schemas';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from '@/shared/lib/http';

export const testAccountsKey = ['test-accounts'] as const;

export const testAccountsQuery = queryOptions({
  queryKey: testAccountsKey,
  queryFn: async ({ signal }) =>
    (
      await apiRequest('/api/auth/test-accounts', {
        signal,
        schema: TestAccountsResponseSchema,
      })
    ).accounts,
});

export const createTestAccount = (
  input: CreateTestAccountInput,
  csrfToken: string,
) =>
  apiRequest('/api/auth/test-accounts', {
    method: 'POST',
    body: input,
    csrfToken,
    schema: TestAccountSchema,
  });

/** Replaces the browser session cookie; the caller must reload the session. */
export const switchToTestAccount = (userId: string, csrfToken: string) =>
  apiRequest(`/api/auth/test-accounts/${userId}/session`, {
    method: 'POST',
    csrfToken,
  });

export const returnToOwnAccount = (csrfToken: string) =>
  apiRequest('/api/auth/test-accounts/return', { method: 'POST', csrfToken });
