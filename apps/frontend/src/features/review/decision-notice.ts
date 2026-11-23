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
