export const CHATGPT_ORIGIN = 'https://chatgpt.com';
export const CHATGPT_HOME = `${CHATGPT_ORIGIN}/`;
export const FRAME_CHANNEL = 'ai-agent-template.sidebar';
export const EMBED_RULE_ID = 1;

// Only keep conversation routes. Never relay auth URLs, query strings or hashes.
export function conversationUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== CHATGPT_ORIGIN || url.username || url.password) return null;
    if (!/^\/(?:c\/[\w-]+|g\/[\w-]+(?:\/c\/[\w-]+)?)?\/?$/.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

export function embedRules(extensionId) {
  return [{
    id: EMBED_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' }
      ]
    },
    condition: {
      regexFilter: '^https://chatgpt\\.com/',
      initiatorDomains: [extensionId],
      resourceTypes: ['sub_frame']
    }
  }];
}

export function linkedConversationUrl(value) {
  const url = conversationUrl(value);
  return url?.includes('/c/') ? url : null;
}

export function frameMessage(event, frameWindow, nonce) {
  const data = event.data;
  if (event.source !== frameWindow || event.origin !== CHATGPT_ORIGIN ||
      !data || data.channel !== FRAME_CHANNEL || data.nonce !== nonce) return null;
  if (data.type === 'sign-in') return { type: 'sign-in' };
  if (data.type !== 'state') return null;
  const url = conversationUrl(data.url);
  if (!url) return null;
  return { type: 'state', url, ready: data.ready === true, guest: data.guest === true };
}
