const id = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) ? value : '';
const phases = ['preflight', 'inserting', 'readback', 'waiting-send', 'prepared', 'dispatched', 'acknowledged', 'collecting', 'failed', 'interrupted'];
export function redactedDiagnostic(value) {
  if (!value || typeof value !== 'object' || !phases.includes(value.phase)) return null;
  const number = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
  return { schemaVersion: 1, requestId: id(value.requestId), deliveryId: id(value.deliveryId), operationId: id(value.operationId),
    phase: value.phase, buildId: id(value.buildId),
    timestamps: Object.fromEntries(['startedAt', 'insertedAt', 'retainedAt', 'preparedAt', 'dispatchedAt', 'acknowledgedAt', 'completionObservedAt', 'capturedAt', 'failedAt']
      .filter(key => number(value.timestamps?.[key], Number.MAX_SAFE_INTEGER) !== null).map(key => [key, value.timestamps[key]])),
    editor: { type: ['textarea', 'contenteditable', 'missing', 'other'].includes(value.editor?.type) ? value.editor.type : 'other',
      connected: typeof value.editor?.connected === 'boolean' ? value.editor.connected : null, identityChanged: value.editor?.identityChanged === true,
      expectedLength: number(value.editor?.expectedLength, 350000), observedLength: number(value.editor?.observedLength, 500000),
      mismatchAt: value.editor?.mismatchAt === -1 ? -1 : number(value.editor?.mismatchAt, 500000) },
    send: { intent: value.send?.intent === true, dispatched: value.send?.dispatched === true, acknowledged: value.send?.acknowledged === true } };
}
