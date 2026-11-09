import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useCurrentSession } from '@/features/auth';
import { discardUserData, sessionQueryKey } from '@/features/auth/session';
import { returnToOwnAccount, switchToTestAccount } from './api';

/**
 * Switches the browser into a test account (`userId`) or back (`null`). The
 * server swaps the cookie; all data of the previous account is dropped before
 * the new session is loaded.
 */
export function useAccountSwitch() {
  const session = useCurrentSession();
  const client = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (userId: string | null) =>
      userId === null
        ? returnToOwnAccount(session.csrfToken)
        : switchToTestAccount(userId, session.csrfToken),
    onSuccess: async (_result, userId) => {
      await client.cancelQueries();
      discardUserData(client);
      await client.refetchQueries({ queryKey: sessionQueryKey });
      await navigate(userId === null ? '/testovaci-ucty' : '/');
    },
  });
}
