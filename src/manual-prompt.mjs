import { buildResumePrompt } from './resume-data.mjs';

// Clipboard preparation never records an attempt, send intent, or submission.
export function promptForManualCopy(request) {
  if (!request?.input || !/^[\w-]{1,80}$/.test(String(request.id))) throw new Error('This request has no valid prompt reference.');
  const attempt = request.attempts?.findLast(item => item.deliveryId === request.deliveryId);
  if (typeof attempt?.prompt === 'string' && attempt.prompt.length <= 350000) {
    const lines = attempt.prompt.split(/\r?\n/);
    if (lines.includes(`AI_AGENT_REQUEST:${request.id}`) && lines.includes(`AI_AGENT_DELIVERY:${request.deliveryId}`)) return attempt.prompt;
  }
  const deliveryId = typeof request.deliveryId === 'string' && /^[\w-]{1,100}$/.test(request.deliveryId)
    ? request.deliveryId : `manual-${request.id}`;
  return buildResumePrompt(request, deliveryId);
}

export async function copyRequestPrompt(request, clipboard = globalThis.navigator?.clipboard) {
  if (typeof clipboard?.writeText !== 'function') throw new Error('Clipboard is unavailable. Select the full prompt in Details and copy it manually.');
  await clipboard.writeText(promptForManualCopy(request));
}
