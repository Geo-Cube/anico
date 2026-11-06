import {
  AdminVerificationRequestSchema,
  DocumentReviewListSchema,
  VerificationRequestListSchema,
  VerificationSummarySchema,
  type AdminVerificationRequest,
  type DecideVerificationRequestInput,
  type VerificationStatus,
} from '@anico/shared-schemas';
import { apiBlob, apiRequest, isApiError } from '@/shared/lib/http';

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

/** The animal-service queue holds at most this many pending documents. */
export const DOCUMENT_QUEUE_LIMIT = 500;

export const pendingDocumentsQuery = {
  queryKey: ['document-reviews'],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    apiRequest('/api/animal/document-reviews', {
      signal,
      schema: DocumentReviewListSchema,
    }),
};

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
  if (!isApiError(error) || error.status !== 409) return null;
  const body = error.body;
  const parsed =
    body && typeof body === 'object' && 'current' in body
      ? AdminVerificationRequestSchema.safeParse(body.current)
      : null;
  return {
    reason:
      error.code === 'Verification revision mismatch'
        ? 'stale'
        : 'already-decided',
    current: parsed?.success ? parsed.data : null,
  };
}

const dateTime = new Intl.DateTimeFormat('cs-CZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
});
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

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

export function formatPendingCountText(count: number): string {
  if (count === 1) return '1 žádost čeká na posouzení';
  if (count >= 2 && count <= 4) return `${count} žádosti čekají na posouzení`;
  return `${count} žádostí čeká na posouzení`;
}

export function formatPendingDocumentsText(count: number): string {
  const shown = count >= DOCUMENT_QUEUE_LIMIT ? `${count}+` : String(count);
  if (count === 1) return '1 doklad čeká na posouzení';
  if (count >= 2 && count <= 4) return `${shown} doklady čekají na posouzení`;
  return `${shown} dokladů čeká na posouzení`;
}
