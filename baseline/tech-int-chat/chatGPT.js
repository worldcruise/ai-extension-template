// ChatGPT content controller. Prepared panel submissions are not rebuilt or copied again.
(function () {
    "use strict";
    if (window.__techIntChatGPTContentV2Ready) return;
    if (!globalThis.TechIntPromptBuilder || !globalThis.TechIntClipboard || !window.__techIntChatAdapterV2) {
        console.warn("[tech-int-chat] missing bundled dependencies; refresh the ChatGPT tab");
        return;
    }
    window.__techIntChatGPTContentV2Ready = true;
    const adapter = new window.__techIntChatAdapterV2.ChatGPTAdapter();
    const requests = new Map();
    let activeController = null;
    let activeRequestId = null;
    let currentAIMode = "conversation";
    const normalizeMode = TechIntPromptBuilder.normalizeMode;

    function safeReceipt(value) {
        if (value?.ok === true) {
            const result = { ok: true };
            if (["panel", "content", "offscreen"].includes(value.method)) result.method = value.method;
            if (["writeText", "execCommand"].includes(value.api)) result.api = value.api;
            return result;
        }
        const result = { ok: false, code: /^[a-z_]{1,48}$/.test(value?.code || "") ? value.code : "not_reported" };
        if (/^[a-z_]{1,48}$/.test(value?.nativeCode || "")) result.nativeCode = value.nativeCode;
        return result;
    }
    function handleChatGPTRequest(request, localAction = false) {
        const { requestId } = request;
        if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) {
            return Promise.resolve({ status: "Error", error: "Missing request identity", uncertain: false });
        }
        if (requests.has(requestId)) return requests.get(requestId);
        if (activeController) {
            return Promise.resolve({ status: "Error", error: "Another ChatGPT submission is in progress", uncertain: false });
        }
        let text;
        try {
            if (localAction) {
                text = TechIntPromptBuilder.build(request.state, "", currentAIMode);
            } else {
                if (request.payloadVersion !== 1 || typeof request.finalText !== "string") {
                    throw new Error("A prepared prompt is required. Reload the extension panel.");
                }
                text = request.finalText;
                if (!text.trim() || text.length > TechIntPromptBuilder.MAX_PAYLOAD) throw new Error("Prompt is empty or too large");
                currentAIMode = normalizeMode(request.aiMode || currentAIMode);
            }
        } catch (error) { return Promise.resolve({ status: "Error", error: error.message, uncertain: false }); }
        const controller = new AbortController();
        activeController = controller;
        activeRequestId = requestId;
        let clipboard = localAction ? { ok: false, code: "not_attempted" } : safeReceipt(request.clipboard);
        // Hotkeys originating in ChatGPT copy directly from that key handler. Incoming
        // panel requests already attempted copying: do not overwrite the clipboard again.
        const copyTask = localAction ? TechIntClipboard.copy(text, requestId, "content") : Promise.resolve(clipboard);
        const task = copyTask.then(async result => {
            clipboard = safeReceipt(result);
            controller.signal.throwIfAborted();
            const sent = await adapter.send(text, controller.signal, { requestId, source: localAction ? "hotkey" : "panel", action: request.state });
            return { ...sent, clipboard };
        }).catch(error => ({ status: "Error", error: error.message || "Submission failed",
            uncertain: Boolean(error.uncertain), code: error.code, stage: error.stage, diagnostics: error.diagnostics, clipboard })).finally(() => {
            activeController = null;
            activeRequestId = null;
            while (requests.size > 128) requests.delete(requests.keys().next().value);
        });
        requests.set(requestId, task);
        return task;
    }
    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (sender?.id !== chrome.runtime.id || !request?.type) return false;
        if (request.type === "cancel-chatgpt") {
            if (activeRequestId === request.requestId) activeController?.abort(new Error("Submission cancelled"));
            sendResponse({ status: "Cancellation requested" });
            return false;
        }
        if (request.type === "ping") {
            sendResponse({ status: "ready", protocol: 2, version: "2.1.5", preparedPayload: true,
                clipboardBeforeSend: true, mode: currentAIMode });
            return false;
        }
        if (request.type === "set-ai-mode") {
            currentAIMode = normalizeMode(request.mode);
            sendResponse({ status: "AI mode updated", mode: currentAIMode });
            return false;
        }
        if (request.type === "to-chatgpt") {
            handleChatGPTRequest(request).then(sendResponse, error => {
                sendResponse({ status: "Error", error: error.message || "Submission failed", uncertain: false });
            });
            return true;
        }
        return false;
    });
    window.addEventListener("keydown", function (event) {
        if (!["F8", "F9", "F10"].includes(event.key)) return;
        event.preventDefault();
        if (event.repeat) return;
        const state = { F8: "followup-detail", F9: "followup-technical", F10: "followup-star" }[event.key];
        handleChatGPTRequest({ state, requestId: crypto.randomUUID() }, true).then(result => {
            if (result.status === "Error") {
                console.warn("[tech-int-chat 2.1.5] follow-up failed", result.code || "adapter_error", result.error || "Submission failed");
            } else if (result.clipboard?.ok === false) {
                console.warn("[tech-int-chat 2.1.5] follow-up sent; clipboard copy failed", result.clipboard.code || "not_reported");
            }
        });
    }, true);
})();
