import { parseResume } from './resume-data.mjs';

// Manual imports accept the full chat reply or its resume object. The same
// candidate facts and company validation apply to both shapes.
export function parseManualResume(source, request) {
  if (typeof source !== 'string' || source.length > 500000) throw new Error('Use a resume JSON file under 500 KB.');
  const raw = source.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1');
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('Paste one complete resume JSON object.'); }
  const envelope = value && Object.hasOwn(value, 'resume') ? value : { schemaVersion: 1, requestId: request.id, resume: value };
  if (Object.hasOwn(envelope, 'coverLetter')) delete envelope.coverLetter;
  if (Object.hasOwn(envelope, 'runId')) delete envelope.runId;
  if (Object.hasOwn(envelope, 'job')) delete envelope.job;
  return parseResume(JSON.stringify(envelope), request);
}
