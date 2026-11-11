import { linkedConversationUrl } from './sidebar-protocol.mjs';
import { deepseekConversation } from './deepseek-protocol.mjs';

export function savedChatUrl(value) {
  return linkedConversationUrl(value) || deepseekConversation(value) || null;
}
export function requestChatUrl(request) {
  return savedChatUrl(request?.manualChatUrl) || linkedConversationUrl(request?.sourceChatUrl);
}
export function chatProviderForUrl(value) {
  return deepseekConversation(value) ? 'deepseek' : 'chatgpt';
}
