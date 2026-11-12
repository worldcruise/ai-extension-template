import { isHiringCafe } from './job-cleanup.mjs';

export function createManualJobForm({ openDialog, saveRequest }) {
  const q = selector => document.querySelector(selector);
  const dialog = q('#manual-job-dialog'), form = q('#manual-job-form'), status = q('#manual-job-status');
  const fields = Object.fromEntries(['company', 'role', 'salary', 'url', 'description'].map(key => [key, q(`#manual-job-${key}`)]));
  let current = null, busy = false, epoch = 0;
  form.addEventListener('input', event => {
    event.target.setCustomValidity?.(''); status.textContent = '';
  });
  // Chrome queues close events. A rapid retry can reopen the dialog before the
  // previous close is delivered; do not discard that newly opened job.
  dialog.addEventListener('close', () => { if (!dialog.open) { current = null; epoch++; } });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!current || busy) return;
    const job = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value.trim()]));
    if (!job.description) fields.description.setCustomValidity('Paste the job description to add this job.');
    try {
      const url = new URL(job.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      if (current.options?.captureJobId && isHiringCafe(url.href)) throw new Error();
      job.url = url.href;
    } catch { fields.url.setCustomValidity('Enter an http:// or https:// job URL.'); }
    if (!form.reportValidity()) return;
    const { input, options } = current, ticket = epoch;
    job.provenance = Object.fromEntries(['company', 'role'].map(key => [key, !job[key] ? { kind: 'missing' } :
      job[key] === input.job[key]?.trim() && input.job.provenance?.[key] ? input.job.provenance[key] : { kind: 'user' }]));
    busy = true; dialog.setAttribute('aria-busy', 'true'); status.textContent = 'Saving job…';
    for (const control of dialog.querySelectorAll('button,input,textarea')) control.disabled = true;
    try {
      await saveRequest({ ...input, job: { ...input.job, ...job } }, options);
      if (ticket === epoch) dialog.close();
    } catch (error) {
      if (ticket === epoch) status.textContent = error.code === 'already-applied'
        ? 'This company or job URL is already in this candidate’s queue. Review the details before trying again.'
        : error.message || 'The job could not be saved. Your entries are still here; try again.';
    } finally {
      busy = false; dialog.setAttribute('aria-busy', 'false');
      for (const control of dialog.querySelectorAll('button,input,textarea')) control.disabled = false;
    }
  });
  return { open(input, options, reason) {
    if (busy) return;
    current = structuredClone({ input, options }); epoch++;
    fields.company.required = fields.role.required = Boolean(options?.captureJobId);
    q('#manual-job-context').textContent = `Save for ${input.profile.name}`;
    q('#manual-job-reason').textContent = reason || 'This page could not be read automatically. Enter the job details below.';
    status.textContent = '';
    for (const [key, field] of Object.entries(fields)) {
      field.value = typeof input.job[key] === 'string' ? input.job[key] : ''; field.setCustomValidity('');
    }
    if (!dialog.open) openDialog('manual-job-dialog');
    (Object.values(fields).find(field => !field.value && field !== fields.salary) || fields.description).focus();
  } };
}
