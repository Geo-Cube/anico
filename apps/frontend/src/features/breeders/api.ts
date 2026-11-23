import {
  AdminVerificationRequestSchema,
  VerificationRequestListSchema,
  VerificationSummarySchema,
  type AdminVerificationRequest,
  type DecideVerificationRequestInput,
  type VerificationStatus,
} from '@anico/shared-schemas';
import { DOCUMENT_QUEUE_LIMIT } from '@/features/documents/api';
import { plural } from '@/shared/lib/format';
import {
  apiBlob,
  apiRequest,
  conflictCurrent,
  isApiError,
} from '@/shared/lib/http';

const base = '/api/breeder/verification-requests';
export const verificationKey = ['verification-requests'] as const;

export const summaryQuery = {
  queryKey: [...verificationKey, 'summary'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}/summary`, {
      signal,
      schema: VerificationSummarySchema,
    }),
};

export const requestListQuery = (status: VerificationStatus) => ({
  queryKey: [...verificationKey, 'list', status],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}?${new URLSearchParams({ status })}`, {
      signal,
      schema: VerificationRequestListSchema,
    }),
});

export const requestDetailKey = (id: string) =>
  [...verificationKey, 'detail', id] as const;

export const requestDetailQuery = (id: string) => ({
  queryKey: requestDetailKey(id),
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest(`${base}/${encodeURIComponent(id)}`, {
      signal,
      schema: AdminVerificationRequestSchema,
    }),
});

export const decideRequest = (
  id: string,
  input: DecideVerificationRequestInput,
  csrfToken: string,
) =>
  apiRequest(`${base}/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    csrfToken,
    body: input,
    schema: AdminVerificationRequestSchema,
  });

export const downloadCertificate = (id: string) =>
  apiBlob(`${base}/${encodeURIComponent(id)}/certificate`);

/**
 * 409 from the decision endpoint: someone else already decided
 * (`already-decided`) or the breeder resubmitted a newer revision (`stale`).
 * `current` is the stored state, when the body carries a valid one.
 */
export function decisionConflict(error: unknown): {
  reason: 'already-decided' | 'stale';
  current: AdminVerificationRequest | null;
} | null {
  const conflict = conflictCurrent(error, AdminVerificationRequestSchema);
  if (!conflict) return null;
  return {
    reason:
      isApiError(error) && error.code === 'Verification revision mismatch'
        ? 'stale'
        : 'already-decided',
    current: conflict.current,
  };
}

export const breederName = ({ breeder }: AdminVerificationRequest) =>
  [breeder.firstName, breeder.lastName].filter(Boolean).join(' ') ||
  breeder.emailAddress ||
  'Neuvedené jméno';

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  PENDING: 'K posouzení',
  RETURNED: 'Vráceno k doplnění',
  APPROVED: 'Schváleno',
  REJECTED: 'Zamítnuto',
};

export const formatPendingCountText = (count: number) =>
  `${count} ${plural(count, 'žádost čeká', 'žádosti čekají', 'žádostí čeká')} na posouzení`;

export const formatReturnedCountText = (count: number) =>
  `${count} ${plural(count, 'žádost je vrácena', 'žádosti jsou vráceny', 'žádostí je vráceno')} k doplnění`;

export function formatPendingDocumentsText(count: number): string {
  const shown = count >= DOCUMENT_QUEUE_LIMIT ? `${count}+` : String(count);
  return `${shown} ${plural(count, 'doklad čeká', 'doklady čekají', 'dokladů čeká')} na posouzení`;
}
