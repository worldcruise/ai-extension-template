export const JOB_ANALYSIS_KEY = 'analyzeJobsWithAI';

export async function readJobAnalysisSetting(browser = globalThis.chrome) {
  const stored = await browser.storage.local.get(JOB_ANALYSIS_KEY);
  return stored[JOB_ANALYSIS_KEY] === true;
}

export function createJobAnalysisSettings({browser = globalThis.chrome,root = document,events = window} = {}) {
  const input = root.querySelector('#job-ai-analysis'), status = root.querySelector('#job-ai-analysis-status');
  let revision = 0, pending = Promise.resolve(), writes = 0, disposed = false;
  const changed = () => {
    const ticket = ++revision, enabled = input.checked;
    writes++; status.textContent = 'Saving job analysis setting…';
    pending = pending.catch(()=>{}).then(()=>browser.storage.local.set({[JOB_ANALYSIS_KEY]:enabled}));
    void pending.then(()=>{
      if (!disposed && ticket === revision) status.textContent = 'Job analysis setting saved on this device.';
    },()=>{
      if (!disposed && ticket === revision) status.textContent = 'Could not save job analysis setting. Try again.';
    }).finally(()=>{writes--;});
  };
  const storedChange = (changes,area) => {
    if (disposed || writes || area !== 'local' || !changes[JOB_ANALYSIS_KEY]) return;
    revision++; input.checked = changes[JOB_ANALYSIS_KEY].newValue === true;
    status.textContent = 'Job analysis setting updated on this device.';
  };
  input.checked = false; input.disabled = true;
  input.addEventListener('change',changed); browser.storage.onChanged.addListener(storedChange);
  const ticket = revision;
  const ready = readJobAnalysisSetting(browser).then(enabled=>{
    if (!disposed && ticket === revision) {input.checked=enabled;status.textContent='Changes save automatically on this device.';}
  }).catch(()=>{if (!disposed) status.textContent='Could not load job analysis setting. AI analysis stays off until a saved preference is available.';})
    .finally(()=>{if (!disposed) input.disabled=false;});
  function dispose() {
    disposed=true;revision++;input.removeEventListener('change',changed);browser.storage.onChanged.removeListener(storedChange);events.removeEventListener('pagehide',dispose);
  }
  events.addEventListener('pagehide',dispose,{once:true});
  return {ready,dispose};
}
