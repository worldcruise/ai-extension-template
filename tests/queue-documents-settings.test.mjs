import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueueDocuments } from '../src/queue-documents.mjs';
import { exampleProfile } from '../src/resume-data.mjs';

test('generated document review respects the run cover-letter preference and actual content', () => {
  const request = { id:'job-1', input:{ profile:exampleProfile, job:{ company:'Example', role:'Engineer' } },
    coverLetter:'A previously saved letter.', coverLetterEnabled:true };
  const resume = { company:'Example', title:exampleProfile.role, summary:exampleProfile.summary,
    skills:[{ Skills:exampleProfile.skills }], experience:exampleProfile.experience, education:exampleProfile.education };
  const nodes = new Map(), previous = globalThis.document;
  globalThis.document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { value:'', checked:false, disabled:false, dataset:{},
      addEventListener() {}, querySelectorAll:() => [], focus() {} });
    return nodes.get(selector);
  } };
  try {
    const documents = createQueueDocuments({ queue:{}, getRequest:() => request, openDialog() {}, onSaved() {} });
    for (const [settings, text, expected] of [[undefined, 'Generated letter.', true], [{ includeCoverLetter:false }, 'Unwanted letter.', false], [{ includeCoverLetter:true }, '', false]]) {
      documents.open(request.id, { generated:{ id:'run-1', result:{ resume, coverLetter:text }, documentSettings:settings } });
      assert.equal(nodes.get('#documents-cover-enabled').checked, expected);
      assert.equal(nodes.get('#documents-cover-letter').disabled, !expected);
      assert.equal(nodes.get('#documents-cover-letter').value, settings?.includeCoverLetter === false ? '' : text);
      assert.equal(nodes.get('#documents-save').disabled, false);
    }
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
