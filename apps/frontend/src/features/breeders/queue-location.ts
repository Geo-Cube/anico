import {
  VerificationStatusSchema,
  type VerificationStatus,
} from '@anico/shared-schemas';

/** Search param holding the queue's status filter (`?stav=PENDING`). */
export const STATUS_FILTER_PARAM = 'stav';

export const PENDING_QUEUE_SEARCH = `?${STATUS_FILTER_PARAM}=PENDING`;

export const RETURNED_QUEUE_SEARCH = `?${STATUS_FILTER_PARAM}=RETURNED`;

/** Unknown or missing filter falls back to the pending queue. */
export function parseStatusFilter(value: string | null): VerificationStatus {
  const parsed = VerificationStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'PENDING';
}

/** Location state passed queue → detail so "back" keeps the active filter. */
export interface QueueLocationState {
  queueSearch: string;
}

export function isQueueLocationState(
  state: unknown,
): state is QueueLocationState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'queueSearch' in state &&
    typeof state.queueSearch === 'string'
  );
}

/** Location state passed detail → queue after a saved decision (WF 09). */
export interface DecisionNoticeState {
  notice: string;
}

export function isDecisionNoticeState(
  state: unknown,
): state is DecisionNoticeState {
  return (
    typeof state === 'object' &&
    state !== null &&
    'notice' in state &&
    typeof state.notice === 'string'
  );
}
