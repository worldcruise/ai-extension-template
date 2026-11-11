import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateJobUrl, findExistingJob, jobUrlInList } from '../src/job-duplicates.mjs';

const input = (job = {}, candidateId = 'candidate-1') => ({ candidateId, tailor: true,
  job: { company: 'Northstar Labs', url: 'https://jobs.example.test/opening/42', ...job } });
const request = (options = {}) => ({ id: 'request-1', state: 'queued', input: input(), ...options });

test('one-click capture checks URLs across the candidate list, including examples and failures', () => {
  const url = 'https://jobs.example.test/opening/42/?utm_source=mail';
  for (const options of [{}, { state: 'ready' }, { state: 'invalid-output' }, { isExample: true }]) {
    assert.equal(jobUrlInList(url, 'candidate-1', [request(options)]), true);
  }
  assert.equal(jobUrlInList(url, 'candidate-2', [request()]), false);
  assert.equal(jobUrlInList(url, 'candidate-1', [request({ state: 'cancelled' })]), false);
  assert.equal(jobUrlInList('https://jobs.example.test/opening/43', 'candidate-1', [request()]), false);
  for (const value of ['', 'not a URL', 'chrome://settings', 'file:///job.html', 'javascript:alert(1)', null]) {
    assert.equal(jobUrlInList(value, 'candidate-1', [request()]), false);
  }
});

test('company or URL independently matches existing queued and saved jobs for the same candidate', () => {
  assert.deepEqual(findExistingJob(input({ company: '  NORTHSTAR\u00a0 Labs  ', url: 'https://other.test/77' }), [request()]),
    { requestId: 'request-1', matchedBy: ['company'], location: 'queue' });
  assert.deepEqual(findExistingJob(input({ company: 'Other Company' }), [request({ state: 'ready' })]),
    { requestId: 'request-1', matchedBy: ['url'], location: 'saved results' });
  assert.deepEqual(findExistingJob(input(), [request()]).matchedBy, ['company', 'url']);
  assert.ok(findExistingJob(input({ company: '\uff2eorthstar Labs', url: '' }), [request()]));
  assert.equal(findExistingJob(input({ company: 'Northstar Labs UK', url: '' }), [request()]), null, 'no substring or fuzzy company matching');
});

test('URL normalization removes tracking noise and retains distinct job identifiers, hash routes and path case', () => {
  assert.equal(duplicateJobUrl(' HTTPS://JOBS.EXAMPLE.TEST:443/opening/42/?utm_source=mail&b=2&a=1 '),
    duplicateJobUrl('https://jobs.example.test/opening/42?a=1&b=2'));
  assert.notEqual(duplicateJobUrl('https://jobs.test/?jobId=1'), duplicateJobUrl('https://jobs.test/?jobId=2'));
  assert.notEqual(duplicateJobUrl('https://jobs.test/#/job/1'), duplicateJobUrl('https://jobs.test/#/job/2'));
  assert.notEqual(duplicateJobUrl('https://jobs.test/Job'), duplicateJobUrl('https://jobs.test/job'));
  assert.equal(duplicateJobUrl('https://user:private@jobs.test/1'), '');
  for (const value of ['', 'not a URL', 'javascript:alert(1)', 'chrome://extensions', null]) assert.equal(duplicateJobUrl(value), '');
});

test('checks include existing jobs in any legacy state but exclude examples and cancelled jobs', () => {
  for (const state of ['queued', 'preparing', 'sending', 'generating', 'validating', 'saving', 'ready', 'unsent', 'interrupted', 'uncertain', 'attention', 'invalid-output', 'error-response']) {
    assert.ok(findExistingJob(input(), [request({ state })]), state);
  }
  for (const state of ['cancelled']) assert.equal(findExistingJob(input(), [request({ state })]), null);
  assert.equal(findExistingJob(input(), [request({ isExample: true })]), null);
  assert.equal(findExistingJob(input({}, 'other-candidate'), [request()]), null);
});

test('missing company labels, base resumes and generated resume fields do not become duplicate facts', () => {
  assert.equal(findExistingJob({ ...input(), tailor: false }, [request()]), null);
  assert.equal(findExistingJob(input(), [request({ input: { ...input(), tailor: false } })]), null);
  for (const company of ['', 'Untitled company', 'Company not provided']) {
    assert.equal(findExistingJob(input({ company, url: '' }), [request({ input: input({ company, url: '' }) })]), null);
  }
  const missing = input({ company: 'Northstar Labs', url: '', provenance: { company: { kind: 'missing' } } });
  assert.equal(findExistingJob(missing, [request()]), null);
  const historical = request({ input: input({ company: 'Historical label', url: '' }), resume: { company: 'Northstar Labs' } });
  const before = structuredClone(historical);
  assert.equal(findExistingJob(input({ url: '' }), [historical]), null);
  assert.deepEqual(historical, before, 'matching never rewrites historical labels or provenance');
});
