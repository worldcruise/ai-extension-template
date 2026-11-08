// Keep authentication separate from quota. Never persist or expose session tokens.
let sideAIAuthRequest = null;

async function probeSideAIChatGPTTab() {
    const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    const tab = tabs.find(item => item.active) || tabs[0];
    if (!Number.isInteger(tab?.id)) return null;
    const result = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { type: 'SIDEAI_PROBE_CHATGPT_SESSION' }, { frameId: 0 }).catch(() => null),
        new Promise(resolve => setTimeout(() => resolve(null), 1200))
    ]);
    return result?.state || 'unverified-tab';
}

async function checkSideAIAuthentication() {
    // Share concurrent checks, but do not cache a result across user actions.
    if (sideAIAuthRequest) return sideAIAuthRequest;
    sideAIAuthRequest = (async () => {
        let tabState = null;
        try {
            tabState = await probeSideAIChatGPTTab();
            if (tabState === 'authenticated') return { allowed: true, state: 'authenticated' };
            if (tabState === 'guest') return sideAIGuestAuthStatus();
        } catch (_) {}
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1800);
        try {
            const response = await fetch('https://chatgpt.com/api/auth/session', {
                credentials: 'include',
                cache: 'no-store',
                headers: { Accept: 'application/json' },
                signal: controller.signal
            });
            if (response.status === 401) {
                if (tabState === 'unverified-tab') throw new Error('Tab status pending');
                return sideAIGuestAuthStatus();
            }
            if (!response.ok) throw new Error('Session unavailable');
            const session = await response.json();
            if (!session || typeof session !== 'object' || Array.isArray(session)) {
                throw new Error('Invalid session response');
            }
            if (typeof session.accessToken === 'string' && session.accessToken) {
                return { allowed: true, state: 'authenticated' };
            }
            // A user object without a token is not a usable session, but also
            // isn't proof of logout. Do not mislabel server failures as guests.
            if (session.user || session.error) throw new Error('Session incomplete');
            if (tabState === 'unverified-tab') throw new Error('Tab status pending');
            return sideAIGuestAuthStatus();
        } catch (_) {
            return {
                allowed: false, state: 'unknown', authUnavailable: true,
                error: 'Could not check ChatGPT. Please open ChatGPT and try again.'
            };
        } finally {
            clearTimeout(timer);
        }
    })();
    try { return await sideAIAuthRequest; }
    finally { sideAIAuthRequest = null; }
}

function sideAIGuestAuthStatus() {
    return {
        allowed: false, state: 'guest', loginRequired: true,
        error: 'Please log in to ChatGPT, then click Try again.'
    };
}

let sideAILoginTabOpening = null;
function openSideAIChatGPTLogin() {
    if (sideAILoginTabOpening) return sideAILoginTabOpening;
    sideAILoginTabOpening = (async () => {
        const tabs = await chrome.tabs.query({
            url: ['https://chatgpt.com/auth/*', 'https://auth.openai.com/*']
        });
        if (tabs.length) {
            await chrome.tabs.update(tabs[0].id, { active: true });
            await chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
            await chrome.tabs.create({ url: 'https://chatgpt.com/auth/login' });
        }
    })().finally(() => { sideAILoginTabOpening = null; });
    return sideAILoginTabOpening;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SIDEAI_OPEN_CHATGPT_LOGIN') {
        openSideAIChatGPTLogin().then(
            () => sendResponse({ ok: true }),
            () => sendResponse({ ok: false })
        );
        return true;
    }
    if (message.type === 'SIDEAI_CHECK_AUTH') {
        checkSideAIAuthentication().then(sendResponse);
        return true;
    }
    if (message.type === 'SIDEAI_OPEN_LOGIN_HELP') {
        const reason = message.unavailable ? 'unavailable' : 'waiting';
        const openPanel = windowId => {
            // Call before awaiting anything: Chrome requires a user gesture.
            const opening = chrome.sidePanel.open({ windowId });
            if (reason === 'waiting') void openSideAIChatGPTLogin().catch(() => {});
            const key = 'sideai-login-help-' + windowId;
            const pending = chrome.storage.session.set({ [key]: { reason, at: Date.now() } });
            const notifyExistingPanel = async () => {
                await pending.catch(() => {});
                const response = await chrome.runtime.sendMessage({
                    type: 'SIDEAI_SHOW_LOGIN_HELP', windowId, reason
                }).catch(() => null);
                return response?.shown === true;
            };
            opening.then(async () => {
                await notifyExistingPanel();
                sendResponse({ ok: true });
            }, async () => {
                const shown = await notifyExistingPanel().catch(() => false);
                sendResponse(shown ? { ok: true } : { ok: false, needsClick: true });
            });
        };
        if (Number.isInteger(sender.tab?.windowId)) openPanel(sender.tab.windowId);
        else chrome.windows.getLastFocused().then(win => openPanel(win.id), () => sendResponse({ ok: false }));
        return true;
    }
});
