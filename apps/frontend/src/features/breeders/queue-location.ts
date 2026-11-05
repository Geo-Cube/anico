/** Search param holding the queue's status filter (`?stav=PENDING`). */
export const STATUS_FILTER_PARAM = 'stav';

export const PENDING_QUEUE_SEARCH = `?${STATUS_FILTER_PARAM}=PENDING`;

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
