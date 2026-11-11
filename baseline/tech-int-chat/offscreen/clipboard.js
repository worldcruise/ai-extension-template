// Extension-owned offscreen document. This is not injected into Meet or ChatGPT.
// Chrome's offscreen documents cannot be focused, so navigator.clipboard is not
// suitable here. Use the CLIPBOARD offscreen pattern documented by Chrome/MDN.
(() => {
    "use strict";
    const TARGET = "tech-int-chat-clipboard";
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.target !== TARGET || message.type !== "WRITE_CLIPBOARD_TEXT") return false;
        // Accept our trusted extension context, never a tab content script or another extension.
        if (sender?.id !== chrome.runtime.id || sender.tab ||
            (sender.url && !sender.url.startsWith(chrome.runtime.getURL("")))) return false;
        const { text, requestId, expiresAt } = message;
        if (typeof text !== "string" || !text.trim() || text.length > 205000 ||
            typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(requestId) ||
            !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 5000) {
            sendResponse({ ok: false, requestId, code: "invalid_or_expired" });
            return false;
        }
        const field = document.createElement("textarea");
        field.value = text;
        field.readOnly = true;
        field.setAttribute("aria-hidden", "true");
        let copied = false;
        let suppliedText = false;
        // Explicit text/plain avoids HTML formatting and preserves the source string
        // rather than rebuilding it from DOM text or textarea newline normalization.
        const onCopy = event => {
            if (!event.clipboardData) return;
            event.clipboardData.setData("text/plain", text);
            event.preventDefault();
            suppliedText = true;
        };
        try {
            document.body.appendChild(field);
            field.focus();
            field.select();
            document.addEventListener("copy", onCopy);
            copied = document.execCommand("copy");
        } catch { /* Return a failure without exposing the payload. */ }
        finally {
            document.removeEventListener("copy", onCopy);
            field.value = "";
            field.remove();
            window.getSelection()?.removeAllRanges();
        }
        sendResponse({ ok: copied === true && suppliedText, requestId,
            ...(copied === true && suppliedText ? {} : { code: "copy_command_failed" }) });
        return false; // synchronous response; do not hold an unrelated channel open
    });
})();
