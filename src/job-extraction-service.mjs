import { collectJobEvidence } from './job-page-evidence.mjs';
import { jobSiteAdapters } from './job-site-adapters.mjs';
import { cleanJobUrl, extractJobFromEvidence } from './job-extraction-core.mjs';

export function createJobExtractionService(browser=globalThis.chrome) {
  const failure = (code,message) => Object.assign(new Error(message),{code});
  return async function readJob(tabId) {
    if (!Number.isInteger(tabId) || tabId<0) throw failure('invalid-tab','Choose a job tab before reading the page.');
    let tab;
    try { tab=await browser.tabs.get(tabId); }
    catch { throw failure('missing-tab','This job tab was closed. Choose another tab and try again.'); }
    if (tab.url && (!cleanJobUrl(tab.url) || /(^|\.)chatgpt\.com$/i.test(new URL(tab.url).hostname))) {
      throw failure('unsupported-page','Open a job web page before using Read page.');
    }
    for (let attempt=0; attempt<5; attempt++) {
      let capture;
      try {
        const frames=await browser.scripting.executeScript({target:{tabId},func:collectJobEvidence,args:[jobSiteAdapters]});
        capture=frames.find(frame=>frame.frameId===0)?.result || frames[0]?.result;
      } catch {
        throw failure('page-access','Click the extension icon on this job page, then try Read page again.');
      }
      const current=await browser.tabs.get(tabId).catch(()=>null);
      if (!current || (tab.url && current.url!==tab.url) || (tab.url && capture?.url!==tab.url)) {
        throw failure('page-changed','The page changed while reading. Try Read page again.');
      }
      const result=extractJobFromEvidence(capture);
      if (result) return result;
      if (attempt===4) {
        throw failure('no-job', capture?.blockedFrames?.length
          ? 'The job may be in an embedded page. Open the listing in its own tab and try Read page again.'
          : 'No clear job posting was found. Wait for the job to load, or paste its details.');
      }
      await new Promise(resolve=>setTimeout(resolve,400));
    }
  };
}
