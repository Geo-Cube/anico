import { MyAccountSchema } from '@anico/shared-schemas';
import { apiRequest } from '@/shared/lib/http';

export const myAccountQuery = {
  queryKey: ['breeder-account'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest('/api/breeder/breeders/me', { signal, schema: MyAccountSchema }),
};
