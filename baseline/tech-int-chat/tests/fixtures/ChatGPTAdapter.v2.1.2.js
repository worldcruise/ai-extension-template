(function () {
    "use strict";
    if (window.__techIntChatAdapterV2) return;

    const EDITORS = ["#prompt-textarea", "div#prompt-textarea[contenteditable='true']",
        "div[contenteditable='true'][data-id='root']", "textarea[data-id='root']", "textarea"];
    const SEND = ["button[data-testid='send-button']", "button[aria-label='Send prompt']",
        "button[aria-label='Send message']", "button[data-testid='fruitjuice-send-button']"];
    const STOP = ["button[data-testid='stop-button']", "button[aria-label='Stop streaming']",
        "button[aria-label='Stop generating']"];
    const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
    function visible(node) {
        return node && node.isConnected && node.getClientRects().length &&
            getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none";
    }
    function find(selectors) {
        for (const selector of selectors) {
            for (const node of document.querySelectorAll(selector)) if (visible(node)) return node;
        }
        return null;
    }
    function editorText(editor) {
        if (!editor) return "";
        return /^(TEXTAREA|INPUT)$/.test(editor.tagName) ? editor.value : (editor.innerText || editor.textContent || "");
    }
    /** Temporary observer + low-frequency fallback for property-only changes; always cleaned up. */
    function waitFor(predicate, timeoutMs, signal) {
        return new Promise((resolve, reject) => {
            let observer, timer, fallback, done = false;
            const finish = (error, value) => {
                if (done) return;
                done = true;
                observer?.disconnect();
                clearTimeout(timer); clearInterval(fallback);
                signal?.removeEventListener("abort", abort);
                if (error) reject(error); else resolve(value);
            };
            const abort = () => finish(signal.reason || new Error("Submission cancelled"));
            const check = () => {
                try { const value = predicate(); if (value) finish(null, value); }
                catch (error) { finish(error); }
            };
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener("abort", abort, { once: true });
            check();
            if (done) return;
            observer = new MutationObserver(check);
            observer.observe(document.body || document.documentElement, {
                subtree: true, childList: true, characterData: true, attributes: true,
                attributeFilter: ["disabled", "aria-disabled", "class", "data-state"]
            });
            timer = setTimeout(() => finish(new Error("Timed out waiting for ChatGPT to become ready")), timeoutMs);
            fallback = setInterval(check, 500);
            check();
        });
    }
    function insert(editor, text) {
        editor.focus();
        if (/^(TEXTAREA|INPUT)$/.test(editor.tagName)) {
            const proto = editor.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
            if (setter) setter.call(editor, text); else editor.value = text;
            editor.dispatchEvent(new Event("input", { bubbles: true }));
            editor.dispatchEvent(new Event("change", { bubbles: true }));
            return;
        }
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges(); selection.addRange(range);
        // Preserve the editor's own undo/input integration when supported.
        let inserted = false;
        try { inserted = document.execCommand("insertText", false, text); } catch { /* fallback below */ }
        if (!inserted || normalize(editorText(editor)) !== normalize(text)) {
            editor.textContent = "";
            const paragraph = document.createElement("p");
            paragraph.textContent = text;
            editor.appendChild(paragraph);
        }
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        editor.dispatchEvent(new Event("change", { bubbles: true }));
    }
    class ChatGPTAdapter {
        constructor() { this.busy = false; }
        async send(text, signal) {
            if (this.busy) throw new Error("A ChatGPT submission is already in progress");
            this.busy = true;
            let clicked = false;
            const route = location.pathname;
            try {
                const editor = await waitFor(() => {
                    if (find(STOP)) return null; // never click Stop on the user's existing response
                    const node = find(EDITORS);
                    return node && !node.disabled && node.getAttribute("aria-disabled") !== "true" ? node : null;
                }, 12000, signal);
                signal.throwIfAborted();
                if (normalize(editorText(editor))) {
                    throw new Error("ChatGPT has an unsent draft. Send or clear that draft before using the extension.");
                }
                insert(editor, text);
                const button = await waitFor(() => {
                    if (!editor.isConnected || location.pathname !== route) throw new Error("ChatGPT changed pages before submission");
                    if (normalize(editorText(editor)) !== normalize(text)) return null;
                    const node = find(SEND);
                    return node && !node.disabled && node.getAttribute("aria-disabled") !== "true" && !find(STOP) ? node : null;
                }, 4000, signal);
                signal.throwIfAborted();
                if (!editor.isConnected || normalize(editorText(editor)) !== normalize(text)) {
                    throw new Error("Prompt changed before submission; nothing was sent");
                }
                const beforeUsers = document.querySelectorAll('[data-message-author-role="user"]').length;
                clicked = true; // once this boundary is crossed, never replay on timeout
                button.click();
                await waitFor(() => {
                    const users = document.querySelectorAll('[data-message-author-role="user"]');
                    const last = users[users.length - 1];
                    const matchingNewMessage = users.length > beforeUsers && last && normalize(last.textContent).includes(normalize(text));
                    const liveEditor = find(EDITORS);
                    const clearedAndStreaming = liveEditor && !normalize(editorText(liveEditor)) && find(STOP);
                    return matchingNewMessage || clearedAndStreaming;
                }, 6000, signal);
                return { status: "Content sent" };
            } catch (error) {
                error.uncertain = clicked;
                throw error;
            } finally { this.busy = false; }
        }
    }
    window.__techIntChatAdapterV2 = { ChatGPTAdapter, waitFor };
})();
