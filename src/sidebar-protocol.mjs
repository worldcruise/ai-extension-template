export const CHATGPT_ORIGIN = 'https://chatgpt.com';
export const CHATGPT_HOME = `${CHATGPT_ORIGIN}/`;
export const FRAME_CHANNEL = 'ai-agent-template.sidebar';
export const EMBED_RULE_ID = 1;
export const DEEPSEEK_EMBED_RULE_ID = 2;

export function deepseekEmbedRules(extensionId) {
  return [{ id: DEEPSEEK_EMBED_RULE_ID, priority: 1,
    action: { type: 'modifyHeaders', responseHeaders: [
      { header: 'x-frame-options', operation: 'remove' },
      { header: 'content-security-policy', operation: 'remove' }
    ] },
    condition: { regexFilter: '^https://chat\\.deepseek\\.com/', initiatorDomains: [extensionId], resourceTypes: ['sub_frame'] }
  }];
}

export function frameShortcutMessage(message, sender, extensionId, nonce) {
  if (!nonce || sender?.id !== extensionId || message?.type !== 'workspace.shortcut' || message.nonce !== nonce ||
      !globalThis.AiAgentWorkspaceKeys.isAction(message.action) ||
      typeof message.pressId !== 'string' || !/^[\w-]{1,100}$/.test(message.pressId)) return null;
  try {
    const source = new URL(sender.url);
    if (source.origin !== CHATGPT_ORIGIN || source.username || source.password) return null;
  } catch { return null; }
  return { action: message.action, pressId: message.pressId };
}

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
  if (data.type === 'history.reply') {
    if (typeof data.operationId !== 'string' || !/^[\w-]{1,100}$/.test(data.operationId) || typeof data.ok !== 'boolean') return null;
    if (!data.ok) return {type:data.type,operationId:data.operationId,ok:false};
    const value = globalThis.AiAgentChatHistory.snapshot(data.value);
    return value ? {type:data.type,operationId:data.operationId,ok:true,value} : null;
  }
  if (data.type !== 'state') return null;
  const url = conversationUrl(data.url);
  if (!url) return null;
  return { type: 'state', url, ready: data.ready === true, guest: data.guest === true,
    ...(typeof data.buildId === 'string' && /^[\w.-]{1,100}$/.test(data.buildId) ? { buildId: data.buildId } : {}),
    ...(['signed-in', 'signed-out', 'unknown'].includes(data.authState) ? { authState: data.authState } : {}),
    ...(globalThis.AiAgentChatHistory.snapshot(data.history) ? {history:globalThis.AiAgentChatHistory.snapshot(data.history)} : {}) };
}

import './workspace-shortcut-keys.js';
import './chat-history.js';
