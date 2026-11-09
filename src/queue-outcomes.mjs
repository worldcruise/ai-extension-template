export const terminalStates = ['invalid-output', 'error-response'];
export const recoverableStates = ['unsent', 'interrupted', 'uncertain', 'attention'];
export const hasSubmissionEvidence = request => request.attempts?.some(attempt => attempt.sendIntent || attempt.dispatchedAt || attempt.submitted) === true;
export function deliveryEvidence(request) {
  const attempt = request.attempts?.at(-1);
  return { deliveryId: attempt?.deliveryId || request.deliveryId || null,
    intent: attempt?.sendIntent === true, dispatched: Boolean(attempt?.dispatchedAt), acknowledged: attempt?.submitted === true,
    description: attempt?.submitted ? 'Matching outgoing user message observed' : attempt?.dispatchedAt ? 'Send click dispatched; acceptance unconfirmed'
      : attempt?.sendIntent ? 'Send intent recorded; dispatch and acceptance may be uncertain' : 'No recorded Send intent, dispatch, or acknowledgement' };
}
export function compatibleRequest(request) {
  if (request.isExample) return request;
  const evidence = deliveryEvidence(request);
  if (request.state === 'attention') return { ...request, state: evidence.intent || evidence.dispatched || evidence.acknowledged ? 'uncertain' : 'unsent' };
  if (request.state === 'queued' && !request.regenerationAuthorized && hasSubmissionEvidence(request)) {
    return { ...request, state: 'uncertain', error: 'A previous delivery has submission evidence. Reconcile it or explicitly choose Generate again.' };
  }
  return request;
}
