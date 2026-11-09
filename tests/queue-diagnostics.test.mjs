import test from 'node:test';
import assert from 'node:assert/strict';
import { redactedDiagnostic } from '../src/queue-diagnostics.mjs';
import { BUILD, connectionReport, requireMatchingRevision } from '../src/runtime-info.mjs';
import { metadataProvenance, provenanceLabel } from '../src/job-metadata.mjs';
import { compatibleRequest, deliveryEvidence } from '../src/queue-outcomes.mjs';

test('diagnostic whitelisting drops content, account data, HTML, and unbounded identifiers', () => {
  const diagnostic = redactedDiagnostic({ phase: 'readback', requestId: 'request-1', deliveryId: 'delivery-1', operationId: 'x'.repeat(101),
    prompt: 'PRIVATE PROMPT', answer: 'PRIVATE ANSWER', account: 'PRIVATE ACCOUNT', buildId: 'source-unbuilt',
    timestamps: { insertedAt: 12, failedAt: -1, private: 'PRIVATE' },
    editor: { type: 'contenteditable', connected: true, identityChanged: true, expectedLength: 100, observedLength: 0, mismatchAt: 0, html: 'PRIVATE HTML' },
    send: { intent: true, dispatched: false, acknowledged: false } });
  assert.equal(diagnostic.operationId, ''); assert.equal(diagnostic.editor.identityChanged, true);
  assert.deepEqual(diagnostic.timestamps, { insertedAt: 12 });
  assert.ok(!JSON.stringify(diagnostic).includes('PRIVATE'));
  assert.equal(redactedDiagnostic({ phase: 'unknown' }), null);
});

test('completion timing is bounded and redacted without recording response or navigation contents', () => {
  const diagnostic = redactedDiagnostic({ phase: 'collecting', timestamps: {
    completionObservedAt: 100, capturedAt: 280, response: 'private', future: Infinity
  }, raw: 'private response', editor: { type: 'missing' } });
  assert.deepEqual(diagnostic.timestamps, { completionObservedAt: 100, capturedAt: 280 });
  assert.ok(!JSON.stringify(diagnostic).includes('private'));
});

test('inspection separates unknown authentication, readiness, confirmation scope, and runtime identity', () => {
  const input = { authState: 'unknown', composerPresent: true, composerReady: false, buildId: BUILD.id };
  const unconfirmed = connectionReport(input, false, 'sidebar');
  assert.equal(unconfirmed.authState, 'unknown'); assert.equal(unconfirmed.sessionConfirmed, false);
  const confirmed = connectionReport(input, true, 'tab');
  assert.equal(confirmed.authState, 'unknown'); assert.equal(confirmed.composerReady, false);
  assert.equal(confirmed.sessionConfirmed, true); assert.equal(confirmed.confirmationScope, 'tab');
  assert.equal(confirmed.revisionMatches, BUILD.id !== 'source-unbuilt');
  assert.throws(() => requireMatchingRevision({ buildId: 'older-build' }), error => error.code === 'revision-mismatch');
  assert.throws(() => requireMatchingRevision({}), error => error.code === 'revision-mismatch');
});

test('legacy metadata keeps labels without inventing provenance or parsing a filename', () => {
  const job = { company: 'Untitled company', role: 'ja_mageia', filename: 'Example_Profile.json' };
  assert.deepEqual(metadataProvenance(job), { company: { kind: 'legacy-unknown' }, role: { kind: 'legacy-unknown' } });
  assert.equal(job.role, 'ja_mageia');
  assert.equal(metadataProvenance({ company: '', role: 'Engineer', provenance: { role: { kind: 'profile-fallback' } } }).company.kind, 'missing');
  assert.equal(provenanceLabel({ kind: 'profile-fallback' }), 'Profile role fallback');
  assert.equal(metadataProvenance({ ...job, provenance: { company: { kind: 'user' }, role: { kind: 'structured', source: 'JobPosting' } } }).company.kind, 'user');
});

test('legacy uncertain records are preserved and intent, dispatch, and acknowledgement remain distinct', () => {
  const old = { state: 'attention', rawOutput: 'retained capture', attempts: [{ deliveryId: 'd', sendIntent: true, submitted: false }] };
  assert.equal(compatibleRequest(old).state, 'uncertain'); assert.equal(old.state, 'attention');
  assert.equal(compatibleRequest(old).rawOutput, 'retained capture');
  assert.deepEqual(deliveryEvidence(old), { deliveryId: 'd', intent: true, dispatched: false, acknowledged: false,
    description: 'Send intent recorded; dispatch and acceptance may be uncertain' });
  assert.equal(compatibleRequest({ ...old, state: 'queued' }).state, 'uncertain');
  assert.equal(compatibleRequest({ ...old, state: 'queued', regenerationAuthorized: true }).state, 'queued');
});
