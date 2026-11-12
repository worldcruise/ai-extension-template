import { tabUrl } from './ai-tabs.mjs';

const opening = new WeakMap();
function listingUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function openApplicationTabs({ jobUrl, browser = chrome }) {
  const listing = listingUrl(jobUrl);
  if (!listing) throw new Error('This job does not have a valid web listing URL.');
  let pending = opening.get(browser);
  if (!pending) { pending = new Map(); opening.set(browser, pending); }
  const key = listing;
  if (pending.has(key)) return pending.get(key);
  const operation = (async () => {
    const tabs = await browser.tabs.query({});
    let jobTab = tabs.filter(tab => Number.isInteger(tab.id) && listingUrl(tabUrl(tab)) === listing)
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    jobTab ||= await browser.tabs.create({ url: listing, active: true });
    jobTab = await browser.tabs.update(jobTab.id, { active: true }) || jobTab;
    if (Number.isInteger(jobTab.windowId)) await browser.windows.update(jobTab.windowId, { focused: true });
    return { jobTab, aiTab: null, warning: '' };
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
