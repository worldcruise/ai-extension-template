import { tabUrl, providerTabs, focusProviderTab, openProviderTab } from './ai-tabs.mjs';

export const chatGPTTabUrl = tabUrl;
export const existingChatGPTTabs = (browser = chrome) => providerTabs('chatgpt', browser);
export const focusChatGPTTab = (tab, browser = chrome) => focusProviderTab(tab, browser);
export const openChatGPTTab = (browser = chrome) => openProviderTab('chatgpt', { browser });
