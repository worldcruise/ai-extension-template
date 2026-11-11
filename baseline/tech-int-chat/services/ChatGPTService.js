import { CONFIG } from "../core/Config.js";
import { clipboardReceipt } from "../core/RequestManager.js";

const URLS = ["https://chatgpt.com/*", "https://chat.openai.com/*"];
const FILES = ["gptPrompts.js", "shared/PromptBuilder.js", "shared/ClipboardWriter.js",
    "adapters/ChatGPTAdapter.js", "chatGPT.js"];

function tabMessage(tabId, message, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (!settled) { settled = true; reject(new Error("ChatGPT tab response timed out")); }
        }, timeoutMs);
        try {
            chrome.tabs.sendMessage(tabId, message, response => {
                const error = chrome.runtime.lastError;
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(new Error(error.message));
                else resolve(response);
            });
        } catch (error) { clearTimeout(timer); settled = true; reject(error); }
    });
}
export class ChatGPTService {
    constructor(storage, requests) { this.storage = storage; this.requests = requests; }
    async submit(request) {
        if (request.payloadVersion !== 1 || typeof request.finalText !== "string") {
            throw new Error("Reload the extension panel after upgrading. A prepared prompt is required.");
        }
        // ONE immutable payload, already copied by its originating panel. Do not reread
        // mutable transcript rows here and do not ask the ChatGPT tab to rebuild a prompt.
        const text = request.finalText;
        if (!text.trim() || text.length > 205000) throw new Error("Final prompt is empty or too large");
        const mode = request.state === "coding" || request.state === "conversation" ? request.state :
            (request.aiMode === "coding" ? "coding" : "conversation");
        const clipboard = clipboardReceipt(request.clipboard);
        const tabs = await chrome.tabs.query({ url: URLS });
        const tab = tabs.find(t => t.active) || tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (!tab?.id) throw new Error("No ChatGPT tab found. Open chatgpt.com first.");
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(
            JSON.stringify([tab.id, mode, text])));
        const fingerprint = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
        const job = await this.requests.submit({ id: request.requestId, fingerprint, tabId: tab.id, clipboard },
            async (signal, beforeDispatch) => {
                signal.throwIfAborted();
                let pong;
                try { pong = await tabMessage(tab.id, { type: "ping" }, 2500); }
                catch {
                    signal.throwIfAborted();
                    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
                    pong = await tabMessage(tab.id, { type: "ping" }, 2500);
                }
                if (pong?.protocol !== CONFIG.protocol || pong?.preparedPayload !== true || pong?.version !== CONFIG.version) {
                    throw new Error("Refresh the ChatGPT tab after upgrading the extension");
                }
                await beforeDispatch();
                const cancel = () => {
                    tabMessage(tab.id, { type: "cancel-chatgpt", requestId: request.requestId }, 2000).catch(() => {});
                };
                signal.addEventListener("abort", cancel, { once: true });
                try {
                    signal.throwIfAborted();
                    return await tabMessage(tab.id, { type: "to-chatgpt", requestId: request.requestId,
                        payloadVersion: 1, finalText: text, clipboard, aiMode: mode, state: request.state }, 38000);
                } finally { signal.removeEventListener("abort", cancel); }
            });
        return { status: "Job accepted", jobId: job.id, job };
    }
}
