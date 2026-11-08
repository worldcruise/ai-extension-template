// ==========================
// CHATGPT API - Content script bridge
// Injects main-world script so fetch() initiator = chatgpt.com (not extension)
// HAR shows working requests come from chatgpt.com/cdn/assets/*.js
// ==========================

(function() {
'use strict';

const MSG_PREFIX = 'chatgpt-sidebar-ext-';
const PARENT_REQUEST = 'GOOGLE_SEARCH_API_CALL';
const PARENT_REQUEST_WA = 'WRITING_ASSISTANT_API_CALL';

if (window.__chatgptSidebarBridgeScriptLoaded) {
    return;
}
window.__chatgptSidebarBridgeScriptLoaded = true;

let inpageReady = false;
const pendingRequests = [];
let injectionPending = false;
const parentSourceMap = {}; // reqId -> { source, requestId } for postMessage responses to parent

function relayDebugLog(payload) {
}

function debugTail(text, size = 180) {
    if (typeof text !== 'string') return '';
    return text.slice(Math.max(0, text.length - size));
}

const bridgeDebugLengths = {};
function logBridgeProgress(channel, requestId, data) {
    try {
        const key = channel + ':' + (requestId || 'no-id');
        const textLength = typeof data?.text === 'string' ? data.text.length : 0;
        const previousLength = bridgeDebugLengths[key] || 0;
        const shouldLog =
            data?.done ||
            data?.error ||
            textLength < 500 ||
            textLength - previousLength >= 750;
        if (!shouldLog) return;
        bridgeDebugLengths[key] = textLength;
        relayDebugLog({
            sessionId: '954e83',
            runId: requestId || 'no-id',
            hypothesisId: 'STREAM',
            location: 'chatgpt-api.js:bridge',
            message: 'stream.bridgeProgress',
            data: {
                channel,
                chunk: !!data?.chunk,
                done: !!data?.done,
                hasError: !!data?.error,
                error: data?.error || null,
                textLength,
                textTail: debugTail(data?.text || '')
            },
            timestamp: Date.now()
        });
    } catch (_) {}
}

// #region agent log
relayDebugLog({sessionId:'954e83',runId:'bridge-load',hypothesisId:'H6',location:'chatgpt-api.js:18',message:'bridge.scriptLoaded',data:{href:location.href,readyState:document.readyState,inIframe:window !== window.top},timestamp:Date.now()});
// #endregion

function injectMainWorldScript() {
    if (window.__chatgptSidebarInpageLoaded || injectionPending) return;
    if (!chrome?.runtime?.getURL) return;
    injectionPending = true;
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('chatgpt-api-inpage.js');
    script.onload = () => {
        // #region agent log
        relayDebugLog({sessionId:'954e83',runId:'bridge-load',hypothesisId:'H6',location:'chatgpt-api.js:29',message:'bridge.inpageLoaded',data:{href:location.href},timestamp:Date.now()});
        // #endregion
        script.remove();
        injectionPending = false;
        window.__chatgptSidebarInpageLoaded = true;
        inpageReady = true;
        for (const p of pendingRequests.splice(0)) {
            if (p.isWa) {
                window.postMessage({ type: MSG_PREFIX + 'request-wa', requestId: p.reqId, prompt: p.prompt }, '*');
            } else {
                window.postMessage({ type: MSG_PREFIX + 'request', reqId: p.reqId, prompt: p.prompt, noBill: p.noBill }, '*');
            }
        }
    };
    script.onerror = () => {
        // #region agent log
        relayDebugLog({sessionId:'954e83',runId:'bridge-load',hypothesisId:'H6',location:'chatgpt-api.js:46',message:'bridge.inpageLoadFailed',data:{href:location.href},timestamp:Date.now()});
        // #endregion
        injectionPending = false;
        script.remove();
        for (const p of pendingRequests.splice(0)) {
            window.postMessage(p.isWa ? {
                type: MSG_PREFIX + 'response-wa', requestId: p.reqId, error: 'Failed to load API script'
            } : {
                type: MSG_PREFIX + 'response', reqId: p.reqId, error: 'Failed to load API script'
            }, '*');
        }
    };
    (document.head || document.documentElement).appendChild(script);
}

window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== MSG_PREFIX + 'debug' || !e.data.payload) return;
    // #region agent log
    relayDebugLog(e.data.payload);
    // #endregion
});

window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data || e.data.type !== MSG_PREFIX + 'response') return;
    const { reqId, text, done, error, chunk } = e.data;
    const parentMeta = reqId && parentSourceMap[reqId];
    const parentSource = parentMeta?.source;
    const parentRequestId = parentMeta?.requestId;
    if (reqId && window.__chatgptSidebarReqCb && window.__chatgptSidebarReqCb[reqId]) {
        const cb = window.__chatgptSidebarReqCb[reqId];
        if (error) {
            logBridgeProgress('google', parentRequestId || reqId, { error });
            if (parentSource) try { parentSource.postMessage({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, error }, '*'); } catch (_) {}
            cb({ error });
            delete window.__chatgptSidebarReqCb[reqId];
            delete parentSourceMap[reqId];
        } else if (chunk) {
            logBridgeProgress('google', parentRequestId || reqId, { text, chunk: true });
            if (parentSource) try { parentSource.postMessage({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, text }, '*'); } catch (_) {}
            cb({ text, chunk: true });
        } else if (done) {
            logBridgeProgress('google', parentRequestId || reqId, { text, done: true });
            if (parentSource) try { parentSource.postMessage({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, text, done: true, noBill: e.data.noBill }, '*'); } catch (_) {}
            cb({ text, done: true, noBill: e.data.noBill });
            delete window.__chatgptSidebarReqCb[reqId];
            delete parentSourceMap[reqId];
        }
    }
});

