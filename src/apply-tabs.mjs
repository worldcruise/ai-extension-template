import { openProviderTab, tabUrl } from './ai-tabs.mjs';
import { savedChatUrl, chatProviderForUrl } from './saved-chat.mjs';

const opening = new WeakMap();
function listingUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function openApplicationTabs({ jobUrl, conversationUrl = null, provider = 'chatgpt', browser = chrome }) {
  const listing = listingUrl(jobUrl);
  if (!listing) throw new Error('This job does not have a valid web listing URL.');
  const conversation = savedChatUrl(conversationUrl);
  const selectedProvider = conversation ? chatProviderForUrl(conversation) : provider;
  let pending = opening.get(browser);
  if (!pending) { pending = new Map(); opening.set(browser, pending); }
  const key = `${listing}\n${conversation || conversationUrl || ''}\n${selectedProvider}`;
  if (pending.has(key)) return pending.get(key);
  const operation = (async () => {
    const tabs = await browser.tabs.query({});
    let jobTab = tabs.filter(tab => Number.isInteger(tab.id) && listingUrl(tabUrl(tab)) === listing)
      .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    jobTab ||= await browser.tabs.create({ url: listing, active: true });
    jobTab = await browser.tabs.update(jobTab.id, { active: true }) || jobTab;
    if (Number.isInteger(jobTab.windowId)) await browser.windows.update(jobTab.windowId, { focused: true });
    if (conversationUrl == null) return { jobTab, aiTab: null, warning: '' };
    // The job listing owns focus. Opening its AI conversation never changes the
    // active tab or starts/resumes document generation.
    let aiTab = null, warning = '';
    try {
      if (conversationUrl != null && !conversation) throw new Error('Its saved AI conversation link is invalid.');
      aiTab = await openProviderTab(selectedProvider, { url: conversation, browser, focus: false });
    } catch (error) {
      warning = `Job listing opened. AI chat could not be opened: ${error.message || 'Try again from Open AI tab.'}`;
    }
    return { jobTab, aiTab, warning };
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
