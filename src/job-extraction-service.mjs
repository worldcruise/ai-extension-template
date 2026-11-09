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
      } catch (error) {
        const details = String(error?.message || '');
        if (/chrome:\/\/|chrome-extension:\/\/|extensions gallery|chrome web store/i.test(details)) {
          throw failure('unsupported-page','Chrome does not allow this page to be read. Open a job listing on a regular website and try again.');
        }
        if (/cannot access|permission|not allowed|not permitted/i.test(details)) {
          throw failure('page-access','Chrome is blocking website access. Open this extension’s Site access settings and allow the job site, then try Read page again.');
        }
        throw failure('extraction-failed','The page could not be read. Reload the job page and try Read page again.');
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
