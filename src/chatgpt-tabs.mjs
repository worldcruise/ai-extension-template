export async function existingChatGPTTabs(browser = chrome) {
  const tabs = await browser.tabs.query({ url: 'https://chatgpt.com/*' });
  return tabs.filter(tab => {
    try { const url = new URL(tab.url); return Number.isInteger(tab.id) && url.origin === 'https://chatgpt.com' && !url.username && !url.password && !/^\/(?:auth|login|sign_in)(?:\/|$)/.test(url.pathname); }
    catch { return false; }
  }).sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || (b.lastAccessed || 0) - (a.lastAccessed || 0) || b.id - a.id);
}

export async function focusChatGPTTab(tab, browser = chrome) {
  if (!tab) throw new Error('Open ChatGPT in a browser tab first, then use Generate documents or Resume.');
  await browser.tabs.update(tab.id, { active: true });
  if (Number.isInteger(tab.windowId)) await browser.windows.update(tab.windowId, { focused: true });
  return tab;
}
