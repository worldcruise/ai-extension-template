import { MessageQueue } from "../core/MessageQueue.js";

export const CLIPBOARD_TARGET = "tech-int-chat-clipboard";
export const CLIPBOARD_DOCUMENT = "offscreen/clipboard.html";
const MAX_TEXT_CHARS = 205000;
const MAX_PENDING = 8;
const MAX_DEADLINE_MS = 5000;
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const RESULT_CODE = /^[a-z_]{1,48}$/;

/** Write-only offscreen fallback for the initiating panel or a direct ChatGPT hotkey.
 * The normal path calls the local Clipboard API without involving this service.
 */
export class ClipboardService {
    constructor(api = globalThis.chrome, now = Date.now) {
        this.api = api;
        this.now = now;
        this.queue = new MessageQueue();
        this.pending = 0;
    }
    allowedSender(sender) {
        if (sender?.id !== this.api.runtime.id) return false;
        try {
            const url = new URL(sender.url);
            const panel = new URL(this.api.runtime.getURL("index.html"));
            // An extension page opened as a tab legitimately has sender.tab metadata.
            if (url.protocol === panel.protocol && url.host === panel.host && url.pathname === panel.pathname) {
                return sender.frameId === undefined || sender.frameId === 0;
            }
            return sender.frameId === 0 && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0 &&
                (url.origin === "https://chatgpt.com" || url.origin === "https://chat.openai.com");
        } catch { return false; }
    }
    async copy(message, sender) {
        if (!this.allowedSender(sender)) return { ok: false, code: "invalid_sender" };
        if (!message || typeof message.text !== "string" || !message.text.trim() ||
            message.text.length > MAX_TEXT_CHARS || typeof message.requestId !== "string" ||
            !REQUEST_ID.test(message.requestId) || !Number.isFinite(message.expiresAt) ||
            message.expiresAt > this.now() + MAX_DEADLINE_MS) {
            return { ok: false, code: "invalid_request" };
        }
        if (message.expiresAt <= this.now()) return { ok: false, code: "expired" };
        if (this.pending >= MAX_PENDING) return { ok: false, code: "busy" };
        this.pending++;
        try {
            return await this.queue.run(async () => {
                if (message.expiresAt <= this.now()) return { ok: false, code: "expired" };
                if (!this.api.offscreen?.createDocument || !this.api.runtime.getContexts) {
                    return { ok: false, code: "offscreen_unavailable" };
                }
                let hasDocument = false;
                try {
                    const contexts = await this.api.runtime.getContexts({
                        contextTypes: ["OFFSCREEN_DOCUMENT"],
                        documentUrls: [this.api.runtime.getURL(CLIPBOARD_DOCUMENT)]
                    });
                    hasDocument = contexts.length > 0;
                    if (message.expiresAt <= this.now()) return { ok: false, code: "expired" };
                    if (!hasDocument) {
                        await this.api.offscreen.createDocument({
                            url: CLIPBOARD_DOCUMENT,
                            reasons: ["CLIPBOARD"],
                            justification: "Copy the user's outgoing ChatGPT prompt before submitting it."
                        });
                        hasDocument = true;
                    }
                    // Never issue a stale clipboard write after the caller gave up.
                    if (message.expiresAt <= this.now()) return { ok: false, code: "expired" };
                    const result = await this.write(message, CLIPBOARD_TARGET);
                    return result.ok ? { ok: true, method: "offscreen" } : result;
                } catch {
                    return { ok: false, code: "offscreen_unavailable" };
                } finally {
                    if (hasDocument) {
                        try { await this.api.offscreen.closeDocument(); }
                        catch { /* The helper also wipes its textarea and listeners. */ }
                    }
                }
            });
        } catch {
            return { ok: false, code: "clipboard_unavailable" };
        } finally { this.pending--; }
    }
    write({ text, requestId, expiresAt }, target = CLIPBOARD_TARGET) {
        return new Promise(resolve => {
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => finish({ ok: false, code: "copy_timeout" }),
                Math.max(1, expiresAt - this.now()));
            try {
                this.api.runtime.sendMessage({ target, type: "WRITE_CLIPBOARD_TEXT", text, requestId, expiresAt }, response => {
                    const error = this.api.runtime.lastError;
                    if (error) finish({ ok: false, code: "clipboard_unavailable" });
                    else if (response?.requestId !== requestId) finish({ ok: false, code: "invalid_receipt" });
                    else if (response.ok === true) finish({ ok: true });
                    else finish({ ok: false, code: RESULT_CODE.test(response?.code || "") ? response.code : "copy_failed" });
                });
            } catch { finish({ ok: false, code: "clipboard_unavailable" }); }
        });
    }
}
