import { createQueueStore } from './queue-store.mjs';
import { runningPhases } from './generation-data.mjs';

export const batchKey = 'resumeBatch:v1';
export function createResumeBatch({ browser = chrome, jobs = createQueueStore(), generations } = {}) {
  let work = Promise.resolve();
  const serial = task => { const next = work.catch(() => {}).then(task); work = next; return next; };
  const read = async () => (await browser.storage.local.get(batchKey))[batchKey];
  const save = async state => { await browser.storage.local.set({ [batchKey]: state }); return state; };
  const documentRun = run => !run.kind || run.kind === 'documents';
  async function advance() {
    let state = await read();
    if (!state?.active) return state;
    let runs = await generations.list();
    const pause = message => save({ ...state, active: false, message });
    const failed = async message => {
      const current=(await generations.list()).find(run=>documentRun(run)&&run.jobId===state.currentJobId);
      if(current&&(runningPhases.includes(current.phase)||current.phase==='validating')) await generations.stop(current.id);
      await jobs.change(draft => { const index=draft.requests.findIndex(job=>job.id===state.currentJobId); if(index>=0&&draft.requests[index].state!=='cancelled')draft.requests[index]={...draft.requests[index],needsAction:true,error:message}; });
      if (typeof BroadcastChannel==='function') { const channel=new BroadcastChannel('ai-agent-resume-queue');channel.postMessage('changed');channel.close(); }
      state={...state,currentJobId:null,failed:(state.failed||0)+1};await save(state);
      runs=await generations.list();
    };
    if (state.currentJobId) {
      const run = runs.find(run => documentRun(run) && run.jobId === state.currentJobId);
      if (!run) await failed('The current run is unavailable.');
      else {
        if(run.phase==='waiting-login') await failed('Sign in to the AI provider, then use Resume for this job.');
        else if (runningPhases.includes(run.phase) || run.phase === 'validating') {
          if (run.trackingState === 'suspended') await failed('Tracking paused. Fetch the result again after the queue finishes.');
          else return state;
        }
        else if (run.phase !== 'complete') await failed(run.error || 'This job needs action.');
        else if (run.documentSettings?.autoDownload !== false) {
          if (!run.downloads || ['starting', 'downloading'].includes(run.downloads.state)) return state;
          if (['failed', 'partial'].includes(run.downloads.state)) await failed('Document delivery needs action.');
        }
        if (state.currentJobId) {
          state = { ...state, currentJobId: null, completed: state.completed + 1 };
          await save(state);
        }
      }
    }
    if (runs.some(run => runningPhases.includes(run.phase) || run.phase === 'validating')) return pause('Another AI job is running. Finish it before generating the remaining resumes.');
    const rows = (await jobs.read()).requests;
    while (state.remaining.length) {
      const [id, ...remaining] = state.remaining;
      const job = rows.find(job => job.id === id);
      if (!job || job.needsAction || job.state !== 'queued' || job.resume || job.capturePending || job.input.candidateId !== state.candidateId || runs.some(run => documentRun(run) && run.jobId === id)) {
        state = { ...state, remaining, skipped: state.skipped + 1 }; await save(state); continue;
      }
      // Save ownership before opening a tab so worker restarts cannot send twice.
      state = { ...state, remaining, currentJobId: id, message: `Generating ${state.completed + state.skipped + (state.failed||0) + 1} of ${state.total}` };
      await save(state);
      try { await generations.start(id, state.provider); }
      catch (error) { await failed(error.message || 'Could not start this job.'); void serial(advance).catch(()=>{}); return state; }
      return state;
    }
    return save({ ...state, active: false, message: `Finished: ${state.completed} generated${state.failed ? `, ${state.failed} need action` : ''}${state.skipped ? `, ${state.skipped} skipped` : ''}.` });
  }
  return {
    tick: () => serial(advance),
    start: (candidateId, provider) => serial(async () => {
      if ((await read())?.active) throw new Error('Resume generation is already running.');
      const runs = await generations.list();
      if (runs.some(run => runningPhases.includes(run.phase) || run.phase === 'validating')) throw new Error('Finish the current AI job before generating all resumes.');
      const remaining = (await jobs.read()).requests.filter(job => job.input.candidateId === candidateId && !job.needsAction && job.state === 'queued' && !job.resume && !job.capturePending && !job.isExample && !runs.some(run => documentRun(run) && run.jobId === job.id))
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).map(job => job.id);
      if (!remaining.length) throw new Error('No queued jobs without an existing generation run.');
      await save({ active: true, candidateId, provider: provider === 'deepseek' ? 'deepseek' : 'chatgpt', remaining, total: remaining.length, completed: 0, skipped: 0, currentJobId: null, message: 'Starting queued resumes…' });
      return advance();
    }),
    stop: () => serial(async () => { const state = await read(); return state && save({ ...state, active: false, message: 'Stopped after the current job. Remaining jobs stay queued.' }); })
  };
}
