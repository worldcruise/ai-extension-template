import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualResume } from '../src/manual-documents.mjs';
import { buildResumePrompt, exampleProfile } from '../src/resume-data.mjs';

test('manual resume imports accept the reply or bare resume, and keep identity and facts validation', () => {
  const request = { id: 'saved-job', input: { profile: exampleProfile, job: { company: 'Northstar' }, tailor: true } };
  const envelope = JSON.parse(buildResumePrompt(request, 'manual').split('\n\n').find(part => part.startsWith('{"schemaVersion"')));
  assert.equal(parseManualResume(JSON.stringify(envelope), request).company, 'Northstar');
  assert.equal(parseManualResume('```json\n' + JSON.stringify(envelope.resume) + '\n```', request).company, 'Northstar');
  assert.throws(() => parseManualResume(JSON.stringify({ ...envelope, requestId: 'another-job' }), request), /another request/);
  const changed = structuredClone(envelope.resume); changed.experience[0].company = 'Invented employer';
  assert.throws(() => parseManualResume(JSON.stringify(changed), request), /changed a profile fact/);
  assert.throws(() => parseManualResume(JSON.stringify({ ...envelope.resume, company: 'Other job' }), request), /company does not match/);
  assert.throws(() => parseManualResume('x'.repeat(500001), request), /500 KB/);
});
