import test from 'node:test';
import assert from 'node:assert/strict';
import { capturedResume } from './fixtures/captured-resume.mjs';
import { parseManualResume } from '../src/manual-documents.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

test('manual imports validate job identity and candidate facts for envelopes and bare resumes', () => {
  const request = { id: 'saved-job', input: { profile: exampleProfile, job: { company: 'Northstar' } } };
  const envelope = { schemaVersion: 1, requestId: request.id, resume: {
    company: 'Northstar', title: exampleProfile.role, summary: exampleProfile.summary,
    skills: [{ Skills: exampleProfile.skills }], experience: exampleProfile.experience, education: exampleProfile.education
  } };
  assert.equal(parseManualResume(JSON.stringify(envelope), request).company, 'Northstar');
  assert.equal(parseManualResume('```json\n' + JSON.stringify(envelope.resume) + '\n```', request).company, 'Northstar');
  assert.throws(() => parseManualResume(JSON.stringify({ ...envelope, requestId: 'another-job' }), request), /another request/);
  const changed = structuredClone(envelope.resume); changed.experience[0].company = 'Invented employer';
  assert.throws(() => parseManualResume(JSON.stringify(changed), request), /changed a profile fact/);
  assert.throws(() => parseManualResume(JSON.stringify({ ...envelope.resume, company: 'Other job' }), request), /company does not match/);
  assert.throws(() => parseManualResume('x'.repeat(500001), request), /500 KB/);
});

test('previously exported combined documents remain manually importable', () => {
  const { resume } = capturedResume;
  const request = { id: capturedResume.requestId, input: { job: { company: 'DTiQ' }, profile: {
    name: 'Example Candidate', role: resume.title, summary: resume.summary,
    skills: resume.skills[0]['Technical skills'], experience: resume.experience, education: resume.education
  } } };
  assert.deepEqual(parseManualResume(JSON.stringify(capturedResume), request), resume);
});
