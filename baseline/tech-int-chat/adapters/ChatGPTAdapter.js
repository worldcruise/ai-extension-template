(function () {
    "use strict";
    if (window.__techIntChatAdapterV2) return;

    const VERSION = "2.1.5";
    // These are ChatGPT composer selectors, NOT the protected Meet selectors.
    const PRIMARY_EDITORS = ["#prompt-textarea", '[data-testid="prompt-textarea"]',
        'div[contenteditable="true"][data-id="root"]', 'textarea[data-id="root"]', 'textarea[name="prompt"]'];
    const FALLBACK_EDITORS = ['[contenteditable="true"][data-lexical-editor="true"]',
        '[contenteditable="true"][role="textbox"]', "textarea"];
    const EDITORS = [...PRIMARY_EDITORS, ...FALLBACK_EDITORS];
    const SEND = ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]',
        'button[aria-label="Send message"]', 'button[data-testid="fruitjuice-send-button"]',
        "button#composer-submit-button", 'button[type="submit"]'];
    const STOP = ['button[data-testid="stop-button"]', 'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]'];
    const normalize = text => String(text || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").replace(/\s+/g, " ").trim();
    const history = []; // metadata only; never retain a DOM node, prompt, or conversation URL
    const TIMEOUT = Object.freeze({ editor: 10000, insert: 5000, send: 8000 });

    function failure(code, message) {
        return Object.assign(new Error(message), { code });
    }
    function visible(node) {
        return Boolean(node?.isConnected && node.getClientRects().length &&
            getComputedStyle(node).visibility !== "hidden" && getComputedStyle(node).display !== "none");
    }
    function writable(node) {
        if (!visible(node) || node.closest('[inert]') || node.matches(':disabled') || node.readOnly ||
            node.getAttribute("aria-disabled") === "true") return false;
        return node.tagName === "TEXTAREA" || (node.tagName === "INPUT" && /^(text|search)$/.test(node.type)) ||
            node.isContentEditable;
    }
    function resolvedEditor(candidate) {
        if (!candidate || candidate.closest('[data-message-author-role], [data-testid^="conversation-turn"]')) return null;
        if (writable(candidate)) return candidate;
        // A stable prompt selector can belong to a wrapper around the real ProseMirror/Lexical node.
        for (const child of candidate.querySelectorAll('textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) {
            if (!child.closest('[data-message-author-role], [data-testid^="conversation-turn"]') && writable(child)) return child;
        }
        return null;
    }
    function findEditor() {
        // Prefer ChatGPT's explicit prompt identifiers, but do not let a detached/auxiliary
        // primary-looking node beat the real form-local composer.
        let primaryFallback = null;
        for (const selector of PRIMARY_EDITORS) {
            for (const candidate of document.querySelectorAll(selector)) {
                const editor = resolvedEditor(candidate);
                if (!editor) continue;
                if (editor.closest("form")) return editor;
                primaryFallback ||= editor;
            }
        }
        // Broad contenteditable selectors are a last resort and must belong to a form. This
        // prevents editable conversation/auxiliary surfaces from being mistaken for the composer.
        for (const selector of FALLBACK_EDITORS) {
            const matches = [];
            for (const candidate of document.querySelectorAll(selector)) {
                const editor = resolvedEditor(candidate);
                if (editor?.closest("form")) matches.push(editor);
            }
            if (matches.length) {
                return matches.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
            }
        }
        return primaryFallback;
    }
    function find(selectors, scope = document) {
        for (const selector of selectors) {
            for (const node of scope.querySelectorAll(selector)) if (visible(node)) return node;
        }
        return null;
    }
    function findSend(editor) {
        const form = editor?.closest("form") || null;
        const scope = form || document;
        for (const selector of SEND) {
            // A generic submit button is safe only inside the verified composer form.
            if (selector === 'button[type="submit"]' && !form) continue;
            for (const node of scope.querySelectorAll(selector)) {
                if (!visible(node)) continue;
                const label = node.getAttribute("aria-label") || "";
                const testId = node.getAttribute("data-testid") || "";
                if (/voice|dictat|stop|cancel/i.test(label + " " + testId)) continue;
                // Some surfaces reuse this ID for the voice control when the draft is empty.
                if (selector === "button#composer-submit-button" && node.type !== "submit" &&
                    !/\bsend\b/i.test(label)) continue;
                return node;
            }
        }
        return null;
    }
    function enabled(node) {
        return Boolean(node && !node.disabled && !node.matches(':disabled') &&
            !node.closest('[inert]') && node.getAttribute("aria-disabled") !== "true");
    }
    function editorText(editor) {
        if (!editor) return "";
        return /^(TEXTAREA|INPUT)$/.test(editor.tagName) ? editor.value : (editor.innerText || editor.textContent || "");
    }
    /** Short-lived observer, timer and property-change poll. Always cleaned up. */
    function waitFor(predicate, timeoutMs, signal, timeoutError = () => failure("readiness_timeout", "ChatGPT readiness check timed out")) {
        return new Promise((resolve, reject) => {
            let observer, timer, fallback, done = false;
            const finish = (error, value) => {
                if (done) return;
                done = true;
                observer?.disconnect(); clearTimeout(timer); clearInterval(fallback);
                signal?.removeEventListener("abort", abort);
                if (error) reject(error); else resolve(value);
            };
            const abort = () => finish(signal.reason || failure("cancelled", "Submission cancelled"));
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
                attributeFilter: ["disabled", "readonly", "aria-disabled", "class", "data-state", "contenteditable"]
            });
            timer = setTimeout(() => finish(timeoutError()), timeoutMs);
            fallback = setInterval(check, 100);
            check();
        });
    }
    function pause(ms, signal) {
        return new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason || failure("cancelled", "Submission cancelled")); };
            const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener("abort", abort, { once: true });
        });
    }
    function selectEmptyEditor(editor) {
        editor.focus({ preventScroll: true });
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        selection.removeAllRanges(); selection.addRange(range);
    }
    class ChatGPTAdapter {
        constructor() { this.busy = false; }
        async send(text, signal = new AbortController().signal, context = {}) {
            if (this.busy) throw failure("submission_busy", "A ChatGPT submission is already in progress");
            if (typeof text !== "string" || !text.trim() || text.length > 205000) {
                throw failure("invalid_prompt", "Prompt is empty or too large");
            }
            this.busy = true;
            const started = Date.now(), route = location.pathname;
            const requestId = /^[a-zA-Z0-9_-]{8,128}$/.test(context.requestId || "") ? context.requestId : "diagnostic_local";
            const source = context.source === "hotkey" ? "hotkey" : "panel";
            const action = ({ "1": "normal", "conversation": "normal", "coding": "normal", "2": "detail", "3": "star",
                "5": "analysis", "followup-detail": "followup_detail", "followup-technical": "followup_technical",
                "followup-star": "followup_star" })[String(context.action)] || "prepared";
            const expected = normalize(text);
            let stage = "editor_lookup", clicked = false, method = "none", editor = null;
            let inserting = false, userEdited = false, inputEvents = 0, trustedInputs = 0;
            let pasteHandled = false, nativeReturned = false, replacements = 0;
            const snapshot = code => {
                const live = findEditor(), button = findSend(live);
                return { version: VERSION, requestId, source, action, stage, code, elapsedMs: Date.now() - started,
                    expectedChars: text.length, actualChars: editorText(live).length,
                    documentFocused: document.hasFocus(), transientActivation: Boolean(navigator.userActivation?.isActive), visibility: document.visibilityState,
                    editorKind: !live ? "none" : /^(TEXTAREA|INPUT)$/.test(live.tagName) ? "native" :
                        live.classList.contains("ProseMirror") ? "prosemirror" : live.hasAttribute("data-lexical-editor") ? "lexical" : "contenteditable",
                    knownEditorCandidates: document.querySelectorAll(EDITORS.join(",")).length,
                    editorFound: Boolean(live), editorTag: live?.tagName || "NONE",
                    activeInEditor: Boolean(live && (document.activeElement === live || live.contains(document.activeElement))),
                    textMatches: Boolean(live && normalize(editorText(live)) === expected),
                    sendFound: Boolean(button), sendEnabled: enabled(button), generationActive: Boolean(find(STOP)),
                    insertionMethod: method, pasteHandled, nativeReturned, inputEvents, trustedInputs, replacements, clicked };
            };
            const trace = code => {
                const data = snapshot(code);
                history.push(data); if (history.length > 120) history.shift();
                // No prompt text, speaker names, page HTML or conversation URLs in logs.
                try { console.info("[tech-int-chat 2.1.5] " + JSON.stringify(data)); } catch { /* diagnostics must not block submission */ }
                return data;
            };
            const checkRoute = () => {
                signal.throwIfAborted();
                if (location.pathname !== route) throw failure("page_changed", "ChatGPT changed pages before submission; nothing was sent");
                if (userEdited) throw failure("prompt_changed", "The composer was edited while preparing the prompt; nothing was sent");
            };
            const liveEditor = () => {
                const live = findEditor();
                if (live && editor && live !== editor) replacements++;
                if (live) editor = live;
                return live;
            };
            const onInput = event => {
                const live = findEditor();
                if (!live || (event.target !== live && !live.contains(event.target))) return;
                if (inserting) { inputEvents++; if (event.isTrusted) trustedInputs++; }
                else if (event.isTrusted) userEdited = true;
            };
            const originalDraft = () => failure("existing_draft", "ChatGPT has an unsent draft. Send or clear that draft before using the extension.");
            document.addEventListener("input", onInput, true);
            try {
                trace("received");
                editor = await waitFor(() => {
                    checkRoute();
                    return !find(STOP) && liveEditor();
                }, TIMEOUT.editor, signal, () => find(STOP)
                    ? failure("generation_in_progress", "ChatGPT is still generating. Wait for it to finish; nothing was sent.")
                    : failure("editor_not_found", "No writable ChatGPT composer was found; nothing was sent."));
                if (normalize(editorText(editor))) throw originalDraft();
                // Focus is attempted, but is NOT used as a hard readiness gate. An active
                // tab does not guarantee page focus while the extension panel is focused.
                editor.focus({ preventScroll: true });
                await pause(60, signal); // allow focus-driven editor hydration/replacement
                checkRoute();
                editor = liveEditor();
                if (!editor) throw failure("editor_replaced", "ChatGPT replaced its composer before insertion; nothing was sent.");
                if (normalize(editorText(editor))) throw originalDraft();
                trace("editor_ready");
                stage = "insertion";
                if (/^(TEXTAREA|INPUT)$/.test(editor.tagName)) {
                    method = "native_setter";
                    const proto = editor.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
                    if (!setter) throw failure("insertion_not_accepted", "The native input setter is unavailable; nothing was sent.");
                    inserting = true;
                    try {
                        setter.call(editor, text);
                        editor.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
                        editor.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
                    } finally { inserting = false; }
                    trace("native_setter_attempted");
                } else {
                    method = "paste_event";
                    selectEmptyEditor(editor);
                    // Supply the prepared string to the editor's paste handler. A synthetic
                    // paste has NO browser default insertion; we verify the handler's result.
                    // This does not read or write the operating-system clipboard.
                    inserting = true;
                    try {
                        const transfer = new DataTransfer(); transfer.setData("text/plain", text);
                        const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true, composed: true });
                        editor.dispatchEvent(event);
                        pasteHandled = event.defaultPrevented;
                    } catch { /* No supported paste handler: native insertion below. */ }
                    finally { inserting = false; }
                    await pause(120, signal);
                    checkRoute();
                    let live = liveEditor();
                    trace("paste_attempted");
                    if (!pasteHandled && live && !normalize(editorText(live))) {
                        method = "native_insert";
                        selectEmptyEditor(live);
                        // Focus handlers may replace the node again. Reacquire before editing.
                        if (live !== findEditor()) {
                            live = liveEditor();
                            if (!live || normalize(editorText(live))) throw originalDraft();
                            selectEmptyEditor(live);
                        }
                        const beforeEvents = inputEvents;
                        inserting = true;
                        try {
                            try { nativeReturned = document.execCommand("insertText", false, text); } catch { nativeReturned = false; }
                            // Native insertion often emits input itself. Do not emit a second
                            // insertion event; and NEVER clear/rebuild a controlled editor's DOM.
                            if (inputEvents === beforeEvents && normalize(editorText(live)) === expected) {
                                live.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true,
                                    inputType: "insertText", data: text }));
                            }
                        } finally { inserting = false; }
                        trace("native_insert_attempted");
                    }
                }
                let stableSince = null, stableEditor = null;
                editor = await waitFor(() => {
                    checkRoute();
                    const live = liveEditor();
                    if (!live || normalize(editorText(live)) !== expected) { stableSince = null; stableEditor = null; return null; }
                    if (live !== stableEditor || stableSince === null) { stableSince = Date.now(); stableEditor = live; }
                    // Reject a transient DOM-only match that the framework immediately reverts.
                    return Date.now() - stableSince >= 160 ? live : null;
                }, TIMEOUT.insert, signal, () => failure("insertion_not_accepted",
                    "ChatGPT did not retain the prepared prompt. Nothing was sent; the copied text can be pasted manually."));
                trace("insertion_verified");
                stage = "send_button";
                const button = await waitFor(() => {
                    checkRoute();
                    const live = liveEditor();
                    if (!live) return null;
                    if (normalize(editorText(live)) !== expected) throw failure("prompt_changed",
                        "ChatGPT changed or cleared the prompt before submission; nothing was sent.");
                    const candidate = findSend(live);
                    return enabled(candidate) && !find(STOP) ? candidate : null;
                }, TIMEOUT.send, signal, () => failure("send_button_not_ready",
                    "The prompt is in the composer, but ChatGPT did not enable its Send button. Nothing was sent."));
                trace("send_ready");
                checkRoute();
                const live = liveEditor();
                if (!live || normalize(editorText(live)) !== expected || !enabled(button) || !button.isConnected || find(STOP)) {
                    throw failure("prompt_changed", "The composer changed before submission; nothing was sent.");
                }
                // Crossing the click boundary is the external side effect. Do not keep the request
                // alive waiting for ChatGPT's conversation DOM: a successful send can immediately
                // clear/replace the composer or navigate from / to /c/..., which invalidated v2.1.4.
                // We already verified the exact prompt and an enabled, form-local Send control.
                clicked = true;
                stage = "submission";
                // Capture diagnostics BEFORE the external click. Do not inspect ChatGPT's DOM
                // after submission, because the click is allowed to clear/replace/navigate it.
                const submittedDiagnostics = trace("submitted");
                button.click();
                stage = "complete";
                return { status: "Content sent", diagnostics: submittedDiagnostics };
            } catch (error) {
                error.uncertain = clicked;
                error.code ||= signal.aborted ? "cancelled" : "adapter_error";
                error.stage = stage;
                error.diagnostics = trace(error.code);
                throw error;
            } finally {
                document.removeEventListener("input", onInput, true);
                this.busy = false;
            }
        }
    }
    window.__techIntChatAdapterV2 = Object.freeze({ ChatGPTAdapter, waitFor, version: VERSION,
        getDiagnostics: () => history.map(entry => ({ ...entry })) });
})();
