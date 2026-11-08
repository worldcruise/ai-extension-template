// Offscreen document - hosts ChatGPT iframe in extension context (cookies work here)
// Same pattern as sidepanel - top-level is extension, not google.com
(function() {
'use strict';

const iframe = document.getElementById('chatgpt-iframe');
let iframeReady = false;

function debugLog(runId, hypothesisId, location, message, data) {
}

function debugTail(text, size = 180) {
    if (typeof text !== 'string') return '';
    return text.slice(Math.max(0, text.length - size));
}

const offscreenDebugLengths = {};
function logOffscreenProgress(channel, requestId, msg) {
    const key = channel + ':' + (requestId || 'no-id');
    const textLength = typeof msg?.text === 'string' ? msg.text.length : 0;
    const previousLength = offscreenDebugLengths[key] || 0;
    const shouldLog =
        msg?.done ||
        msg?.error ||
        textLength < 500 ||
        textLength - previousLength >= 750;
    if (!shouldLog) return;
    offscreenDebugLengths[key] = textLength;
    debugLog(requestId || 'no-id', 'STREAM', 'offscreen-chatgpt.js:relay', 'stream.offscreenProgress', {
        channel,
        done: !!msg?.done,
        hasError: !!msg?.error,
        error: msg?.error || null,
        textLength,
        textTail: debugTail(msg?.text || '')
    });
}

function stripCitationMarkers(text) {
    if (!text || typeof text !== 'string') return text || '';
    const normalizeEntityMarker = (match, markerType, markerPayload) => {
        if (String(markerType).trim().toLowerCase() !== 'entity') return '';
        try {
            const parsed = JSON.parse(markerPayload);
            if (Array.isArray(parsed)) {
                const preferred = parsed.find((value, index) => index > 0 && typeof value === 'string' && value.trim());
                if (preferred) return preferred.trim();
            }
        } catch (_) {}
        return '';
    };
    return text
        .replace(/\uE200([^\uE202]+)\uE202([\s\S]*?)\uE201/g, normalizeEntityMarker)
        .replace(/\uE200[\s\S]*?\uE201/g, '')
        .replace(/[\uE200-\uE202]/g, '')
        .replace(/\u3010\d+\u2020source\u3011/g, '')
        .replace(/\[cite\][^\]]*\[\]/g, '')
        .replace(/\s*cite\s*turn0(news|search)\d+(\s*turn0(news|search)\d+)*\s*/gi, ' ')
        .replace(/\s*navlist[^\n]*turn0(news|search)\d+[^\n]*\n?/g, '');
}

// A READY notification can outlive the iframe document. Probe the main-world
// listener before each batch; never replay a prompt after it has been dispatched.
let readinessCheck = null;
let needsReload = false;
let activeRequests = 0;

function loadFrame() {
    iframeReady = false;
    needsReload = false;
    iframe.src = iframe.getAttribute('data-src') || 'https://chatgpt.com/';
}

function probeFrame(timeoutMs) {
    return new Promise((resolve) => {
        const nonce = crypto.randomUUID();
        let interval;
        let timer;
        const finish = (ready) => {
            clearInterval(interval);
            clearTimeout(timer);
            window.removeEventListener('message', receive);
            resolve(ready);
        };
        const receive = (event) => {
            if (event.source === iframe.contentWindow && event.origin === 'https://chatgpt.com' &&
                event.data?.type === 'SIDEAI_API_HEALTH_READY' && event.data.nonce === nonce) {
                finish(true);
            }
        };
        const ping = () => iframe.contentWindow.postMessage({ type: 'SIDEAI_API_HEALTH_CHECK', nonce }, 'https://chatgpt.com');
        window.addEventListener('message', receive);
        interval = setInterval(ping, 200);
        timer = setTimeout(() => finish(false), timeoutMs);
        ping();
    });
}

async function ensureFrameReady() {
    if (!iframe?.contentWindow) throw new Error('ChatGPT iframe not ready');
    if (readinessCheck) return readinessCheck;
    readinessCheck = (async () => {
        if (needsReload && activeRequests === 0) loadFrame();
        if (await probeFrame(iframeReady ? 1200 : 12000)) {
            iframeReady = true;
            return;
        }
        // Do not interrupt another prompt that is already running.
        if (activeRequests === 0) {
            loadFrame();
            if (await probeFrame(12000)) {
                iframeReady = true;
                return;
            }
        }
        needsReload = true;
        throw new Error('ChatGPT is not ready. Please try again.');
    })();
    try { await readinessCheck; } finally { readinessCheck = null; }
}

if (iframe) loadFrame();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'OFFSCREEN_CHATGPT_API_CALL' &&
        message.type !== 'OFFSCREEN_WRITING_ASSISTANT_API_CALL') return false;
    handleCall(message, sendResponse);
    return true;
});

async function handleCall(message, sendResponse) {
    const writing = message.type === 'OFFSCREEN_WRITING_ASSISTANT_API_CALL';
    const responseType = writing ? 'WRITING_ASSISTANT_RESPONSE' : 'CHATGPT_SEARCH_RESPONSE';
    const requestType = writing ? 'WRITING_ASSISTANT_API_CALL' : 'GOOGLE_SEARCH_API_CALL';
    const { requestId, prompt } = message;
    // An offscreen message resets MV3's idle timer while ChatGPT is working.
    // Only active requests send this heartbeat; it is not an AI request.
    const heartbeat = setInterval(() => {
        chrome.runtime.sendMessage({ type: 'SIDEAI_CHATGPT_REQUEST_ACTIVE', requestId }).catch(() => {});
    }, 20000);
    try {
        await ensureFrameReady();
    } catch (error) {
        clearInterval(heartbeat);
        sendResponse({ error: error.message });
        return;
    }
    activeRequests++;
    let settled = false;
    let timer;
    const deadline = Date.now() + 300000;
    let lastText = null;
    const armTimeout = ms => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            needsReload = true;
            finish({ error: 'ChatGPT stopped responding. Please try again.' });
        }, Math.min(ms, Math.max(0, deadline - Date.now())));
    };
    const finish = (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        activeRequests--;
        window.removeEventListener('message', receive);
        delete offscreenDebugLengths[(writing ? 'writingAssistant' : 'google') + ':' + requestId];
        try { sendResponse(response); } catch (_) {}
    };
    const receive = (event) => {
        if (event.source !== iframe.contentWindow || event.origin !== 'https://chatgpt.com' ||
            event.data?.type !== responseType || event.data.requestId !== requestId) return;
        const msg = event.data;
        if (typeof msg.text === 'string' && msg.text && msg.text !== lastText) {
            lastText = msg.text;
            armTimeout(60000);
        }
        const text = writing && typeof msg.text === 'string' ? stripCitationMarkers(msg.text) : msg.text;
        chrome.runtime.sendMessage({
            type: responseType, requestId, text, done: msg.done, error: msg.error,
            resetTime: msg.resetTime, noBill: !!message.noBill, noCountUsage: !!message.noCountUsage
        }).catch(() => {});
        if (msg.error || msg.done) {
            finish(msg.error ? { error: msg.error, resetTime: msg.resetTime, delivered: true } : { ok: true });
        }
    };
    window.addEventListener('message', receive);
    armTimeout(120000);
    try {
        iframe.contentWindow.postMessage({ type: requestType, requestId, prompt, noBill: !!message.noBill }, 'https://chatgpt.com');
    } catch (error) {
        needsReload = true;
        finish({ error: error.message || 'Failed to reach ChatGPT' });
    }
}
})();
