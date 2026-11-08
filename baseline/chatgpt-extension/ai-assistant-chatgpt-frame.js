/**
 * AI Writing Assistant - iframe agent (same pattern as Google Search).
 * Runs in extension page context; receives prompt from parent (content script),
 * sends WRITING_ASSISTANT_QUERY to background, forwards WRITING_ASSISTANT_RESPONSE to parent.
 */
(function () {
    'use strict';

    function getParentOrigin() {
        try {
            return document.referrer ? new URL(document.referrer).origin : '*';
        } catch (e) {
            return '*';
        }
    }

    function readableConnectionError(error) {
        return /message channel closed|message port closed|extension context invalidated/i.test(String(error || ''))
            ? 'The extension connection was interrupted. Refresh this page and try again.' : error;
    }

    function debugLog(runId, hypothesisId, location, message, data) {
    }

    function debugTail(text, size = 180) {
        if (typeof text !== 'string') return '';
        return text.slice(Math.max(0, text.length - size));
    }

    // ChatGPT sometimes wraps draft text in its writing-block protocol. These
    // markers must never reach the panel, clipboard, or the editable field.
    function cleanWritingOutput(value, done) {
        if (typeof value !== 'string') return '';
        let text = value.replace(/\r\n?/g, '\n');
        let hadWrapper = false;

        while (/^\s*:::writing(?:\b|\{)/i.test(text)) {
            const lineEnd = text.indexOf('\n');
            const braceEnd = text.indexOf('}');
            if (braceEnd >= 0 && (lineEnd < 0 || braceEnd < lineEnd)) {
                text = text.slice(braceEnd + 1).replace(/^[ \t]*/, '');
            } else if (lineEnd >= 0) {
                text = text.slice(lineEnd + 1);
            } else {
                return ''; // Wait for the body instead of showing a partial header.
            }
            text = text.replace(/^\n+/, '');
            hadWrapper = true;
        }

        // Streaming can deliver ":::w", ":::writing{...", or a partial closing
        // marker before the next chunk. Do not briefly display those fragments.
        if (/^\s*:::[^\n]*$/.test(text)) return '';
        text = text.replace(/(?:\n|^)[ \t]*:::[ \t]*$/, '');
        if (!done) text = text.replace(/(?:\n|^)[ \t]*:{1,2}[ \t]*$/, '');
        // The panel is plain text; remove Markdown punctuation escapes outside code.
        text = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part.replace(/\\([!.,:;?])/g, '$1')).join('');
        return hadWrapper ? text.replace(/^\n+|\n+$/g, '') : text;
    }

    const frameDebugLengths = {};
    function logFrameProgress(requestId, message, data) {
        const textLength = typeof data?.text === 'string' ? data.text.length : (typeof data?.textLength === 'number' ? data.textLength : 0);
        const key = (requestId || 'no-id') + ':' + message;
        const previousLength = frameDebugLengths[key] || 0;
        const shouldLog =
            data?.done ||
            data?.error ||
            textLength < 500 ||
            textLength - previousLength >= 750;
        if (!shouldLog) return;
        frameDebugLengths[key] = textLength;
        debugLog(requestId || 'no-id', 'STREAM', 'ai-assistant-chatgpt-frame.js', message, data);
    }

    const receivedRequests = new Set();
    window.addEventListener('message', (event) => {
        const data = event.data;
        if (!data || data.type !== 'WA_GENERATE') return;

        const requestId = data.requestId;
        const prompt = data.prompt;
        const noCountUsage = !!data.noCountUsage;
        const structured = data.responseFormat === 'json';
        if (!requestId || !prompt || receivedRequests.has(requestId)) return;
        receivedRequests.add(requestId);
        if (receivedRequests.size > 128) receivedRequests.delete(receivedRequests.values().next().value);

        debugLog(requestId, 'STREAM', 'ai-assistant-chatgpt-frame.js:WA_GENERATE', 'stream.waFrameRequestStart', {
            promptLength: typeof prompt === 'string' ? prompt.length : -1,
            noCountUsage,
            parentOrigin: event.origin || null,
            parentReferrerOrigin: getParentOrigin()
        });

        let bestText = '';
        const bestMessageText = (message) => {
            const text = structured ? (typeof message?.text === 'string' ? message.text : '') : cleanWritingOutput(message?.text, message?.done === true);
            bestText = SideAIStreamText.stabilize(bestText, text, message?.done === true);
            return bestText;
        };

        let settled = false;
        let timeoutId = null;
        const deadline = Date.now() + 330000;
        let previousText = '';
        const armTimeout = ms => {
            if (settled) return;
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                chrome.runtime.onMessage.removeListener(listener);
                try { event.source.postMessage({ type: 'WA_RESPONSE', requestId, done: true, error: 'ChatGPT stopped responding. Please try again.' }, event.origin); } catch (_) {}
            }, Math.min(ms, Math.max(0, deadline - Date.now())));
        };

        const listener = (message) => {
            if (message.type !== 'WRITING_ASSISTANT_RESPONSE' || message.requestId !== requestId) return;
            if (settled) return;
            if (typeof message.text === 'string' && message.text && message.text !== previousText) {
                previousText = message.text;
                armTimeout(75000);
            }
            const outboundText = structured ? bestMessageText(message) : cleanWritingOutput(bestMessageText(message), message.done === true);

            logFrameProgress(requestId, 'stream.waFrameRuntimeResponse', {
                text: outboundText || '',
                textLength: outboundText.length,
                incomingTextLength: typeof message.text === 'string' ? message.text.length : 0,
                textTail: debugTail(outboundText || ''),
                done: message.done === true,
                error: message.error || null
            });

            try {
                event.source.postMessage({
                    type: 'WA_RESPONSE',
                    requestId,
                    text: outboundText,
                    done: message.done === true,
                    error: readableConnectionError(message.error) || null,
                    resetTime: message.resetTime || null
                }, event.origin);
            } catch (e) {
                console.warn('[AI Assistant Frame] postMessage failed:', e);
            }

            if (message.done || message.error) {
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                chrome.runtime.onMessage.removeListener(listener);
            }
        };

        chrome.runtime.onMessage.addListener(listener);
        armTimeout(150000);

        chrome.runtime.sendMessage({
            type: 'WRITING_ASSISTANT_QUERY',
            requestId,
            prompt: `${prompt}\n\n${structured ? 'Return only the requested JSON object. No Markdown fences, writing blocks or explanatory text.' : 'Return only the text to use. Do not wrap it in :::writing markers or code fences.'}`,
            noCountUsage
        }, () => {
            if (chrome.runtime.lastError) {
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                chrome.runtime.onMessage.removeListener(listener);
                debugLog(requestId, 'STREAM', 'ai-assistant-chatgpt-frame.js:sendMessage', 'stream.waFrameSendError', {
                    error: readableConnectionError(chrome.runtime.lastError.message) || 'Failed to send request'
                });
                try {
                    event.source.postMessage({
                        type: 'WA_RESPONSE',
                        requestId,
                        error: readableConnectionError(chrome.runtime.lastError.message) || 'Failed to send request'
                    }, event.origin);
                } catch (e) {}
            }
        });


    });
})();
