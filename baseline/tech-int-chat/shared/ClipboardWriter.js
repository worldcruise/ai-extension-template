// Write-only clipboard helper for the initiating document. No copy-back-to-panel message.
// Call copy() directly from the user's handler, BEFORE any asynchronous ChatGPT work.
(function () {
    "use strict";
    if (globalThis.TechIntClipboard) return;
    const ID = /^[a-zA-Z0-9_-]{8,128}$/;
    const CODE = /^[a-z_]{1,48}$/;
    const NATIVE_TIMEOUT_MS = 5000;
    let pendingNative = null;
    function errorCode(error) {
        return error?.name === "NotAllowedError" ? "clipboard_write_denied" : "copy_api_failed";
    }
    function legacyCopy(text) {
        // Only called after the native call settled negatively (or is unavailable).
        // Keep the selected transcript, text-field selection and scroll position intact.
        const active = document.activeElement;
        const selection = window.getSelection();
        const ranges = [];
        for (let i = 0; selection && i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i).cloneRange());
        let inputSelection;
        try {
            if (typeof active?.selectionStart === "number") inputSelection = {
                start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection
            };
        } catch { /* Non-text input. */ }
        const field = document.createElement("textarea");
        field.value = text;
        field.readOnly = true;
        field.tabIndex = -1;
        field.setAttribute("aria-hidden", "true");
        field.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;";
        let supplied = false, copied = false;
        const onCopy = event => {
            if (!event.clipboardData) return;
            event.clipboardData.setData("text/plain", text);
            event.preventDefault();
            supplied = true;
        };
        try {
            document.body.appendChild(field);
            field.focus({ preventScroll: true });
            field.select();
            // Scoped to the temporary field: it cannot hijack an unrelated copy.
            field.addEventListener("copy", onCopy);
            copied = document.execCommand("copy");
        } catch { /* Offscreen fallback remains available. */ }
        finally {
            field.removeEventListener("copy", onCopy);
            field.value = "";
            field.remove();
            try {
                if (active?.isConnected) active.focus({ preventScroll: true });
                selection?.removeAllRanges();
                for (const range of ranges) selection?.addRange(range);
                if (inputSelection && active?.isConnected) active.setSelectionRange(
                    inputSelection.start, inputSelection.end, inputSelection.direction);
            } catch { /* The page may be unloading. */ }
        }
        return copied === true && supplied;
    }
    function offscreenCopy(text, requestId, nativeCode) {
        // This is only a fallback for a failed local copy, not the normal send path.
        return new Promise(resolve => {
            let settled = false;
            const finish = result => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => finish({ ok: false, code: "offscreen_timeout", nativeCode }), 5000);
            try {
                chrome.runtime.sendMessage({ type: "COPY_CHATGPT_PAYLOAD", text, requestId,
                    expiresAt: Date.now() + 4500 }, response => {
                    const error = chrome.runtime.lastError;
                    if (error) finish({ ok: false, code: "offscreen_unavailable", nativeCode });
                    else if (response?.ok === true) finish({ ok: true, method: "offscreen" });
                    else finish({ ok: false, code: CODE.test(response?.code || "") ? response.code : "copy_failed", nativeCode });
                });
            } catch { finish({ ok: false, code: "offscreen_unavailable", nativeCode }); }
        });
    }
    function afterNativeFailure(text, requestId, context, nativeCode) {
        try {
            if (legacyCopy(text)) return Promise.resolve({ ok: true, method: context, api: "execCommand" });
        } catch { /* An unloading DOM must not prevent the send operation. */ }
        return offscreenCopy(text, requestId, nativeCode);
    }
    function copy(text, requestId, context = "panel") {
        context = context === "content" ? "content" : "panel";
        if (typeof text !== "string" || !text.trim() || text.length > 205000 || !ID.test(requestId || "")) {
            return Promise.resolve({ ok: false, code: "invalid_request" });
        }
        // A timed-out native write cannot be cancelled. Do not start a second local
        // write while it is unresolved, nor race an offscreen write against it.
        if (pendingNative) return Promise.resolve({ ok: false, code: "previous_copy_pending" });
        if (typeof navigator.clipboard?.writeText !== "function") {
            return afterNativeFailure(text, requestId, context, "clipboard_api_unavailable");
        }
        let native;
        try {
            // Deliberately before any await/then/Chrome messaging: preserve the action context.
            native = Promise.resolve(navigator.clipboard.writeText(text));
        } catch (error) {
            return afterNativeFailure(text, requestId, context, errorCode(error));
        }
        pendingNative = native;
        return new Promise(resolve => {
            let finished = false;
            const timer = setTimeout(() => {
                finished = true;
                resolve({ ok: false, code: "copy_timeout" });
            }, NATIVE_TIMEOUT_MS);
            native.then(() => {
                if (pendingNative === native) pendingNative = null;
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve({ ok: true, method: context, api: "writeText" });
            }, error => {
                if (pendingNative === native) pendingNative = null;
                if (finished) return; // A late rejection must not launch a stale fallback write.
                finished = true;
                clearTimeout(timer);
                resolve(afterNativeFailure(text, requestId, context, errorCode(error)));
            });
        });
    }
    globalThis.TechIntClipboard = Object.freeze({ copy });
})();