window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== PARENT_REQUEST) return;
    if (e.source === window) return;
    const { requestId: parentRequestId, prompt, noBill } = e.data;
    // #region agent log
    relayDebugLog({sessionId:'954e83',runId:parentRequestId || 'no-parent-id',hypothesisId:'H6',location:'chatgpt-api.js:84',message:'bridge.parentRequest',data:{requestType:'google',promptLength:typeof prompt === 'string' ? prompt.length : -1,noBill:!!noBill,inpageLoaded:!!window.__chatgptSidebarInpageLoaded},timestamp:Date.now()});
    // #endregion
    const reqId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    parentSourceMap[reqId] = { source: e.source, requestId: parentRequestId };
    if (!window.__chatgptSidebarReqCb) window.__chatgptSidebarReqCb = {};
    window.__chatgptSidebarReqCb[reqId] = function() {};
    if (!window.__chatgptSidebarInpageLoaded) {
        pendingRequests.push({ reqId, prompt, noBill });
        injectMainWorldScript();
    } else {
        window.postMessage({ type: MSG_PREFIX + 'request', reqId, prompt, noBill }, '*');
    }
});

// Writing Assistant - postMessage from parent (offscreen doc)
window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== PARENT_REQUEST_WA) return;
    if (e.source === window) return;
    const { requestId, prompt } = e.data;
    if (!requestId || !prompt) return;
    // #region agent log
    relayDebugLog({sessionId:'954e83',runId:requestId,hypothesisId:'H6',location:'chatgpt-api.js:103',message:'bridge.parentRequest',data:{requestType:'writingAssistant',promptLength:typeof prompt === 'string' ? prompt.length : -1,inpageLoaded:!!window.__chatgptSidebarInpageLoaded},timestamp:Date.now()});
    // #endregion
    const parentSource = e.source;
    const forwardToParent = (data) => {
        try { parentSource.postMessage({ type: 'WRITING_ASSISTANT_RESPONSE', requestId, ...data }, '*'); } catch (_) {}
    };
    window.addEventListener('message', function waResponse(ev) {
        if (ev.source !== window || !ev.data || ev.data.type !== MSG_PREFIX + 'response-wa' || ev.data.requestId !== requestId) return;
        const { text, done, error } = ev.data;
        if (error) {
            window.removeEventListener('message', waResponse);
            logBridgeProgress('writingAssistant', requestId, { error });
            forwardToParent({ error });
        } else if (done) {
            window.removeEventListener('message', waResponse);
            logBridgeProgress('writingAssistant', requestId, { text, done: true });
            forwardToParent({ text, done: true });
        } else if (text) {
            logBridgeProgress('writingAssistant', requestId, { text, chunk: true });
            forwardToParent({ text, done: false });
        }
    });
    if (!window.__chatgptSidebarInpageLoaded) {
        pendingRequests.push({ reqId: requestId, prompt, isWa: true });
        injectMainWorldScript();
    } else {
        window.postMessage({ type: MSG_PREFIX + 'request-wa', requestId, prompt }, '*');
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type !== 'GOOGLE_SEARCH_API_CALL') return false;
    const { requestId: parentRequestId, prompt, noBill } = message;
    const reqId = 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2);

    if (!window.__chatgptSidebarReqCb) window.__chatgptSidebarReqCb = {};
    window.__chatgptSidebarReqCb[reqId] = function(res) {
        const send = (msg) => {
            try {
                if (chrome?.runtime?.sendMessage) chrome.runtime.sendMessage(msg).catch(() => {});
            } catch (_) {}
        };
        if (res.error) {
            logBridgeProgress('google-runtime', parentRequestId, { error: res.error });
            send({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, error: res.error });
            sendResponse({ error: res.error });
        } else if (res.chunk && res.text) {
            logBridgeProgress('google-runtime', parentRequestId, { text: res.text, chunk: true });
            send({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, text: res.text });
        } else if (res.done) {
            logBridgeProgress('google-runtime', parentRequestId, { text: res.text, done: true });
            send({ type: 'CHATGPT_SEARCH_RESPONSE', requestId: parentRequestId, text: res.text, done: true, noBill: res.noBill });
            sendResponse({ ok: true });
        }
    };

    if (!window.__chatgptSidebarInpageLoaded) {
        pendingRequests.push({ reqId, prompt, noBill });
        injectMainWorldScript();
    } else {
        window.postMessage({ type: MSG_PREFIX + 'request', reqId, prompt, noBill }, '*');
    }
    return true;
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectMainWorldScript);
} else {
    injectMainWorldScript();
}

if (window !== window.top) {
    try { window.parent.postMessage({ type: 'CHATGPT_IFRAME_READY' }, '*'); } catch (_) {}
}

})();
