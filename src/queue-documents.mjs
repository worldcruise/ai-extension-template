import { parseManualResume } from './manual-documents.mjs';

export function createQueueDocuments({ queue, getRequest, openDialog, onSaved }) {
  const q = selector => document.querySelector(selector), dialog = q('#documents-dialog');
  const resume = q('#documents-resume'), letter = q('#documents-cover-letter'), enabled = q('#documents-cover-enabled');
  const status = q('#documents-status'), save = q('#documents-save');
  let current, generation = null, epoch = 0, busy = false;
  function validate() {
    letter.disabled = !enabled.checked || busy;
    save.disabled = true;
    if (!current || busy) return;
    try {
      parseManualResume(resume.value, current);
      if (enabled.checked && !letter.value.trim()) throw new Error('Add a cover letter or turn its switch off.');
      if (letter.value.length > 50000) throw new Error('Keep the cover letter under 50,000 characters.');
      status.textContent = 'Resume JSON is valid for this job and candidate. Ready to save.';
      status.dataset.state = 'valid'; save.disabled = false;
    } catch (error) { status.textContent = error.message; status.dataset.state = 'invalid'; }
  }
  for (const node of [resume, letter, enabled]) node.addEventListener('input', validate);
  q('#documents-import').addEventListener('click', () => q('#documents-file').click());
  q('#documents-file').addEventListener('change', async event => {
    const file = event.target.files?.[0], ticket = epoch;
    event.target.value = '';
    if (!file || busy) return;
    const previous = resume.value;
    try {
      if (file.size > 500000) throw new Error('Use a resume JSON file under 500 KB.');
      const text = await file.text();
      if (ticket !== epoch || !dialog.open || previous !== resume.value) return;
      resume.value = text; validate();
    } catch (error) { if (ticket === epoch) { status.textContent = error.message; status.dataset.state = 'invalid'; } }
  });
  dialog.addEventListener('close', () => { epoch++; current = null; });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  q('#documents-form').addEventListener('submit', async event => {
    event.preventDefault(); validate();
    if (!current || busy || save.disabled) return;
    const request = current, ticket = epoch;
    busy = true;
    for (const control of dialog.querySelectorAll('button,input,textarea')) control.disabled = true;
    try {
      await queue.saveDocuments(request.id, { resume: resume.value, coverLetter: letter.value, coverLetterEnabled: enabled.checked, expectedUpdatedAt: request.updatedAt,
        generationId: generation?.id, sourceUrl: generation?.url });
      if (ticket === epoch) { dialog.close(); onSaved(request.id); }
    } catch (error) {
      if (ticket === epoch) { status.textContent = error.message; status.dataset.state = 'invalid'; }
    } finally {
      busy = false;
      for (const control of dialog.querySelectorAll('button,input,textarea')) control.disabled = false;
      letter.disabled = !enabled.checked;
    }
  });
  return { open(id, { generated = null } = {}) {
    if (busy) return;
    const request = getRequest(id);
    if (!request) return;
    current = structuredClone(request); epoch++;
    generation = generated;
    q('#documents-context').textContent = `${request.input.job.company || 'Base resume'} · ${request.input.profile.name}`;
    resume.value = request.resume ? JSON.stringify(request.resume, null, 2) : '';
    letter.value = request.coverLetter || ''; enabled.checked = request.coverLetterEnabled === true;
    if (generated) {
      resume.value = generated.result ? JSON.stringify(generated.result.resume, null, 2) : generated.raw || '';
      letter.value = generated.result?.coverLetter || ''; enabled.checked = true;
    }
    validate(); openDialog('documents-dialog');
    resume.focus();
  } };
}
