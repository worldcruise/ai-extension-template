import { cleanJobUrl } from './job-extraction-core.mjs';
import { isHiringCafe } from './job-cleanup.mjs';

// Serialized into the selected page. Read only unless its single, unambiguous
// non-form Apply control must be clicked to expose a JavaScript destination.
export function inspectApplyAction(click = false) {
  const visible = node => Boolean(node.getClientRects().length && getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[hidden],[aria-hidden="true"]'));
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible);
  const scope = dialogs.length === 1 ? dialogs[0] : document;
  const controls = [...scope.querySelectorAll('a,button,[role="button"]')].filter(node => visible(node) &&
    /^(?:apply(?: now| directly| for (?:this |the )?(?:job|position|role))?|apply on (?:company|employer)(?: website| site)?)(?:\s*[↗→])?$/i.test((node.getAttribute('aria-label') || node.innerText || node.textContent || '').trim()) &&
    !node.closest('form') && !node.disabled && node.getAttribute('aria-disabled') !== 'true');
  const unique = controls.filter(node => !controls.some(other => other !== node && other.contains(node)));
  const urls = [...new Set(unique.map(node => node.closest('a[href]')?.href || node.getAttribute('data-href') || node.getAttribute('data-url')).filter(Boolean))];
  if (click) {
    if (unique.length !== 1) throw new Error('Open the selected job detail so there is exactly one Apply control.');
    unique[0].click();
  }
  return {urls,clickable:unique.length === 1};
}

export async function resolveApplicationUrls(tabId, sourceUrl, browser = chrome, {timeoutMs = 12000} = {}) {
  const safe = value => cleanJobUrl(value);
  const current = await browser.tabs.get(tabId);
  if (current.url !== sourceUrl) throw new Error('The selected job page changed before its Apply link was read.');
  const result = await browser.scripting.executeScript({target:{tabId,frameIds:[0]},func:inspectApplyAction,args:[false]});
  const found = result?.[0]?.result, external = [...new Set((found?.urls || []).map(safe).filter(url => url && !isHiringCafe(url)))];
  if (!isHiringCafe(sourceUrl)) return [...new Set([...external,safe(sourceUrl)].filter(Boolean))];
  if (external.length === 1) return external;
  if (external.length > 1 || !found?.clickable) throw new Error('The employer Apply link is ambiguous. Open the selected job detail or enter its Apply URL manually.');
  let timer, finished = false;
  const changed = new Set();
  let resolve, reject;
  const destination = new Promise((yes,no)=>{resolve=yes;reject=no;});
  const finish = value => {if (!finished && safe(value) && !isHiringCafe(value)) {finished=true;resolve([safe(value)]);} };
  const created = tab => {if (tab.openerTabId === tabId) {changed.add(tab.id);finish(tab.pendingUrl || tab.url);} };
  const updated = (id,info,tab) => {if (id === tabId || changed.has(id) || tab?.openerTabId === tabId) finish(info.url || tab?.pendingUrl || tab?.url);};
  browser.tabs.onCreated.addListener(created); browser.tabs.onUpdated.addListener(updated);
  try {
    timer = setTimeout(()=>reject(new Error('The Apply control did not reveal an employer URL. Enter its destination manually.')),timeoutMs);
    // Observe popup ownership rather than accepting an arbitrary newly opened tab.
    const click = browser.scripting.executeScript({target:{tabId,frameIds:[0]},func:inspectApplyAction,args:[true]}).catch(error=>{if (!finished) reject(error);});
    const urls = await destination; await click;
    return urls;
  } finally {clearTimeout(timer);browser.tabs.onCreated.removeListener(created);browser.tabs.onUpdated.removeListener(updated);}
}
