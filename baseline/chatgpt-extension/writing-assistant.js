/**
 * AI Writing Assistant - Contextual floating dot on the active writing field, panel with Generate, Insert/Replace.
 * Uses same ChatGPT API flow as Google Search (user's ChatGPT account).
 */
(function () {
    'use strict';

    const WA_ATTR = 'data-wa-attached';
    const DOT_SIZE = 12;
    const INPUT_RIGHT_PADDING = 48;
    const ACTIVE_DOT_HIDE_DELAY_MS = 220;
    const ACTIVE_DOT_RETRY_DELAYS_MS = [0, 80, 220];
    // Shared feature logo; toolbar/store icons use their existing manifest assets.
    const FEATURE_LOGO_URL = chrome.runtime.getURL('images/sideai-feature.png');
    const WA_STORAGE_KEY = 'writingAssistantSettings';
    const WA_DISABLED_SITES_KEY = 'writingAssistantDisabledSites';
    const WA_DISABLED_ALL_KEY = 'writingAssistantDisabledAll';
    const PAYMENT_HOST_PATTERNS = ['stripe', 'paypal', 'checkout', 'braintree', 'adyen', 'squareup', 'square.com', 'worldpay', 'klarna', 'afterpay', 'affirm'];

    function isPaymentPage() {
        const h = (location.hostname || '').toLowerCase();
        return PAYMENT_HOST_PATTERNS.some((term) => h.includes(term));
    }
    const GUIDE_SHOWN_KEY = 'guideShown';
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || navigator.userAgent.includes('Mac OS X');
    const SIDEAI_SHORTCUTS_KEY = 'sideaiShortcuts';
    const DEFAULT_SHORTCUT_SETTINGS = {
        textMenuKey: 'j',
        writingAssistantKey: 'j'
    };
    let textMenuShortcutKey = DEFAULT_SHORTCUT_SETTINGS.textMenuKey;
    let writingShortcutKey = DEFAULT_SHORTCUT_SETTINGS.writingAssistantKey;

    function normalizeShortcutKey(value, fallback = DEFAULT_SHORTCUT_SETTINGS.textMenuKey) {
        const normalized = String(value || '').trim().toLowerCase();
        return /^[a-z0-9]$/.test(normalized) ? normalized : fallback;
    }

    function matchesShortcutEvent(e, key) {
        return !!(
            (e.ctrlKey || e.metaKey) &&
            !e.altKey &&
            !e.shiftKey &&
            String(e.key || '').toLowerCase() === normalizeShortcutKey(key)
        );
    }

    function normalizeShortcutSettings(raw) {
        const legacyKey = raw?.askAiKey;
        return {
            textMenuKey: normalizeShortcutKey(raw?.textMenuKey ?? legacyKey, DEFAULT_SHORTCUT_SETTINGS.textMenuKey),
            writingAssistantKey: normalizeShortcutKey(raw?.writingAssistantKey ?? legacyKey, DEFAULT_SHORTCUT_SETTINGS.writingAssistantKey)
        };
    }

    async function readShortcutSettingsFromStorage() {
        try {
            const result = await chrome.storage.sync.get([SIDEAI_SHORTCUTS_KEY]);
            return normalizeShortcutSettings(result?.[SIDEAI_SHORTCUTS_KEY]);
        } catch (_) {
            return { ...DEFAULT_SHORTCUT_SETTINGS };
        }
    }

    function getWaShortcutLabel() {
        return SideAIShortcuts.format(SideAIShortcuts.get('writingAssistant'));
    }

    function refreshActiveDotShortcutLabel() {
        const brainBtn = activeDotInstance?.zone?.querySelector?.('.aiext-wa-pill-brain');
        if (brainBtn) {
            brainBtn.setAttribute('data-tooltip', `Writing Assistant (${getWaShortcutLabel()})`);
        }
    }

    function debugLog(runId, hypothesisId, location, message, data) {
    }

    function debugTail(text, size = 180) {
        if (typeof text !== 'string') return '';
        return text.slice(Math.max(0, text.length - size));
    }

    const waDebugLengths = {};
    function logWaProgress(requestId, message, data) {
        const textLength = typeof data?.text === 'string' ? data.text.length : (typeof data?.textLength === 'number' ? data.textLength : 0);
        const key = (requestId || 'no-id') + ':' + message;
        const previousLength = waDebugLengths[key] || 0;
        const shouldLog =
            data?.done ||
            data?.error ||
            textLength < 500 ||
            textLength - previousLength >= 750;
        if (!shouldLog) return;
        waDebugLengths[key] = textLength;
        debugLog(requestId || 'no-id', 'STREAM', 'writing-assistant.js', message, data);
    }

    function getPromptEl(panelEl) {
        const iframe = panelEl && panelEl.querySelector('#aiext-wa-prompt-iframe');
        return iframe && iframe.contentDocument ? iframe.contentDocument.getElementById('aiext-wa-prompt') : null;
    }
    function getPromptValue(panelEl) {
        const el = getPromptEl(panelEl);
        return el ? el.value : '';
    }
    function setPromptValue(panelEl, val) {
        const el = getPromptEl(panelEl);
        if (el) el.value = val;
    }
    function focusPrompt(panelEl) {
        const el = getPromptEl(panelEl);
        if (el) el.focus();
    }

    function hasSelectedTextInWritingField(el) {
        if (!el) return false;

        if (
            typeof el.selectionStart === 'number' &&
            typeof el.selectionEnd === 'number' &&
            el.selectionEnd > el.selectionStart
        ) {
            return !!String(el.value || '')
                .substring(el.selectionStart, el.selectionEnd)
                .trim();
        }

        if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || !selection.toString().trim()) return false;

            const isInsideField = (node) => {
                if (!node) return false;
                const elementNode = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
                return elementNode === el || el.contains(elementNode);
            };

            return isInsideField(selection.anchorNode) || isInsideField(selection.focusNode);
        }

        return false;
    }

    function isExtensionContextValid() {
        try { return !!chrome.runtime?.id; } catch (_) { return false; }
    }

    function shouldShowGuide() {
        return new Promise((resolve) => {
            if (!isExtensionContextValid()) { resolve(false); return; }
            try {
                chrome.storage.local.get([GUIDE_SHOWN_KEY], (result) => {
                    try { resolve(!result[GUIDE_SHOWN_KEY]); } catch (_) { resolve(false); }
                });
            } catch (_) { resolve(false); }
        });
    }

    function showGuideModalWritingAssistant() {
        const existingHost = document.getElementById('aiext-wa-guide-modal-host');
        if (existingHost) existingHost.remove();

        const host = document.createElement('div');
        host.id = 'aiext-wa-guide-modal-host';
        host.style.cssText = [
            'all:initial!important',
            'position:fixed!important',
            'inset:0!important',
            'z-index:2147483647!important',
            'pointer-events:auto!important'
        ].join(';');

        const shadow = host.attachShadow({ mode: 'closed' });
        const componentName = 'Writing Assistant';
        shadow.innerHTML = `
            <style>
                .aiext-wa-guide-modal,
                .aiext-wa-guide-modal * {
                    all: unset;
                    box-sizing: border-box;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
                }
                .aiext-wa-guide-modal {
                    position: fixed;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 18px;
                    background: rgba(15, 23, 42, 0.62);
                    backdrop-filter: blur(4px);
                    color: #0f172a;
                    direction: ltr;
                }
                .aiext-wa-guide-modal-content {
                    position: relative;
                    display: grid;
                    grid-template-rows: auto 1fr auto;
                    width: min(680px, calc(100vw - 32px));
                    max-height: min(720px, calc(100vh - 32px));
                    overflow: hidden;
                    border-radius: 22px;
                    background: #ffffff;
                    border: 1px solid rgba(148, 163, 184, 0.22);
                    box-shadow: 0 26px 80px rgba(15, 23, 42, 0.32);
                    animation: aiextWaGuideIn 160ms ease-out;
                }
                .aiext-wa-guide-close {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    display: grid;
                    place-items: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 999px;
                    background: rgba(255, 255, 255, 0.72);
                    color: #6b7280;
                    cursor: pointer;
                    font-size: 20px;
                    line-height: 1;
                    z-index: 2;
                }
                .aiext-wa-guide-close:hover { background: rgba(255, 255, 255, 0.92); color: #475569; }
                .aiext-wa-guide-modal-header {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                    padding: 22px 56px 22px 24px;
                    color: #0f172a;
                    background:
                        radial-gradient(circle at 88% 20%, rgba(255, 255, 255, 0.58), transparent 30%),
                        linear-gradient(135deg, #f7fbf6 0%, #effbee 55%, #eefbf5 100%);
                }
                .aiext-wa-guide-icon {
                    display: grid;
                    place-items: center;
                    flex: 0 0 auto;
                    width: 42px;
                    height: 42px;
                    border-radius: 14px;
                    background: #d8f7df;
                    color: #0f9f6e;
                    font-size: 20px;
                    font-weight: 800;
                }
                .aiext-wa-guide-eyebrow {
                    display: block;
                    margin-bottom: 3px;
                    color: #111827;
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    text-transform: uppercase;
                }
                .aiext-wa-guide-modal-header h2 {
                    display: block;
                    margin: 0;
                    color: #000000;
                    font-size: 22px;
                    line-height: 1.14;
                    font-weight: 800;
                    letter-spacing: -0.02em;
                }
                .aiext-wa-guide-modal-header p {
                    display: block;
                    margin-top: 6px;
                    color: #1f2937;
                    font-size: 13px;
                    line-height: 1.35;
                }
                .aiext-wa-guide-modal-body {
                    display: grid;
                    gap: 14px;
                    padding: 18px;
                    overflow: hidden;
                }
                .aiext-wa-guide-steps {
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                    gap: 12px;
                }
                .aiext-wa-guide-step {
                    display: grid;
                    grid-template-columns: 28px 1fr;
                    gap: 10px;
                    min-height: 94px;
                    padding: 14px;
                    border-radius: 16px;
                    background: #f8fafc;
                    border: 1px solid #d8e2ec;
                }
                .aiext-wa-guide-step-number {
                    display: grid;
                    place-items: center;
                    width: 28px;
                    height: 28px;
                    border-radius: 10px;
                    background: #d8f7df;
                    color: #0f9f6e;
                    font-size: 13px;
                    font-weight: 800;
                }
                .aiext-wa-guide-step-content h4 {
                    display: block;
                    margin: 1px 0 6px;
                    color: #0f172a;
                    font-size: 14px;
                    line-height: 1.25;
                    font-weight: 800;
                }
                .aiext-wa-guide-step-content p {
                    display: block;
                    color: #475569;
                    font-size: 12.5px;
                    line-height: 1.38;
                }
                .aiext-wa-guide-note {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 12px 14px;
                    border-radius: 14px;
                    background: #eef8f1;
                    border: 1px solid #d7efe0;
                    color: #1f2937;
                }
                .aiext-wa-guide-note-icon {
                    display: grid;
                    place-items: center;
                    width: 22px;
                    height: 22px;
                    flex: 0 0 auto;
                    border-radius: 999px;
                    background: #d8f7df;
                    color: #0f9f6e;
                    font-size: 13px;
                    font-weight: 900;
                }
                .aiext-wa-guide-note-content h5 {
                    display: block;
                    margin: 0 0 2px;
                    color: #0f172a;
                    font-size: 13px;
                    font-weight: 800;
                }
                .aiext-wa-guide-note-content p {
                    display: block;
                    color: #334155;
                    font-size: 12px;
                    line-height: 1.35;
                }
                .aiext-wa-guide-modal-actions {
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    padding: 14px 18px;
                    background: #f8fafc;
                    border-top: 1px solid #e2e8f0;
                }
                .aiext-wa-guide-btn {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 38px;
                    padding: 0 16px;
                    border-radius: 999px;
                    font-size: 13px;
                    font-weight: 800;
                    line-height: 1;
                    cursor: pointer;
                    user-select: none;
                }
                .aiext-wa-guide-btn-primary {
                    background: #0ea572;
                    color: #ffffff;
                    box-shadow: 0 10px 20px rgba(14, 165, 114, 0.22);
                }
                .aiext-wa-guide-btn-primary:hover { background: #0c8a60; }
                .aiext-wa-guide-btn-secondary {
                    background: #ffffff;
                    color: #334155;
                    border: 1px solid #cbd5e1;
                }
                .aiext-wa-guide-btn-secondary:hover { background: #f1f5f9; }
                @media (max-width: 620px), (max-height: 620px) {
                    .aiext-wa-guide-modal { padding: 10px; align-items: flex-start; }
                    .aiext-wa-guide-modal-content {
                        width: calc(100vw - 20px);
                        max-height: calc(100vh - 20px);
                    }
                    .aiext-wa-guide-modal-header { padding: 18px 50px 18px 18px; }
                    .aiext-wa-guide-modal-header h2 { font-size: 19px; }
                    .aiext-wa-guide-modal-header p { display: none; }
                    .aiext-wa-guide-modal-body { padding: 12px; overflow: auto; }
                    .aiext-wa-guide-steps { grid-template-columns: 1fr; gap: 8px; }
                    .aiext-wa-guide-step { min-height: 0; padding: 10px; }
                    .aiext-wa-guide-note { padding: 10px; }
                    .aiext-wa-guide-modal-actions { padding: 10px 12px; }
                }
                @keyframes aiextWaGuideIn {
                    from { opacity: 0; transform: translateY(8px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            </style>
            <div class="aiext-wa-guide-modal" role="dialog" aria-modal="true" aria-label="Re-enable ${componentName}">
            <div class="aiext-wa-guide-modal-content">
                <button class="aiext-wa-guide-close" data-action="close" aria-label="Close">x</button>
                <div class="aiext-wa-guide-modal-header">
                    <div class="aiext-wa-guide-icon">?</div>
                    <div>
                        <span class="aiext-wa-guide-eyebrow">Disabled on this site</span>
                        <h2>Re-enable ${componentName}</h2>
                        <p>Open SideAI options and unblock this website when you want this feature back.</p>
                    </div>
                </div>
                <div class="aiext-wa-guide-modal-body">
                    <div class="aiext-wa-guide-steps">
                        <div class="aiext-wa-guide-step">
                            <div class="aiext-wa-guide-step-number">1</div>
                            <div class="aiext-wa-guide-step-content">
                                <h4>Open the extension menu</h4>
                                <p>Right-click the SideAI icon in your browser toolbar.</p>
                            </div>
                        </div>
                        <div class="aiext-wa-guide-step">
                            <div class="aiext-wa-guide-step-number">2</div>
                            <div class="aiext-wa-guide-step-content">
                                <h4>Choose Options</h4>
                                <p>Select "Options" from Chrome's extension menu.</p>
                            </div>
                        </div>
                        <div class="aiext-wa-guide-step">
                            <div class="aiext-wa-guide-step-number">3</div>
                            <div class="aiext-wa-guide-step-content">
                                <h4>Open Disabled Sites</h4>
                                <p>Go to the "Disabled Sites" tab in SideAI settings.</p>
                            </div>
                        </div>
                        <div class="aiext-wa-guide-step">
                            <div class="aiext-wa-guide-step-number">4</div>
                            <div class="aiext-wa-guide-step-content">
                                <h4>Unblock ${componentName}</h4>
                                <p>Find this website and click unblock to enable it again.</p>
                            </div>
                        </div>
                    </div>
                    <div class="aiext-wa-guide-note">
                        <div class="aiext-wa-guide-note-icon">i</div>
                        <div class="aiext-wa-guide-note-content">
                            <h5>Quick Tip</h5>
                            <p>The fastest path is the button below. It opens the same Options page directly.</p>
                        </div>
                    </div>
                </div>
                <div class="aiext-wa-guide-modal-actions">
                    <button class="aiext-wa-guide-btn aiext-wa-guide-btn-secondary" data-action="close">Got it</button>
                    <button class="aiext-wa-guide-btn aiext-wa-guide-btn-primary" data-action="open-options">Open Options</button>
                </div>
            </div>
            </div>
        `;
        document.documentElement.appendChild(host);
        shadow.querySelectorAll('[data-action]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const action = e.currentTarget.dataset.action;
                if (action === 'close') host.remove();
                else if (action === 'open-options') {
                    try {
                        if (isExtensionContextValid()) chrome.runtime.sendMessage({ type: 'openOptions' }, () => { host.remove(); });
                        else host.remove();
                    } catch (_) { host.remove(); }
                }
            });
        });
        const modal = shadow.querySelector('.aiext-wa-guide-modal');
        modal.addEventListener('click', (e) => { if (e.target === modal) host.remove(); });
        try { if (isExtensionContextValid()) chrome.storage.local.set({ [GUIDE_SHOWN_KEY]: true }, () => {}); } catch (_) {}
    }

    function getSavedSettings() {
        return new Promise((resolve) => {
            const def = { language: 'auto', length: 'auto', formality: 'auto', tone: 'auto', format: 'auto' };
            if (!isExtensionContextValid()) { resolve(def); return; }
            try {
                chrome.storage.sync.get([WA_STORAGE_KEY], (result) => {
                    try {
                        const s = result?.[WA_STORAGE_KEY] || {};
                        resolve({ language: s.language || 'auto', length: s.length || 'auto', formality: s.formality || 'auto', tone: s.tone || 'auto', format: s.format || 'auto' });
                    } catch (_) { resolve(def); }
                });
            } catch (_) { resolve(def); }
        });
    }

    function saveSettings(settings) {
        try { if (isExtensionContextValid()) chrome.storage.sync.set({ [WA_STORAGE_KEY]: settings }, () => {}); } catch (_) {}
    }

    function applySavedSettingsToPanel(panelEl, saved) {
        if (!panelEl || !saved) return;
        const langEl = panelEl.querySelector('#aiext-wa-language');
        if (langEl && saved.language) langEl.value = saved.language;
        const ensureHidden = (id, value) => {
            let el = panelEl.querySelector('#' + id);
            if (!el) {
                el = document.createElement('input');
                el.type = 'hidden';
                el.id = id;
                panelEl.querySelector('.aiext-wa-panel-body').appendChild(el);
            }
            el.value = value || 'auto';
        };
        ensureHidden('aiext-wa-length', saved.length);
        ensureHidden('aiext-wa-formality', saved.formality);
        ensureHidden('aiext-wa-tone', saved.tone);
        ensureHidden('aiext-wa-format', saved.format);
    }

    const LANGUAGES = [
        { value: 'auto', label: 'Auto', sub: 'Let AI choose' },
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' },
        { value: 'it', label: 'Italian' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'ru', label: 'Russian' },
        { value: 'ja', label: 'Japanese' },
        { value: 'ko', label: 'Korean' },
        { value: 'zh', label: 'Chinese' },
        { value: 'ar', label: 'Arabic' },
        { value: 'hi', label: 'Hindi' },
        { value: 'nl', label: 'Dutch' },
        { value: 'pl', label: 'Polish' },
        { value: 'tr', label: 'Turkish' },
        { value: 'id', label: 'Indonesian' },
        { value: 'th', label: 'Thai' },
        { value: 'vi', label: 'Vietnamese' },
    ];

    const LENGTH_OPTIONS = [
        { value: 'auto', label: 'Auto' },
        { value: 'short', label: 'Short' },
        { value: 'medium', label: 'Medium' },
        { value: 'long', label: 'Long' },
    ];

    const FORMALITY_OPTIONS = [
        { value: 'auto', label: 'Auto' },
        { value: 'formal', label: 'Formal' },
        { value: 'neutral', label: 'Neutral' },
        { value: 'casual', label: 'Casual' },
    ];

    const TONE_OPTIONS = [
        { value: 'auto', label: 'Auto' },
        { value: 'professional', label: 'Professional' },
        { value: 'friendly', label: 'Friendly' },
        { value: 'humble', label: 'Humble' },
        { value: 'enthusiastic', label: 'Enthusiastic' },
        { value: 'sincere', label: 'Sincere' },
        { value: 'humorous', label: 'Humorous' },
        { value: 'empathetic', label: 'Empathetic' },
        { value: 'concise', label: 'Concise' },
    ];

    const FORMAT_OPTIONS = [
        { value: 'auto', label: 'Auto' },
        { value: 'article', label: 'Article' },
        { value: 'paragraph', label: 'Paragraph' },
        { value: 'comment', label: 'Comment' },
        { value: 'message', label: 'Message' },
        { value: 'email', label: 'Email' },
        { value: 'facebook', label: 'Facebook' },
        { value: 'reddit', label: 'Reddit' },
        { value: 'twitter', label: 'Twitter' },
        { value: 'outline', label: 'Outline' },
        { value: 'ideas', label: 'Ideas' },
        { value: 'blog post', label: 'Blog Post' },
        { value: 'linkedin', label: 'LinkedIn' },
    ];

    // Detailed descriptions so the model understands exactly what each setting means
    const LENGTH_DESC = {
        short: 'Keep the output brief and concise—typically 1–3 sentences or a short paragraph. Be direct and avoid unnecessary elaboration.',
        medium: 'Use a moderate length—typically 2–4 paragraphs or equivalent. Balance detail with concision.',
        long: 'Provide a thorough, detailed response. Use multiple paragraphs as needed to fully develop the content.',
    };
    const FORMALITY_DESC = {
        formal: 'Use formal language appropriate for business, academic, or official contexts. Avoid contractions (e.g. use "do not" not "don\'t"), slang, and casual expressions. Use proper salutations and closings where relevant.',
        neutral: 'Use neutral, balanced language—neither overly formal nor casual. Suitable for general professional communication.',
        casual: 'Use a relaxed, conversational style. Contractions and informal expressions are fine. Friendly and approachable.',
    };
    const TONE_DESC = {
        professional: 'Maintain a professional, authoritative demeanor—clear, confident, and respectful. Suitable for business or formal correspondence.',
        friendly: 'Be warm, approachable, and personable. Convey goodwill and openness.',
        humble: 'Be modest and unassuming. Acknowledge limitations and avoid sounding boastful.',
        enthusiastic: 'Show energy, excitement, and positive engagement. Be encouraging and upbeat.',
        sincere: 'Be genuine, honest, and heartfelt. Convey authenticity and trustworthiness.',
        humorous: 'Use appropriate wit, light humor, or playful tone where fitting—without being inappropriate.',
        empathetic: 'Show understanding, compassion, and emotional awareness. Acknowledge the reader\'s perspective.',
        concise: 'Be direct and to the point. Use minimal words to convey the message clearly.',
    };
    const FORMAT_DESC = {
        article: 'Structure as an article: clear title/opening, well-organized body with logical flow, and a conclusion. Use paragraphs for readability.',
        paragraph: 'Output as one or more coherent paragraphs. No headers or bullet points—flowing prose only.',
        comment: 'Format as a comment or reply: conversational, focused, and typically shorter. Can include direct address.',
        message: 'Format as a direct message or chat: concise, personal, and easy to read. No formal letter structure needed.',
        email: 'Structure as an email: include an appropriate greeting (e.g. Dear X, Hello), clear body paragraphs, and a professional closing (e.g. Best regards, Sincerely, Kind regards).',
        facebook: 'Style suitable for Facebook: conversational, engaging, and shareable. Can use line breaks for readability. Avoid overly formal language.',
        reddit: 'Style suitable for Reddit: conversational, on-topic, and community-appropriate. Can use casual tone and direct address.',
        twitter: 'Keep it concise and punchy. Twitter-style: short, impactful, within character limits. Use clear, memorable phrasing.',
        outline: 'Output as a structured outline: use headings, bullet points, or numbered items. Hierarchical and scannable.',
        ideas: 'Present as a list of ideas, points, or suggestions. Use bullets or numbers. Clear and scannable.',
        'blog post': 'Structure as a blog post: engaging intro, well-organized sections, and a conclusion. Conversational yet informative. Use paragraphs and optional subheadings.',
        linkedin: 'Professional LinkedIn style: polished, business-appropriate, and engaging. Suitable for posts, messages, or profile content. Confident but not overly formal.',
    };

    const MIN_WRITING_WIDTH = 120;
    const MIN_WRITING_HEIGHT = 28;

    /* CSS for elements in page DOM (field-wrap, dot, pill) - injected into document.head */
    const AIEXT_WA_PAGE_CSS = `.aiext-wa-dot-zone{position:absolute!important;top:50%!important;right:10px!important;transform:translateY(-50%)!important;width:0!important;height:0!important;display:flex!important;align-items:center!important;justify-content:flex-end!important;z-index:2147483646!important;direction:ltr!important;overflow:visible!important}.aiext-wa-dot-zone .aiext-wa-dot{position:absolute!important;top:50%!important;right:0!important;left:auto!important;transform:translateY(-50%)!important}.aiext-wa-pill{position:absolute!important;top:50%!important;right:-6px!important;left:auto!important;transform:translateY(-50%)!important;display:none!important;flex-direction:row!important;align-items:center!important;gap:2px!important;padding:1px 0!important;background:#1e293b!important;border:1px solid rgba(148,163,184,0.2)!important;border-radius:10px!important;box-shadow:0 2px 12px rgba(0,0,0,0.25)!important;opacity:0!important;pointer-events:none!important;z-index:2147483647!important;transition:opacity 0.15s ease!important;direction:ltr!important;overflow:visible!important}.aiext-wa-pill.aiext-wa-visible{display:flex!important;opacity:1!important;pointer-events:auto!important}.aiext-wa-pill-brain{width:28px!important;height:28px!important;padding:0!important;margin:0!important;border:none!important;background:transparent!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0!important;border-radius:6px!important}.aiext-wa-pill-brain:hover{background:rgba(255,255,255,0.1)!important}.aiext-wa-pill-brain[data-tooltip]{position:relative!important}.aiext-wa-pill-brain[data-tooltip]::after{display:none!important}.aiext-wa-pill-brain>svg{width:15px!important;height:15px!important;display:block!important}.aiext-wa-pill-x{width:24px!important;height:24px!important;padding:0!important;margin:0!important;border:none!important;background:rgba(255,255,255,0.08)!important;color:#f1f5f9!important;font-size:16px!important;line-height:1!important;font-weight:600!important;cursor:pointer!important;display:flex!important;align-items:center!important;justify-content:center!important;flex-shrink:0!important;border-radius:6px!important}.aiext-wa-pill-x:hover{background:rgba(255,255,255,0.15)!important;color:#fff!important}.aiext-wa-pill-shortcut{font-size:11px!important;color:rgba(248,250,252,0.85)!important;margin-left:2px!important;padding:0 2px!important;pointer-events:none!important}.aiext-wa-dot{position:absolute!important;top:50%!important;right:10px!important;transform:translateY(-50%)!important;width:9px!important;height:9px!important;border-radius:50%!important;background:#10a37f!important;cursor:default!important;z-index:2147483646!important;transition:transform 0.2s ease,box-shadow 0.2s ease,background 0.2s ease!important;border:none!important;padding:0!important;margin:0!important;display:block!important}.aiext-wa-dot:hover{transform:translateY(-50%) scale(1.15)!important;box-shadow:0 0 0 3px rgba(16,163,127,0.35)!important;background:#0d8c6a!important}.aiext-wa-dot:focus{outline:none!important;box-shadow:0 0 0 2px rgba(16,163,127,0.5)!important}.aiext-wa-dot.aiext-wa-hidden{opacity:0!important;pointer-events:none!important}`;

const AIEXT_WA_PAGE_THEME_CSS = `
.aiext-wa-pill{background:#f7fffb!important;border-color:#cfe9dd!important;box-shadow:0 4px 16px rgba(15,60,42,.14)!important}
.aiext-wa-pill-brain{background:#e8f9f2!important}
.aiext-wa-pill-brain:hover{background:#d4f3e4!important}
.aiext-wa-pill-x{background:#ffffff!important;border:1px solid #dce9e3!important;color:#344054!important}
.aiext-wa-pill-x:hover{background:#e8f9f2!important;color:#078961!important}
.aiext-wa-pill-shortcut{color:#475467!important}
.aiext-wa-dot{background:#08a875!important}
.aiext-wa-dot:hover{background:#078961!important;box-shadow:0 0 0 3px rgba(8,168,117,.22)!important}
.aiext-wa-dot:focus{box-shadow:0 0 0 2px rgba(8,168,117,.45)!important}
`;

const AIEXT_WA_CSS = `/* AI Writing Assistant - Dot, Tooltip & Panel (extension theme green) */
:host,
:host * {
    box-sizing: border-box !important;
}

:host {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
    direction: ltr !important;
}

/* Zone: dot by default; on hover replaced by pill. Overflow visible so content isn't clipped. */
.aiext-wa-dot-zone {
    position: absolute !important;
    top: 50% !important;
    right: 10px !important;
    transform: translateY(-50%) !important;
    width: 0px !important;
    height: 0px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-end !important;
    z-index: 2147483646 !important;
    direction: ltr !important;
    overflow: visible !important;
}

.aiext-wa-dot-zone .aiext-wa-dot {
    position: absolute !important;
    top: 50% !important;
    right: 0 !important;
    left: auto !important;
    transform: translateY(-50%) !important;
}

/* Pill: dark bar, X left and Brain right. Overflow visible so tooltip isn't clipped. */
.aiext-wa-pill {
    position: absolute !important;
    top: 50% !important;
    right: -6px !important;
    left: auto !important;
    transform: translateY(-50%) !important;
    display: none !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 2px !important;
    padding: 1px 0 !important;
    background: #1e293b !important;
    border: 1px solid rgba(148, 163, 184, 0.2) !important;
    border-radius: 10px !important;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25) !important;
    opacity: 0 !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    transition: opacity 0.15s ease !important;
    direction: ltr !important;
    overflow: visible !important;
}

.aiext-wa-pill.aiext-wa-visible {
    display: flex !important;
    opacity: 1 !important;
    pointer-events: auto !important;
}

/* Brain first (left) – hover hits brain first */
.aiext-wa-pill-brain {
    width: 28px !important;
    height: 28px !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    background: transparent !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex-shrink: 0 !important;
    border-radius: 6px !important;
}

.aiext-wa-pill-brain:hover {
    background: rgba(255, 255, 255, 0.1) !important;
}

/* Brain button – tooltip is shown via .aiext-wa-global-tooltip in :host to avoid overflow clipping */
.aiext-wa-pill-brain[data-tooltip] {
    position: relative !important;
}

.aiext-wa-pill-brain[data-tooltip]::after {
    display: none !important;
}

/* Global tooltip (in #aiext-wa-root) – never clipped by input overflow */
.aiext-wa-global-tooltip {
    position: fixed !important;
    color: white !important;
    font-size: 12px !important;
    padding: 6px 10px !important;
    border-radius: 6px !important;
    background: rgba(0, 0, 0, 0.9) !important;
    white-space: nowrap !important;
    pointer-events: none !important;
    z-index: 2147483647 !important;
    box-shadow: rgba(0, 0, 0, 0.2) 0px 2px 8px !important;
    opacity: 0 !important;
    visibility: hidden !important;
    transition: opacity 0.2s, visibility 0.2s !important;
}

.aiext-wa-global-tooltip.aiext-wa-tooltip-visible {
    opacity: 1 !important;
    visibility: visible !important;
}

.aiext-wa-pill-brain > svg {
    width: 15px !important;
    height: 15px !important;
    display: block !important;
    /* filter: brightness(0) invert(1) !important; */
}

/* X in small rounded square (right of brain) */
.aiext-wa-pill-x {
    width: 24px !important;
    height: 24px !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    background: rgba(255, 255, 255, 0.08) !important;
    color: #f1f5f9 !important;
    font-size: 16px !important;
    line-height: 1 !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    flex-shrink: 0 !important;
    border-radius: 6px !important;
}

.aiext-wa-pill-x:hover {
    background: rgba(255, 255, 255, 0.15) !important;
    color: #fff !important;
}

/* Ctrl+J hint */
.aiext-wa-pill-shortcut {
    font-size: 11px !important;
    color: rgba(248, 250, 252, 0.85) !important;
    margin-left: 2px !important;
    padding: 0 2px !important;
    pointer-events: none !important;
}

.aiext-wa-dot {
    position: absolute !important;
    top: 50% !important;
    right: 10px !important;
    transform: translateY(-50%) !important;
    width: 9px !important;
    height: 9px !important;
    border-radius: 50% !important;
    background: #10a37f !important; /* extension theme green */
    cursor: default !important;
    z-index: 2147483646 !important;
    transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
    display: block !important;
}

.aiext-wa-dot:hover {
    transform: translateY(-50%) scale(1.15) !important;
    box-shadow: 0 0 0 3px rgba(16, 163, 127, 0.35) !important;
    background: #0d8c6a !important;
}

.aiext-wa-dot:focus {
    outline: none !important;
    box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.5) !important;
}

.aiext-wa-dot.aiext-wa-hidden {
    opacity: 0 !important;
    pointer-events: none !important;
}


/* Disable dropdown (X menu) */
.aiext-wa-disable-dropdown {
    position: absolute !important;
    top: 100% !important;
    right: 0 !important;
    margin-top: 4px !important;
    min-width: 160px !important;
    background: #1e293b !important;
    border: 1px solid rgba(148, 163, 184, 0.2) !important;
    border-radius: 8px !important;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3) !important;
    z-index: 2147483647 !important;
    display: none !important;
    flex-direction: column !important;
    overflow: hidden !important;
}

.aiext-wa-disable-dropdown.aiext-wa-dropdown-open {
    display: flex !important;
}

/* Portaled dropdown: position fixed, left/top set by JS from X button rect (so it appears below the pill) */
.aiext-wa-disable-dropdown-portaled {
    position: fixed !important;
    right: auto !important;
    margin: 0 !important;
}

.aiext-wa-disable-dropdown button {
    padding: 8px 12px !important;
    border: none !important;
    background: transparent !important;
    color: #e2e8f0 !important;
    font-size: 13px !important;
    text-align: left !important;
    cursor: pointer !important;
}

.aiext-wa-disable-dropdown button:hover {
    background: rgba(148, 163, 184, 0.15) !important;
}

/* Floating panel – matches ai-tm-writing-panel design */
.aiext-wa-panel {
    position: fixed !important;
    min-width: 320px !important;
    max-width: 420px !important;
    background: #1e1e1e !important;
    border: 1px solid #3a3a3a !important;
    border-radius: 12px !important;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
    z-index: 2147483647 !important;
    display: flex !important;
    flex-direction: column !important;
    overflow: hidden !important;
    animation: aiext-wa-panel-in 0.25s ease-out !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
    color: #e0e0e0 !important;
}

.aiext-wa-panel.aiext-wa-panel-hidden {
    display: none !important;
}

@keyframes aiext-wa-panel-in {
    from {
        opacity: 0;
        transform: scale(0.96) translateY(4px);
    }
    to {
        opacity: 1;
        transform: scale(1) translateY(0);
    }
}

.aiext-wa-panel-header {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: 10px 12px !important;
    border-bottom: 1px solid #3a3a3a !important;
    cursor: move !important;
    user-select: none !important;
}

.aiext-wa-panel-title {
    font-size: 13px !important;
    font-weight: 600 !important;
    color: #b0b0b0 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
}

.aiext-wa-panel-actions {
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
}

.aiext-wa-panel-btn-icon {
    width: 32px !important;
    height: 32px !important;
    border: none !important;
    background: transparent !important;
    color: #888 !important;
    cursor: pointer !important;
    border-radius: 8px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: background 0.15s, color 0.15s !important;
}

.aiext-wa-panel-btn-icon:hover {
    background: #2a2a2a !important;
    color: #e0e0e0 !important;
}

#aiext-wa-close {
    pointer-events: auto !important;
    cursor: pointer !important;
    position: relative !important;
    z-index: 1 !important;
}

.aiext-wa-panel-body {
    padding: 12px !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
}

.aiext-wa-panel-prompt {
    width: 100% !important;
    min-height: 80px !important;
    padding: 10px 12px !important;
    border-radius: 8px !important;
    border: 1px solid #3a3a3a !important;
    background: #2a2a2a !important;
    color: #e0e0e0 !important;
    font-size: 13px !important;
    font-family: inherit !important;
    resize: vertical !important;
    outline: none !important;
}

.aiext-wa-panel-prompt::placeholder {
    color: #888 !important;
}

.aiext-wa-panel-prompt:focus {
    border-color: #7c5cbf !important;
    box-shadow: 0 0 0 2px rgba(124, 92, 191, 0.2) !important;
}

.aiext-wa-panel-footer {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: wrap !important;
    gap: 8px !important;
    padding: 0 12px 12px !important;
}

.aiext-wa-generate-btn {
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 8px 16px !important;
    background: #7c5cbf !important;
    color: #fff !important;
    border: none !important;
    border-radius: 8px !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: background 0.2s, transform 0.15s !important;
}

.aiext-wa-generate-btn:hover:not(:disabled) {
    background: #6b4ca8 !important;
}

.aiext-wa-generate-btn:disabled {
    opacity: 0.6 !important;
    cursor: not-allowed !important;
}

.aiext-wa-settings-row {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    flex-wrap: wrap !important;
}

.aiext-wa-settings-select {
    padding: 6px 10px !important;
    border-radius: 6px !important;
    border: 1px solid #3a3a3a !important;
    background: #2a2a2a !important;
    color: #e0e0e0 !important;
    font-size: 12px !important;
    cursor: pointer !important;
    outline: none !important;
}

.aiext-wa-settings-select:focus {
    border-color: #7c5cbf !important;
}

/* Length & format trigger */
.aiext-wa-length-format-btn {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 4px 8px !important;
    background: #2a2a2a !important;
    border: 1px solid #3a3a3a !important;
    border-radius: 6px !important;
    color: #b0b0b0 !important;
    font-size: 11px !important;
    cursor: pointer !important;
}

.aiext-wa-length-format-btn:hover {
    background: #333 !important;
    color: #e0e0e0 !important;
}

/* Result area – matches ai-tm-writing-panel; Insert/Replace fixed at bottom */
.aiext-wa-result-area {
    padding: 12px !important;
    border-top: 1px solid #3a3a3a !important;
    display: flex !important;
    flex-direction: column !important;
    gap: 10px !important;
    overflow: hidden !important;
}

.aiext-wa-result-area.aiext-wa-hidden {
    display: none !important;
}

.aiext-wa-result-text {
    background: #2a2a2a !important;
    border: 1px solid #3a3a3a !important;
    border-radius: 8px !important;
    padding: 12px !important;
    font-size: 13px !important;
    line-height: 1.5 !important;
    color: #e0e0e0 !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    max-height: 200px !important;
    overflow-y: auto !important;
    flex-shrink: 1 !important;
}

.aiext-wa-result-text.aiext-wa-loading-state {
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 8px !important;
    color: #999 !important;
    min-height: 80px !important;
}

/* Custom dark scrollbar – shared by prompt, result-text, and dropdown */
.aiext-wa-panel-prompt,
.aiext-wa-result-text,
.aiext-wa-dropdown {
    scrollbar-width: thin !important;
    scrollbar-color: #5a5a5a #2a2a2a !important;
}

.aiext-wa-panel-prompt::-webkit-scrollbar,
.aiext-wa-result-text::-webkit-scrollbar,
.aiext-wa-dropdown::-webkit-scrollbar {
    width: 8px !important;
}

.aiext-wa-panel-prompt::-webkit-scrollbar-track,
.aiext-wa-result-text::-webkit-scrollbar-track,
.aiext-wa-dropdown::-webkit-scrollbar-track {
    background: #2a2a2a !important;
    border-radius: 4px !important;
}

.aiext-wa-panel-prompt::-webkit-scrollbar-thumb,
.aiext-wa-result-text::-webkit-scrollbar-thumb,
.aiext-wa-dropdown::-webkit-scrollbar-thumb {
    background: #5a5a5a !important;
    border-radius: 4px !important;
}

.aiext-wa-panel-prompt::-webkit-scrollbar-thumb:hover,
.aiext-wa-result-text::-webkit-scrollbar-thumb:hover,
.aiext-wa-dropdown::-webkit-scrollbar-thumb:hover {
    background: #6a6a6a !important;
}

.aiext-wa-panel-prompt::-webkit-scrollbar-corner,
.aiext-wa-result-text::-webkit-scrollbar-corner,
.aiext-wa-dropdown::-webkit-scrollbar-corner {
    background: transparent !important;
}

.aiext-wa-result-actions {
    display: flex !important;
    gap: 8px !important;
    flex-shrink: 0 !important;
}

.aiext-wa-insert-btn,
.aiext-wa-replace-btn {
    display: inline-flex !important;
    align-items: center !important;
    gap: 6px !important;
    padding: 6px 16px !important;
    border-radius: 6px !important;
    font-size: 12px !important;
    font-weight: 500 !important;
    cursor: pointer !important;
    transition: background 0.2s, color 0.2s !important;
}

.aiext-wa-insert-btn {
    border: 1px solid #7c5cbf !important;
    background: transparent !important;
    color: #b39ddb !important;
}

.aiext-wa-insert-btn:hover {
    background: rgba(124, 92, 191, 0.2) !important;
}

.aiext-wa-replace-btn {
    border: none !important;
    background: #7c5cbf !important;
    color: #fff !important;
}

.aiext-wa-replace-btn:hover {
    background: #6b4ca8 !important;
}

/* Dropdown / popover for Length & format – matches ai-tm-writing-panel */
.aiext-wa-dropdown {
    position: fixed !important;
    background: #2a2a2a !important;
    border: 1px solid #3a3a3a !important;
    border-radius: 8px !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
    padding: 10px !important;
    z-index: 2147483648 !important;
    width: 100% !important;
    max-width: 280px !important;
    max-height: min(60vh, 320px) !important;
    overflow-y: auto !important;
    box-sizing: border-box !important;
}

.aiext-wa-dropdown-section {
    margin-bottom: 8px !important;
}

.aiext-wa-dropdown-section:last-child {
    margin-bottom: 0 !important;
}

.aiext-wa-dropdown-label {
    font-size: 10px !important;
    font-weight: 600 !important;
    color: #888 !important;
    margin-bottom: 4px !important;
    display: block !important;
}

.aiext-wa-dropdown-options {
    display: flex !important;
    flex-wrap: wrap !important;
    gap: 4px !important;
}

.aiext-wa-dropdown-option {
    padding: 4px 8px !important;
    border-radius: 4px !important;
    border: 1px solid #3a3a3a !important;
    background: #333 !important;
    color: #b0b0b0 !important;
    font-size: 11px !important;
    cursor: pointer !important;
    white-space: nowrap !important;
}

.aiext-wa-dropdown-option:hover {
    background: #404040 !important;
}

.aiext-wa-dropdown-option.aiext-wa-active {
    background: #7c5cbf !important;
    border-color: #7c5cbf !important;
    color: #fff !important;
}

/* Loading state - hidden by default; show only when generating */
.aiext-wa-spinner {
    width: 16px !important;
    height: 16px !important;
    border: 2px solid #555 !important;
    border-top-color: #7c5cbf !important;
    border-radius: 50% !important;
    animation: aiext-wa-spin 0.7s linear infinite !important;
}

@keyframes aiext-wa-spin {
    to { transform: rotate(360deg); }
}

.aiext-wa-error {
    color: #f87171 !important;
    font-size: 12px !important;
    padding: 8px 0 !important;
}

.aiext-wa-upgrade-btn {
    margin-left: 6px !important;
    padding: 4px 10px !important;
    font-size: 12px !important;
    background: #10b981 !important;
    color: white !important;
    border: none !important;
    border-radius: 6px !important;
    cursor: pointer !important;
    font-weight: 600 !important;
}

.aiext-wa-upgrade-btn:hover {
    background: #059669 !important;
}

/* Guide modal (first-time disable) – same as content-menu, shared guideShown key */
.aiext-wa-guide-modal {
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    width: 100% !important;
    height: 100% !important;
    background: rgba(0, 0, 0, 0.9) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
}

.aiext-wa-guide-modal-content {
    background: white !important;
    border-radius: 16px !important;
    padding: 0 !important;
    max-width: 520px !important;
    width: 90% !important;
    max-height: 85vh !important;
    overflow-y: auto !important;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25) !important;
    animation: aiextWaGuideSlideIn 0.3s ease-out !important;
    display: flex !important;
    flex-direction: column !important;
}

@keyframes aiextWaGuideSlideIn {
    from { opacity: 0; transform: scale(0.9) translateY(-20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
}

.aiext-wa-guide-modal-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    color: white !important;
    padding: 20px !important;
    text-align: center !important;
    position: relative !important;
    flex-shrink: 0 !important;
}

.aiext-wa-guide-modal-header h2 {
    margin: 0 !important;
    font-size: 20px !important;
    font-weight: 700 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 10px !important;
}

.aiext-wa-guide-modal-header .aiext-wa-guide-icon {
    width: 28px !important;
    height: 28px !important;
    background: rgba(255, 255, 255, 0.2) !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-size: 14px !important;
}

.aiext-wa-guide-modal-body {
    padding: 20px !important;
    flex: 1 !important;
    overflow-y: auto !important;
}

.aiext-wa-guide-step {
    display: flex !important;
    align-items: flex-start !important;
    gap: 12px !important;
    margin-bottom: 16px !important;
    padding: 12px !important;
    background: #f8f9fa !important;
    border-radius: 8px !important;
    border-left: 3px solid #667eea !important;
}

.aiext-wa-guide-step:last-child { margin-bottom: 0 !important; }

.aiext-wa-guide-step-number {
    background: #667eea !important;
    color: white !important;
    width: 24px !important;
    height: 24px !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    font-weight: 700 !important;
    font-size: 12px !important;
    flex-shrink: 0 !important;
    margin-top: 1px !important;
}

.aiext-wa-guide-step-content h4 {
    margin: 0 0 6px 0 !important;
    color: #333 !important;
    font-size: 15px !important;
    font-weight: 600 !important;
}

.aiext-wa-guide-step-content p {
    margin: 0 !important;
    color: #666 !important;
    font-size: 13px !important;
    line-height: 1.4 !important;
}

.aiext-wa-guide-modal-actions {
    padding: 16px 20px !important;
    background: #f8f9fa !important;
    display: flex !important;
    justify-content: center !important;
    gap: 12px !important;
    flex-shrink: 0 !important;
    border-top: 1px solid #e1e5ea !important;
}

.aiext-wa-guide-btn {
    padding: 10px 20px !important;
    border: none !important;
    border-radius: 6px !important;
    font-size: 13px !important;
    font-weight: 600 !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
}

.aiext-wa-guide-btn-primary {
    background: #667eea !important;
    color: white !important;
}

.aiext-wa-guide-btn-primary:hover {
    background: #5a6fd8 !important;
    transform: translateY(-1px) !important;
}

.aiext-wa-guide-btn-secondary {
    background: white !important;
    color: #667eea !important;
    border: 2px solid #667eea !important;
}

.aiext-wa-guide-btn-secondary:hover {
    background: #f8f9fa !important;
}

.aiext-wa-guide-note {
    background: #e3f2fd !important;
    border: 1px solid #bbdefb !important;
    border-radius: 6px !important;
    padding: 12px !important;
    margin-top: 16px !important;
    display: flex !important;
    align-items: flex-start !important;
    gap: 10px !important;
}

.aiext-wa-guide-note-icon { color: #1976d2 !important; font-size: 16px !important; margin-top: 1px !important; }
.aiext-wa-guide-note-content { flex: 1 !important; }
.aiext-wa-guide-note-content h5 { margin: 0 0 3px 0 !important; color: #1976d2 !important; font-size: 13px !important; font-weight: 600 !important; }
.aiext-wa-guide-note-content p { margin: 0 !important; color: #1976d2 !important; font-size: 12px !important; line-height: 1.3 !important; }
 .aiext-wa-section-label{display:block;color:#667085;font-size:12px;margin-bottom:7px}.aiext-wa-response-heading{display:flex;justify-content:space-between;align-items:center}.aiext-wa-response-heading button{border:0;background:transparent;color:#067d5b;cursor:pointer;font:inherit}.aiext-wa-insert-btn{background:#fff!important}.aiext-wa-panel{width:min(390px,calc(100vw - 24px))!important;min-width:0!important;max-height:calc(100vh - 24px)!important;overflow-y:auto!important}
/* SideAI product-card theme, matched to the approved Writing Assistant artwork. */
.aiext-wa-panel { width: min(320px, calc(100vw - 20px)) !important; min-width: 0 !important; max-width: 320px !important; max-height: calc(100vh - 20px) !important; overflow: hidden !important; background: #ffffff !important; border: 1px solid #dce9e3 !important; border-radius: 14px !important; box-shadow: 0 18px 44px rgba(15,23,42,.18) !important; color: #172033 !important; }
.aiext-wa-panel-header { padding: 9px 12px !important; border-bottom: 1px solid #e6eee9 !important; background: linear-gradient(135deg,#f8fff9,#f0fbf7) !important; }
.aiext-wa-panel-title { color: #172033 !important; font-size: 13px !important; font-weight: 750 !important; }
.aiext-wa-panel-title img { width: 20px !important; height: 20px !important; object-fit: contain !important; }
.aiext-wa-panel-btn-icon { color: #526071 !important; }
.aiext-wa-panel-btn-icon:hover { background: #eaf6f0 !important; color: #162033 !important; }
.aiext-wa-panel-body { padding: 10px 12px !important; gap: 7px !important; }
.aiext-wa-section-label { margin-bottom: 3px !important; font-size: 11px !important; }
.aiext-wa-prompt-iframe-wrap { min-height: 70px !important; }
#aiext-wa-prompt-iframe { height: 76px !important; }
.aiext-wa-settings-select,.aiext-wa-length-format-btn { min-height: 30px !important; padding: 4px 7px !important; font-size: 11px !important; background: #f8faf9 !important; border: 1px solid #d9e4df !important; border-radius: 8px !important; color: #334155 !important; }
.aiext-wa-length-format-btn:hover { background: #edf8f3 !important; color: #0d7557 !important; }
.aiext-wa-panel-footer { padding: 0 12px 10px !important; }
.aiext-wa-generate-btn { min-height: 32px !important; padding: 6px 13px !important; background: #08a875 !important; border-radius: 8px !important; font-size: 12px !important; font-weight: 750 !important; }
.aiext-wa-generate-btn:hover:not(:disabled),.aiext-wa-replace-btn:hover { background: #078961 !important; }
.aiext-wa-result-area { min-height: 0 !important; padding: 9px 12px 10px !important; gap: 6px !important; border-top: 1px solid #e6eee9 !important; background: #fbfefc !important; }
.aiext-wa-result-text { max-height: min(120px, 25vh) !important; min-height: 0 !important; padding: 8px 9px !important; font-size: 12px !important; line-height: 1.4 !important; background: #eefbf5 !important; border: 1px solid #cfe9dd !important; border-radius: 9px !important; color: #1d2939 !important; }
.aiext-wa-result-actions { display: grid !important; grid-template-columns: 1fr 1fr !important; }
.aiext-wa-insert-btn,.aiext-wa-replace-btn { min-height: 30px !important; padding: 5px !important; justify-content: center !important; border-radius: 8px !important; font-size: 12px !important; font-weight: 700 !important; }
.aiext-wa-insert-btn { border: 1px solid #08a875 !important; color: #078961 !important; }
.aiext-wa-insert-btn:hover { background: #e8f9f2 !important; }
.aiext-wa-replace-btn { background: #08a875 !important; color: #fff !important; }
.aiext-wa-dropdown { background: #fff !important; border: 1px solid #dce9e3 !important; box-shadow: 0 16px 40px rgba(15,23,42,.18) !important; }
.aiext-wa-dropdown-label { color: #667085 !important; }
.aiext-wa-dropdown-option { background: #f7faf8 !important; border-color: #dce6e1 !important; color: #344054 !important; }
.aiext-wa-dropdown-option:hover { background: #edf8f3 !important; }
.aiext-wa-dropdown-option.aiext-wa-active { background: #08a875 !important; border-color: #08a875 !important; color: #fff !important; }

/* Portaled hover menus and tooltip follow the same light SideAI palette. */
.aiext-wa-disable-dropdown { background: #ffffff !important; border-color: #dce9e3 !important; box-shadow: 0 12px 28px rgba(15, 60, 42, .16) !important; }
.aiext-wa-disable-dropdown button { color: #344054 !important; }
.aiext-wa-disable-dropdown button:hover { background: #e8f9f2 !important; color: #078961 !important; }
.aiext-wa-global-tooltip { background: #173428 !important; color: #ffffff !important; box-shadow: 0 4px 14px rgba(15, 60, 42, .2) !important; }

/* The response and settings menu use the same quiet scrollbar as the light panel. */
.aiext-wa-result-text,
.aiext-wa-dropdown {
    scrollbar-width: auto !important;
    scrollbar-color: auto !important;
}
.aiext-wa-result-text::-webkit-scrollbar,
.aiext-wa-dropdown::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
.aiext-wa-result-text::-webkit-scrollbar-button,
.aiext-wa-dropdown::-webkit-scrollbar-button { display: none !important; width: 0 !important; height: 0 !important; }
.aiext-wa-result-text::-webkit-scrollbar-track { background: #eefbf5 !important; }
.aiext-wa-dropdown::-webkit-scrollbar-track { background: #ffffff !important; }
.aiext-wa-result-text::-webkit-scrollbar-thumb,
.aiext-wa-dropdown::-webkit-scrollbar-thumb { background: #9fc9b5 !important; border-radius: 999px !important; }
.aiext-wa-result-text::-webkit-scrollbar-thumb:hover,
.aiext-wa-dropdown::-webkit-scrollbar-thumb:hover { background: #73ad91 !important; }
.aiext-wa-result-text::-webkit-scrollbar-corner,
.aiext-wa-dropdown::-webkit-scrollbar-corner { background: transparent !important; }

`;

    const CONTENT_MENU_SELECTOR = '.aiext-text-menu, .aiext-prompt-menu, .aiext-page-assistant, .aiext-upgrade-modal, .aiext-guide-modal, .aiext-language-selection, .aiext-wa-guide-modal';

    function hasInlineInputControls(el) {
        if (!el || !el.parentElement) return false;
        const fieldRect = el.getBoundingClientRect();
        if (!fieldRect.width || !fieldRect.height) return false;

        const selector = [
            'button',
            '[role="button"]',
            'a[href]',
            'input[type="button"]',
            'input[type="submit"]',
            'svg',
            '[aria-label*="send" i]',
            '[aria-label*="search" i]',
            '[class*="send" i]',
            '[class*="submit" i]',
            '[class*="button" i]',
            '[class*="icon" i]'
        ].join(',');

        return Array.from(el.parentElement.querySelectorAll(selector)).some((node) => {
            if (node === el || el.contains(node)) return false;
            if (node.closest?.('.aiext-wa-dot-zone') || node.closest?.('#aiext-wa-root')) return false;
            const rect = node.getBoundingClientRect();
            if (rect.width < 8 || rect.height < 8) return false;

            const overlapsY = rect.bottom > fieldRect.top + 4 && rect.top < fieldRect.bottom - 4;
            const insideFieldX = rect.left < fieldRect.right && rect.right > fieldRect.left;
            const nearRightEdge = rect.left >= fieldRect.right - 76 || rect.right > fieldRect.right - 12;
            return overlapsY && insideFieldX && nearRightEdge;
        });
    }

    function isWritingBox(el, options = {}) {
        const allowAttached = !!options.allowAttached;
        if (!el || !el.isConnected || el.ownerDocument !== document || el.disabled || el.readOnly || el.getAttribute('aria-readonly') === 'true') return false;
        if (el.closest('#aiext-wa-root') || (!allowAttached && el.hasAttribute(WA_ATTR))) return false;
        if (el.closest(CONTENT_MENU_SELECTOR)) return false;

        const isFocusedField = getWritingActiveElement() === el;
        let computedStyle = null;
        try {
            computedStyle = getComputedStyle(el);
        } catch (_) {}
        if (computedStyle) {
            if (computedStyle.display === 'none' || computedStyle.opacity === '0') return false;
            if (computedStyle.visibility === 'hidden' || computedStyle.visibility === 'collapse') return false;
        }

        if (el.getAttribute('contenteditable') === 'true') {
            // Allow known chat/composer inputs (e.g. Claude, TipTap/ProseMirror) so the green dot shows
            const isChatInput = el.getAttribute('data-testid') === 'chat-input' ||
                (el.getAttribute('role') === 'textbox' && (el.classList.contains('ProseMirror') || el.classList.contains('tiptap')));
            if (isChatInput) return true;
            if (el.closest('[role="toolbar"]') || el.closest('[role="menu"]')) return false;
            if (el.closest('.tox-toolbar, .ck-toolbar, .rte-toolbar, [class*="Toolbar"], [class*="toolbar"], [class*="format-bar"], [class*="menu-bar"]')) return false;
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) return isFocusedField;
            if (rect.width < 60 || rect.height < (isFocusedField ? 20 : 24)) return false;
            return true;
        }

        const tag = (el.tagName || '').toLowerCase();
        if (tag === 'textarea') {
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height) return isFocusedField;
            if (rect.width < 60 || rect.height < (isFocusedField ? 20 : 24)) return false;
            if (el.closest('[role="toolbar"]') || el.closest('[role="menu"]')) return false;
            if (el.closest('.tox-toolbar, .ck-toolbar, .rte-toolbar, [class*="Toolbar"], [class*="toolbar"], [class*="format-bar"], [class*="menu-bar"]')) return false;
            return true;
        }

        if (tag !== 'input') return false;
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        const excludeTypes = ['number', 'tel', 'password', 'date', 'time', 'datetime-local', 'month', 'week', 'range', 'color', 'file', 'submit', 'button', 'image', 'reset', 'hidden', 'checkbox', 'radio'];
        if (excludeTypes.includes(type)) return false;

        if (el.closest('[role="toolbar"]') || el.closest('[role="menu"]')) return false;
        if (el.closest('.tox-toolbar, .ck-toolbar, .rte-toolbar, [class*="Toolbar"], [class*="toolbar"], [class*="format-bar"], [class*="menu-bar"]')) return false;
        if (/^(one-time-code|cc-|current-password|new-password)/i.test(el.getAttribute('autocomplete') || '')) return false;

        const rect = el.getBoundingClientRect();
        if (!rect.width || !rect.height) return isFocusedField;
        if (rect.width < MIN_WRITING_WIDTH || rect.height < (isFocusedField ? 24 : MIN_WRITING_HEIGHT)) return false;
        const maxLen = parseInt(el.getAttribute('maxlength'), 10);
        if (maxLen > 0 && maxLen <= 4) return false;

        return true;
    }

    let activeDotInstance = null;
    let activeDotHideTimer = null;
    let writingAssistantEnabled = false;

    function getWritingActiveElement() {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return active;
    }

    function resolveWritingField(target) {
        let el = target;
        if (!el) return null;
        if (el.nodeType !== 1) el = el.parentElement;
        if (!el || !el.closest) return null;
        if (el.closest('#aiext-wa-root') || el.closest(CONTENT_MENU_SELECTOR)) return null;

        let candidate = null;
        const editable = el.closest('[contenteditable="true"]');
        if (editable) {
            candidate = editable;
            while (candidate.parentElement) {
                const parentEditable = candidate.parentElement.closest('[contenteditable="true"]');
                if (!parentEditable) break;
                candidate = parentEditable;
            }
        } else if (el.matches?.('input,textarea')) {
            candidate = el;
        } else {
            candidate = el.closest('input,textarea');
        }

        return candidate && isWritingBox(candidate, { allowAttached: true }) ? candidate : null;
    }

    function clearActiveDotHideTimer() {
        if (!activeDotHideTimer) return;
        clearTimeout(activeDotHideTimer);
        activeDotHideTimer = null;
    }

    function restoreWritingField(field) {
        if (!field) return;
        field.removeAttribute(WA_ATTR);
    }

    function instanceFromZone(zone) {
        if (!zone) return null;
        return {
            zone,
            field: zone.waField,
            dropdown: zone.waDropdown,
            cleanup: zone.waCleanup
        };
    }

    function removeDotInstance(instance) {
        if (!instance) return;
        try { instance.cleanup?.(); } catch (_) {}
        try { instance.dropdown?.remove(); } catch (_) {}
        try { instance.zone?.remove(); } catch (_) {}
        restoreWritingField(instance.field);
        if (activeDotInstance && activeDotInstance.zone === instance.zone) {
            activeDotInstance = null;
        }
    }

    function removeAllDotInstances() {
        clearActiveDotHideTimer();
        if (activeDotInstance) removeDotInstance(activeDotInstance);
        document.querySelectorAll('.aiext-wa-dot-zone').forEach((zone) => {
            removeDotInstance(instanceFromZone(zone));
        });
        activeDotInstance = null;
    }

    function isWaPanelOpen() {
        return !!(panel && !panel.classList.contains('aiext-wa-panel-hidden'));
    }

    function isTargetInsideActiveDotUi(target) {
        if (!target || !activeDotInstance) return false;
        const path = target.composedPath ? target.composedPath() : null;
        if (path) {
            if (path.includes(activeDotInstance.zone) || path.includes(activeDotInstance.dropdown)) return true;
            if (_waHost && path.includes(_waHost)) return true;
        }
        return !!(
            activeDotInstance.zone?.contains?.(target) ||
            activeDotInstance.dropdown?.contains?.(target) ||
            (_waHost && _waHost.contains?.(target))
        );
    }

    function isActiveDropdownOpen() {
        return !!activeDotInstance?.dropdown?.classList.contains('aiext-wa-dropdown-open');
    }

    function removeActiveDot() {
        clearActiveDotHideTimer();
        removeDotInstance(activeDotInstance);
    }

    function scheduleActiveDotRemoval(relatedTarget) {
        if (!activeDotInstance) return;
        if (isWaPanelOpen() || isActiveDropdownOpen() || isTargetInsideActiveDotUi(relatedTarget)) return;
        clearActiveDotHideTimer();
        activeDotHideTimer = setTimeout(() => {
            const focusedField = resolveWritingField(getWritingActiveElement());
            if (focusedField && activeDotInstance?.field === focusedField) return;
            if (isWaPanelOpen() || isActiveDropdownOpen() || isTargetInsideActiveDotUi(document.activeElement)) return;
            removeActiveDot();
        }, ACTIVE_DOT_HIDE_DELAY_MS);
    }

    function showDotForField(field) {
        if (!field || !field.isConnected) return;
        clearActiveDotHideTimer();
        if (activeDotInstance?.field === field && activeDotInstance.zone.isConnected) return;
        removeAllDotInstances();
        if (field.hasAttribute(WA_ATTR)) restoreWritingField(field);
        activeDotInstance = createDotAndTooltip(field) || null;
    }

    function getTextInputs() {
        const inputs = document.querySelectorAll(
            'input[type="text"], input[type="email"], input[type="search"], input[type="url"], input:not([type])'
        );
        const textareas = document.querySelectorAll('textarea');
        const editables = document.querySelectorAll('[contenteditable="true"]');
        const list = [];
        inputs.forEach((el) => {
            if (isWritingBox(el)) list.push(el);
        });
        textareas.forEach((el) => {
            if (isWritingBox(el)) list.push(el);
        });
        editables.forEach((el) => {
            if (el.parentElement && el.parentElement.closest('[contenteditable="true"]')) return;
            if (isWritingBox(el)) list.push(el);
        });
        return list;
    }

    // Keep the action outside the text box and away from native send/mic/clear buttons.
    function getWritingActionPlacement(rect, viewport, occupied = [], isClear = () => true, footprint = { width: 64, height: 32 }, rtl = false, nativeInset = 0) {
        const width = footprint.width, height = footprint.height, gap = 6;
        if (rect.width < width + gap * 2 || rect.height < height) return null;
        const top = rect.height > 72 ? rect.bottom - height - gap : rect.top + (rect.height - height) / 2;
        const start = rtl ? rect.left + gap + nativeInset : rect.right - width - gap - nativeInset;
        // Move inward past native clear/mic/send controls. The trailing text space is reserved below.
        for (let offset = 0; offset <= Math.min(180, rect.width - width - gap * 2); offset += 8) {
            const left = start + (rtl ? offset : -offset);
            const p = { left, top, right: left + width, bottom: top + height };
            if (p.left < rect.left + gap || p.right > rect.right - gap || p.top < rect.top || p.bottom > rect.bottom ||
                p.left < viewport.left || p.right > viewport.right || p.top < viewport.top || p.bottom > viewport.bottom) continue;
            if (!occupied.some(r => p.left < r.right + 3 && p.right > r.left - 3 && p.top < r.bottom + 3 && p.bottom > r.top - 3) && isClear(p)) return p;
        }
        return null;
    }

    function createWritingSpaceReservation(field) {
        const properties = ['padding-inline-end', 'box-sizing', 'width', 'height'];
        const saved = new Map(properties.map(name => [name, {value:field.style.getPropertyValue(name), priority:field.style.getPropertyPriority(name)}]));
        const applied = new Map();
        const css = getComputedStyle(field);
        const baseEnd = parseFloat(css.paddingInlineEnd) || 0;
        const number = name => parseFloat(css[name]) || 0;
        const horizontal = number('paddingLeft') + number('paddingRight') + number('borderLeftWidth') + number('borderRightWidth');
        const vertical = number('paddingTop') + number('paddingBottom') + number('borderTopWidth') + number('borderBottomWidth');
        const originalRect = field.getBoundingClientRect();
        const typed = name => { try { return field.computedStyleMap().get(name).toString(); } catch (_) { return css[name]; } };
        const width = typed('width'), height = typed('height');
        const set = (name, value) => {
            if (field.style.getPropertyValue(name) !== value || field.style.getPropertyPriority(name) !== 'important') field.style.setProperty(name, value, 'important');
            applied.set(name, field.style.getPropertyValue(name));
        };
        return {
            apply(space) {
                if (css.boxSizing === 'content-box') {
                    set('box-sizing', 'border-box');
                    if (width !== 'auto' && !/content|fit/.test(width)) set('width', `calc(${width} + ${horizontal}px)`);
                    else if (/^(INPUT|TEXTAREA)$/.test(field.tagName)) set('width', originalRect.width + 'px');
                    if (height !== 'auto' && !/content|fit/.test(height)) set('height', `calc(${height} + ${vertical}px)`);
                }
                set('padding-inline-end', Math.max(baseEnd, space) + 'px');
            },
            restore() {
                for (const [name,value] of applied) {
                    if (field.style.getPropertyValue(name) !== value) continue; // Respect a later website edit.
                    const previous = saved.get(name);
                    if (previous.value) field.style.setProperty(name, previous.value, previous.priority);
                    else field.style.removeProperty(name);
                }
                applied.clear();
            }
        };
    }

    // Inspect the rendered page, not just siblings: toolbars are often cousins of the editor.
    function isWritingActionAreaClear(area, field) {
        const controls = 'button,a[href],input,textarea,select,label,summary,iframe,video,audio,[role="button"],[role="link"],[role="menuitem"],[contenteditable="true"],[tabindex]';
        for (const x of [area.left - 3, area.left + (area.right - area.left) / 2, area.right + 3]) {
            for (const y of [area.top - 3, area.top + (area.bottom - area.top) / 2, area.bottom + 3]) {
                let layers = document.elementsFromPoint(x, y);
                for (let i = 0; i < layers.length; i++) {
                    const el = layers[i];
                    if (el === _waHost || _waHost?.contains(el)) continue;
                    if (el.shadowRoot?.elementsFromPoint) {
                        for (const child of el.shadowRoot.elementsFromPoint(x, y)) if (child !== el && !layers.includes(child)) layers.push(child);
                    }
                    if (el === field) continue;
                    const control = el.closest?.(controls);
                    if (control && control !== field && !control.contains(field)) return false;
                    if (!el.contains(field) && (getComputedStyle(el).cursor === 'pointer' || el.matches('img,svg,canvas,[role="option"],[role="tab"]'))) return false;
                    if (field.contains(el)) continue; // Native text is kept out by the reserved inline-end padding.
                    // Do not place the action over nearby labels or ordinary page text either.
                    for (const node of el.childNodes || []) {
                        if (node.nodeType !== 3 || !node.textContent.trim()) continue;
                        const range = document.createRange(); range.selectNodeContents(node);
                        const blocks = [...range.getClientRects()].some(r => area.left < r.right + 3 && area.right > r.left - 3 && area.top < r.bottom + 3 && area.bottom > r.top - 3);
                        if (blocks) return false;
                    }
                }
            }
        }
        return true;
    }

    function getVisibleWritingRect(field) {
        const rect = field.getBoundingClientRect();
        const view = window.visualViewport;
        const visible = { left: view?.offsetLeft || 0, top: view?.offsetTop || 0,
            right: (view?.offsetLeft || 0) + (view?.width || innerWidth), bottom: (view?.offsetTop || 0) + (view?.height || innerHeight) };
        let left = Math.max(rect.left, visible.left), top = Math.max(rect.top, visible.top);
        let right = Math.min(rect.right, visible.right), bottom = Math.min(rect.bottom, visible.bottom);
        let parent = field.parentElement || field.getRootNode()?.host;
        while (parent && parent !== document.body) {
            const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
            if (/hidden|clip|scroll|auto/.test(style.overflowX)) { left = Math.max(left, bounds.left); right = Math.min(right, bounds.right); }
            if (/hidden|clip|scroll|auto/.test(style.overflowY)) { top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom); }
            parent = parent.parentElement || parent.getRootNode()?.host;
        }
        return { rect: { left, top, right, bottom, width: right - left, height: bottom - top }, viewport: visible };
    }

    function createDotAndTooltip(field) {
        injectWaPageStyles();
        const parent = field.parentNode;
        if (!parent) return;

        const zone = document.createElement('div');
        zone.className = 'aiext-wa-dot-zone';
        zone.waField = field;

        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'aiext-wa-dot';
        dot.setAttribute('aria-label', 'Open Writing Assistant');
        dot.title = 'Writing Assistant (' + getWaShortcutLabel() + ')';
        dot.innerHTML = '<span style="display:block;width:9px;height:9px;border-radius:50%;background:#10a37f" aria-hidden="true"></span>';
        for (const [name,value] of Object.entries({width:'24px',height:'24px',padding:'0',right:'0',top:'0',transform:'none',background:'transparent',display:'grid','place-items':'center',cursor:'pointer'})) dot.style.setProperty(name,value,'important');

        /* Pill that fully replaces the dot on hover (X + brain, like your example) */
        const pill = document.createElement('div');
        pill.className = 'aiext-wa-pill';

        const xBtn = document.createElement('button');
        xBtn.type = 'button';
        xBtn.className = 'aiext-wa-pill-x';
        xBtn.setAttribute('aria-label', 'Disable Writing Assistant');
        xBtn.innerHTML = '×';

        const brainBtn = document.createElement('button');
        brainBtn.type = 'button';
        brainBtn.className = 'aiext-wa-pill-brain';
        brainBtn.setAttribute('aria-label', 'Open Writing Assistant');
        brainBtn.setAttribute('data-tooltip', `Writing Assistant (${getWaShortcutLabel()})`);
        brainBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20" viewBox="0 0 48 48"><image xlink:href="${FEATURE_LOGO_URL}" x="0" y="0" width="48" height="48"/></svg>`;

        // Reserve the complete hover pill, not only the nine-pixel green indicator.
        for (const [name,value] of Object.entries({left:'0',right:'auto',top:'6px'})) dot.style.setProperty(name,value,'important');
        for (const [name,value] of Object.entries({left:'0',right:'auto',top:'0',transform:'none',width:'60px',height:'32px','box-sizing':'border-box',margin:'0',padding:'1px'})) pill.style.setProperty(name,value,'important');

        const dropdown = document.createElement('div');
        dropdown.className = 'aiext-wa-disable-dropdown aiext-wa-disable-dropdown-portaled';
        dropdown.innerHTML = '<button type="button" class="aiext-wa-disable-site">Disable on this site</button><button type="button" class="aiext-wa-disable-all">Disable on all sites</button>';
        getOrCreateRoot().appendChild(dropdown);
        zone.waDropdown = dropdown;

        pill.appendChild(xBtn);
        pill.appendChild(brainBtn);

        zone.appendChild(dot);
        zone.appendChild(pill);

        const root = getOrCreateRoot();
        const dialog = field.closest('dialog[open]');
        const hostParent = dialog || document.body;
        if (_waHost.parentNode !== hostParent) hostParent.appendChild(_waHost);
        root.appendChild(zone);
        for (const [name,value] of Object.entries({position:'fixed',width:'64px',height:'32px',right:'auto',transform:'none',margin:'0'})) zone.style.setProperty(name,value,'important');
        const spaceReservation = createWritingSpaceReservation(field);
        let compactAction = false;
        let positionFrame = null;
        const positionZone = () => {
            positionFrame = null;
            if (!field.isConnected) { removeActiveDot(); return; }
            const activeDialog = field.closest('dialog[open]');
            const overlayParent = activeDialog || document.body;
            if (_waHost.parentNode !== overlayParent) overlayParent.appendChild(_waHost);
            const style = getComputedStyle(field);
            const {rect,viewport} = getVisibleWritingRect(field);
            const controls = new Set();
            let scope = parent;
            // Bound the scan to the nearby composer; hit testing also catches unrelated overlays.
            for (let depth = 0; scope && scope !== document.body && depth < 4; depth++) {
                for (const el of scope.querySelectorAll('button,a[href],input,textarea,select,label,summary,iframe,[role="button"],[role="link"],[tabindex],[contenteditable="true"]')) controls.add(el);
                scope = scope.parentElement || scope.getRootNode()?.host;
            }
            const neighbors = [...controls].filter(el => el !== field && !field.contains(el) && !el.contains(field) && el !== _waHost && !_waHost.contains(el))
                .filter(el => { const css = getComputedStyle(el); return css.visibility !== 'hidden' && css.display !== 'none'; })
                .flatMap(el => [...el.getClientRects()]).filter(r => r.width && r.height);
            compactAction = rect.width < 320 || rect.height < 28;
            if (compactAction) { dot.classList.remove('aiext-wa-hidden'); pill.classList.remove('aiext-wa-visible'); }
            const footprint = { width: compactAction ? 24 : 64, height: Math.min(32, rect.height) };
            const rtl = style.direction === 'rtl';
            const point = rect.width >= 80 && rect.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none'
                ? getWritingActionPlacement(rect, viewport, neighbors, area => isWritingActionAreaClear(area, field), footprint, rtl, Math.max(field.type === 'search' ? 24 : 0, field.scrollHeight > field.clientHeight && /auto|scroll/.test(style.overflowY) ? Math.max(12, field.offsetWidth - field.clientWidth - (parseFloat(style.borderLeftWidth) || 0) - (parseFloat(style.borderRightWidth) || 0)) : 0)) : null;
            if (point) {
                const fieldRect = field.getBoundingClientRect();
                spaceReservation.apply((rtl ? point.right - fieldRect.left : fieldRect.right - point.left) + 6);
                zone.style.setProperty('width', footprint.width + 'px', 'important');
                zone.style.setProperty('height', footprint.height + 'px', 'important');
                dot.style.setProperty('left', rtl ? '0' : (footprint.width - 24) + 'px', 'important');
                dot.style.setProperty('height', Math.min(24, footprint.height) + 'px', 'important');
                dot.style.setProperty('top', Math.max(0, (footprint.height - 24) / 2) + 'px', 'important');
                pill.style.setProperty('height', footprint.height + 'px', 'important');
                brainBtn.style.setProperty('height', Math.max(20, footprint.height - 4) + 'px', 'important');
                xBtn.style.setProperty('height', Math.max(20, footprint.height - 4) + 'px', 'important');
            } else spaceReservation.restore();
            zone.style.setProperty('display',point ? 'flex' : 'none','important');
            if (!point) { hideGlobalTooltip(); return; }
            zone.style.setProperty('left',point.left + 'px','important');
            zone.style.setProperty('top',point.top + 'px','important');
        };
        const schedulePosition = () => { if (positionFrame === null) positionFrame = requestAnimationFrame(positionZone); };
        const resizeObserver = new ResizeObserver(schedulePosition);
        resizeObserver.observe(field); if (parent.nodeType === 1) resizeObserver.observe(parent);
        const mutationObserver = new MutationObserver(records => {
            if (records.some(record => !(_waHost && (record.target === _waHost || _waHost.contains(record.target))))) schedulePosition();
        });
        mutationObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','disabled']});
        document.addEventListener('scroll',schedulePosition,{capture:true,passive:true});
        window.addEventListener('resize',schedulePosition,{passive:true});
        window.visualViewport?.addEventListener('resize',schedulePosition,{passive:true});
        window.visualViewport?.addEventListener('scroll',schedulePosition,{passive:true});
        positionZone();

        function positionDropdown() {
            const rect = xBtn.getBoundingClientRect();
            dropdown.style.setProperty('left', rect.left + 'px', 'important');
            dropdown.style.setProperty('top', (rect.bottom + 4) + 'px', 'important');
        }

        let leaveTimeout = null;
        const showPill = () => {
            if (compactAction) return;
            clearActiveDotHideTimer();
            if (leaveTimeout) clearTimeout(leaveTimeout);
            leaveTimeout = null;
            dot.classList.add('aiext-wa-hidden');
            pill.classList.add('aiext-wa-visible');
        };
        const hidePill = () => {
            if (dropdown.classList.contains('aiext-wa-dropdown-open')) return;
            dot.classList.remove('aiext-wa-hidden');
            pill.classList.remove('aiext-wa-visible');
        };
        const scheduleHide = () => {
            if (leaveTimeout) clearTimeout(leaveTimeout);
            leaveTimeout = setTimeout(hidePill, 120);
        };

        dot.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openPanel(field); });
        dot.addEventListener('mouseenter', showPill);
        dot.addEventListener('mouseleave', scheduleHide);
        pill.addEventListener('mouseenter', showPill);
        pill.addEventListener('mouseleave', scheduleHide);

        brainBtn.addEventListener('mouseenter', () => showGlobalTooltip(brainBtn));
        brainBtn.addEventListener('mouseleave', hideGlobalTooltip);
        brainBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideGlobalTooltip();
            openPanel(field);
        });

        xBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const willOpen = !dropdown.classList.contains('aiext-wa-dropdown-open');
            if (willOpen) positionDropdown();
            dropdown.classList.toggle('aiext-wa-dropdown-open');
        });

        const closeDropdown = () => {
            dropdown.classList.remove('aiext-wa-dropdown-open');
        };
        const waCloseDropdown = function(ev) {
            if (!dropdown.classList.contains('aiext-wa-dropdown-open')) return;
            const path = ev.composedPath ? ev.composedPath() : (ev.path || [ev.target]);
            if (path.includes(zone) || path.includes(dropdown) || (_waHost && path.includes(_waHost))) return;
            closeDropdown();
            dot.classList.remove('aiext-wa-hidden');
            pill.classList.remove('aiext-wa-visible');
        };
        document.addEventListener('click', waCloseDropdown);
        zone.waCleanup = () => {
            spaceReservation.restore();
            document.removeEventListener('click', waCloseDropdown);
            document.removeEventListener('scroll',schedulePosition,true);
            window.removeEventListener('resize',schedulePosition);
            window.visualViewport?.removeEventListener('resize',schedulePosition);
            window.visualViewport?.removeEventListener('scroll',schedulePosition);
            resizeObserver.disconnect(); mutationObserver.disconnect();
            if (positionFrame !== null) cancelAnimationFrame(positionFrame);
            if (leaveTimeout) clearTimeout(leaveTimeout);
        };
        dropdown.querySelector('.aiext-wa-disable-site').addEventListener('click', (e) => {
            e.stopPropagation();
            const host = location.hostname || '';
            if (!host) return;
            if (!isExtensionContextValid()) { closeDropdown(); return; }
            try {
                chrome.storage.sync.get([WA_DISABLED_SITES_KEY], (r) => {
                    try {
                        if (!isExtensionContextValid()) { closeDropdown(); return; }
                        const list = (r && r[WA_DISABLED_SITES_KEY]) || [];
                        if (list.includes(host)) return;
                        chrome.storage.sync.set({ [WA_DISABLED_SITES_KEY]: [...list, host] }, () => {
                            closeDropdown();
                            shouldShowGuide().then((show) => { if (show) setTimeout(showGuideModalWritingAssistant, 500); });
                        });
                    } catch (_) { closeDropdown(); }
                });
            } catch (_) { closeDropdown(); }
        });
        dropdown.querySelector('.aiext-wa-disable-all').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isExtensionContextValid()) { closeDropdown(); return; }
            try {
                chrome.storage.sync.set({ [WA_DISABLED_ALL_KEY]: true }, () => {
                    closeDropdown();
                    shouldShowGuide().then((show) => { if (show) setTimeout(showGuideModalWritingAssistant, 500); });
                });
            } catch (_) { closeDropdown(); }
        });

        field.setAttribute(WA_ATTR, 'true');

        return { zone, dot, pill, dropdown, field, cleanup: zone.waCleanup };
    }

    let panel = null;
    let panelDragStart = null;
    let currentField = null;
    let currentRequestId = null;
    let currentSessionUsageCounted = false;
    let currentBestResponseText = '';
    let currentPageContext = null;
    let pageContextAttached = true;
    let lengthFormatOpen = false;
    let lengthFormatReposition = null;
    let waIframe = null;
    let waIframeReady = false;

    function getOrCreateWaIframe() {
        if (waIframe && waIframe.contentWindow) return waIframe;
        try {
            if (!isExtensionContextValid()) return null;
            const root = getOrCreateRoot();
            waIframe = document.createElement('iframe');
            waIframe.id = 'wa-chatgpt-iframe';
            waIframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
            waIframe.src = chrome.runtime.getURL('ai-assistant-chatgpt-frame.html');
            waIframe.addEventListener('load', () => { waIframeReady = true; }, { once: true });
            root.appendChild(waIframe);
            return waIframe;
        } catch (_) { return null; }
    }

    let _waShadowRoot = null;
    let _waHost = null;

    function injectWaPageStyles() {
        if (document.getElementById('aiext-wa-page-styles')) return;
        const style = document.createElement('style');
        style.id = 'aiext-wa-page-styles';
        style.textContent = AIEXT_WA_PAGE_CSS + AIEXT_WA_PAGE_THEME_CSS;
        document.head.appendChild(style);
    }

    const AIEXT_WA_CONTEXT_CSS = `
        .aiext-wa-context-area{margin-block-end:14px}
        .aiext-wa-context-area[hidden],.aiext-wa-attach-context[hidden],.aiext-wa-context [hidden]{display:none!important}
        .aiext-wa-context{display:flex;align-items:center;gap:10px;margin:0;padding:10px;border:1px solid #dce7e1;border-radius:12px;background:#fff;color:#243c34;font:12px/1.4 system-ui;box-shadow:0 1px 3px #21392e06}
        .aiext-wa-context-favicon,.aiext-wa-context-placeholder{inline-size:32px;block-size:32px;flex:none;object-fit:contain;border-radius:6px}
        .aiext-wa-context-placeholder{color:#7e9287;padding:5px;background:#f3f8f5;box-sizing:border-box}
        .aiext-wa-context-label{flex:1;min-inline-size:0;display:flex;flex-direction:column;gap:3px}
        .aiext-wa-context-title{margin:0;font:600 13px/1.4 system-ui;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#213a30}
        .aiext-wa-context-domain{margin:0;font:11px/1.4 system-ui;color:#7b8b82;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .aiext-wa-context footer{display:flex;flex:none;margin-inline-start:auto}
        .aiext-wa-context-remove{display:grid;place-items:center;inline-size:28px;block-size:28px;padding:0;border:0;border-radius:50%;background:#f3f7f5;color:#667b70;cursor:pointer;font:20px/1 system-ui}
        .aiext-wa-context-remove:hover{background:#e7f5ed;color:#087d60}
        .aiext-wa-attach-context{display:inline-flex;align-items:center;gap:6px;margin-block:5px 8px;padding:6px 9px;border:1px solid #dce7e1;border-radius:8px;background:#fff;color:#19785d;cursor:pointer;font:500 12px/1.4 system-ui}
        .aiext-wa-attach-context:hover{background:#eef9f3;border-color:#aedac6}
        .aiext-wa-attach-context svg{inline-size:15px;block-size:15px;flex:none}
        .aiext-wa-context-remove:focus-visible,.aiext-wa-attach-context:focus-visible{outline:2px solid #059669;outline-offset:2px}
    `;
    function getOrCreateRoot() {
        if (_waShadowRoot) return _waShadowRoot;
        let host = document.getElementById('aiext-wa-root');
        if (!host) {
            host = document.createElement('div');
            host.id = 'aiext-wa-root';
            const shadow = host.attachShadow({ mode: 'closed' });
            host.__aiextShadowRoot = shadow; // store for closed-mode recovery
            _waShadowRoot = shadow;
            _waHost = host;
            const style = document.createElement('style');
            style.textContent = AIEXT_WA_CSS + '\n:host{position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483645!important}:host > *{pointer-events:auto}.aiext-wa-dot-zone{position:fixed!important}.aiext-wa-dot:focus-visible{outline:2px solid #059669!important;outline-offset:2px!important}' + AIEXT_WA_CONTEXT_CSS;
            shadow.appendChild(style);
            document.body.appendChild(host);
        } else {
            _waShadowRoot = host.__aiextShadowRoot || host.shadowRoot;
            _waHost = host;
        }
        return _waShadowRoot;
    }

    function getOrCreateGlobalTooltip() {
        const root = getOrCreateRoot();
        let el = root.querySelector('.aiext-wa-global-tooltip');
        if (!el) {
            el = document.createElement('div');
            el.className = 'aiext-wa-global-tooltip';
            el.setAttribute('aria-hidden', 'true');
            root.appendChild(el);
        }
        return el;
    }

    function showGlobalTooltip(btn) {
        const tip = getOrCreateGlobalTooltip();
        const text = btn.getAttribute('data-tooltip') || '';
        if (!text) return;
        tip.textContent = text;
        const rect = btn.getBoundingClientRect();
        tip.style.left = (rect.left + rect.width / 2) + 'px';
        tip.style.top = (rect.top - 8) + 'px';
        tip.style.transform = 'translate(-50%, -100%)';
        tip.classList.add('aiext-wa-tooltip-visible');
    }

    function hideGlobalTooltip() {
        const tip = getOrCreateRoot().querySelector('.aiext-wa-global-tooltip');
        if (tip) tip.classList.remove('aiext-wa-tooltip-visible');
    }

    function createPanel() {
        if (panel) return panel;

        const root = getOrCreateRoot();
        const div = document.createElement('div');
        div.className = 'aiext-wa-panel';
        div.innerHTML = `
            <div class="aiext-wa-panel-header">
                <span class="aiext-wa-panel-title">
                    <img width="24" height="24" src="${chrome.runtime.getURL('images/sideai-feature.png')}" alt=""><span>Writing Assistant</span>
                </span>
                <div class="aiext-wa-panel-actions">
                    <button type="button" class="aiext-wa-panel-btn-icon" id="aiext-wa-close" aria-label="Close">×</button>
                </div>
            </div>
            <div class="aiext-wa-panel-body">
                <div class="aiext-wa-context-area" id="aiext-wa-context-area">
                    <span class="aiext-wa-section-label" id="aiext-wa-context-caption">Page context attached</span>
                    <article class="aiext-wa-context" aria-labelledby="aiext-wa-context-caption">
                        <img class="aiext-wa-context-favicon" id="aiext-wa-context-favicon" width="32" height="32" alt="" hidden>
                        <svg class="aiext-wa-context-placeholder" id="aiext-wa-context-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
                        <header class="aiext-wa-context-label"><h3 class="aiext-wa-context-title" id="aiext-wa-context-title"></h3><p class="aiext-wa-context-domain" id="aiext-wa-context-domain"></p></header>
                        <footer><button type="button" class="aiext-wa-context-remove" id="aiext-wa-context-toggle" aria-label="Remove attached page context" title="Remove page context">×</button></footer>
                    </article>
                </div>
                <label class="aiext-wa-section-label">Your prompt</label><div class="aiext-wa-prompt-iframe-wrap" id="aiext-wa-prompt-wrap" style="position:relative;min-height:80px;">
                    <iframe id="aiext-wa-prompt-iframe" style="width:100%;height:102px;border:none;display:block;background:transparent;" title="Writing Assistant prompt"></iframe>
                </div>
                <button type="button" class="aiext-wa-attach-context" id="aiext-wa-context-attach" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 11v7M8.5 14.5h7"/></svg>Attach page context</button>
                <div class="aiext-wa-settings-row">
                    <select class="aiext-wa-settings-select" id="aiext-wa-language">
                        ${LANGUAGES.map((l) => `<option value="${l.value}">${l.label}${l.sub ? ` — ${l.sub}` : ''}</option>`).join('')}
                    </select>
                    <button type="button" class="aiext-wa-length-format-btn" id="aiext-wa-length-format">Length & format</button>
                </div>
            </div>
            <div class="aiext-wa-panel-footer">
                <button type="button" class="aiext-wa-generate-btn" id="aiext-wa-generate">
                    Generate
                </button>
            </div>
            <div class="aiext-wa-result-area aiext-wa-hidden" id="aiext-wa-result-area">
                <div class="aiext-wa-response-heading"><span class="aiext-wa-section-label">AI response</span><button type="button" id="aiext-wa-copy" aria-label="Copy response">Copy</button></div><div class="aiext-wa-result-text" id="aiext-wa-result-text"></div>
                <div class="aiext-wa-result-actions">
                    <button type="button" class="aiext-wa-insert-btn" id="aiext-wa-insert">Insert</button>
                    <button type="button" class="aiext-wa-replace-btn" id="aiext-wa-replace">Replace</button>
                </div>
            </div>
            <div class="aiext-wa-error" id="aiext-wa-error" style="display: none;"></div>
        `;

        root.appendChild(div);
        panel = div;
        div.querySelector('#aiext-wa-context-toggle').addEventListener('click', () => {
            pageContextAttached = false;
            renderPageContext(div);
            div.querySelector('#aiext-wa-context-attach').focus();
        });
        div.querySelector('#aiext-wa-context-attach').addEventListener('click', () => {
            currentPageContext = globalThis.SideAIPageContext?.capture(currentField) || null;
            pageContextAttached = !!currentPageContext;
            renderPageContext(div);
            if(pageContextAttached)div.querySelector('#aiext-wa-context-toggle').focus();
        });

        const promptIframe = div.querySelector('#aiext-wa-prompt-iframe');
        const PROMPT_SRCDOC = `<!DOCTYPE html><html style="color-scheme:light;height:100%"><head><meta charset="UTF-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{color-scheme:light;height:100%}
body{background:transparent;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px}
#aiext-wa-prompt{width:100%;height:100%;min-height:64px;padding:7px 9px;border-radius:8px;border:1px solid #dce7e1;background:#ffffff;color:#172033;font-size:12px;font-family:inherit;resize:vertical;outline:none;line-height:1.4;display:block}
#aiext-wa-prompt::placeholder{color:#888}
#aiext-wa-prompt:focus{border-color:#07966c;box-shadow:0 0 0 2px rgba(7,150,108,0.15)}
#aiext-wa-prompt::-webkit-scrollbar{width:6px!important;height:6px!important}
#aiext-wa-prompt::-webkit-scrollbar-button{display:none!important;height:0!important;width:0!important}
#aiext-wa-prompt::-webkit-scrollbar-track{background:#ffffff!important;border-radius:4px!important}
#aiext-wa-prompt::-webkit-scrollbar-thumb{background:#9fc9b5!important;border-radius:4px!important}
#aiext-wa-prompt::-webkit-scrollbar-thumb:hover{background:#73ad91!important}
#aiext-wa-prompt::-webkit-scrollbar-corner{background:transparent!important}
@supports not selector(::-webkit-scrollbar){#aiext-wa-prompt{scrollbar-width:thin;scrollbar-color:#9fc9b5 #ffffff}}
</style></head><body><textarea id="aiext-wa-prompt" class="aiext-wa-prompt-styled" placeholder="Tell me what you want to write" rows="3"></textarea></body></html>`;
        promptIframe.srcdoc = PROMPT_SRCDOC;
        promptIframe.addEventListener('load', function() {
            const doc = promptIframe.contentDocument;
            if (!doc) return;
            const promptEl = doc.getElementById('aiext-wa-prompt');
            if (!promptEl) return;
            promptEl.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    doGenerate(div);
                }
            });
        });

        const generateBtn = div.querySelector('#aiext-wa-generate');
        const resultArea = div.querySelector('#aiext-wa-result-area');
        const resultText = div.querySelector('#aiext-wa-result-text');
        const errorEl = div.querySelector('#aiext-wa-error');
        const insertBtn = div.querySelector('#aiext-wa-insert');
        const replaceBtn = div.querySelector('#aiext-wa-replace');
        const lengthFormatBtn = div.querySelector('#aiext-wa-length-format');
        const closeBtn = div.querySelector('#aiext-wa-close');
        div.querySelector('#aiext-wa-copy').addEventListener('click', async e => { try { await navigator.clipboard.writeText(resultText.innerText); e.currentTarget.textContent = 'Copied'; } catch (_) { e.currentTarget.textContent = 'Try again'; } });

        lengthFormatBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLengthFormatDropdown(div);
        });

        document.addEventListener('click', (ev) => {
            if (!lengthFormatOpen) return;
            const drop = getOrCreateRoot().querySelector('#aiext-wa-length-format-dropdown');
            const btn = panel?.querySelector('#aiext-wa-length-format');
            const path = ev.composedPath ? ev.composedPath() : (ev.target ? [ev.target] : []);
            if (drop && path.some((n) => n === drop || (drop.contains && drop.contains(n)))) return;
            if (btn && path.some((n) => n === btn || (btn.contains && btn.contains(n)))) return;
            hideLengthFormatDropdown();
        });

        function saveSettingsFromPanel() {
            const lang = div.querySelector('#aiext-wa-language')?.value || 'auto';
            const len = div.querySelector('#aiext-wa-length')?.value || 'auto';
            const form = div.querySelector('#aiext-wa-formality')?.value || 'auto';
            const tone = div.querySelector('#aiext-wa-tone')?.value || 'auto';
            const format = div.querySelector('#aiext-wa-format')?.value || 'auto';
            saveSettings({ language: lang, length: len, formality: form, tone, format });
        }

        div.querySelector('#aiext-wa-language').addEventListener('change', saveSettingsFromPanel);

        const generateShortcut = isMac ? '⌘ + Enter' : 'Ctrl + Enter';
        generateBtn.setAttribute('title', `Generate (${generateShortcut})`);

        generateBtn.addEventListener('click', () => doGenerate(div));

        insertBtn.addEventListener('click', () => {
            const text = resultText.textContent || '';
            if (currentField && text) {
                insertAtCursor(currentField, text);
                closePanel();
            }
        });

        replaceBtn.addEventListener('click', () => {
            const text = resultText.textContent || '';
            const field = currentField;
            if (field && text) {
                if (field.getAttribute('contenteditable') === 'true') {
                    requestAnimationFrame(() => {
                        replaceContentEditableContent(field, text);
                        closePanel();
                    });
                } else {
                    field.value = text;
                    field.dispatchEvent(new Event('input', { bubbles: true }));
                    closePanel();
                }
            }
        });

        closeBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            closePanel();
        });
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closePanel();
        });

        div.querySelector('.aiext-wa-panel-header').addEventListener('mousedown', (e) => {
            const el = e.target.nodeType === 3 ? e.target.parentNode : e.target;
            if (el && (el.id === 'aiext-wa-close' || (el.closest && el.closest('#aiext-wa-close')))) return;
            const target = el;
            if (target && target.closest && target.closest('button')) return;
            panelDragStart = { x: e.clientX, y: e.clientY, left: div.offsetLeft, top: div.offsetTop };
        }, true);

        document.addEventListener('mousemove', (e) => {
            if (!panelDragStart) return;
            div.style.left = (panelDragStart.left + e.clientX - panelDragStart.x) + 'px';
            div.style.top = (panelDragStart.top + e.clientY - panelDragStart.y) + 'px';
            div.style.right = 'auto';
            div.style.bottom = 'auto';
        });

        document.addEventListener('mouseup', () => { panelDragStart = null; });

        return panel;
    }

    function toggleLengthFormatDropdown(panelEl) {
        const existing = getOrCreateRoot().querySelector('#aiext-wa-length-format-dropdown');
        if (existing) {
            hideLengthFormatDropdown();
            return;
        }

        const btn = panelEl.querySelector('#aiext-wa-length-format');
        const root = getOrCreateRoot();
        const drop = document.createElement('div');
        drop.id = 'aiext-wa-length-format-dropdown';
        drop.className = 'aiext-wa-dropdown';

        const lengthVal = panelEl.querySelector('#aiext-wa-length')?.value || 'auto';
        const formalityVal = panelEl.querySelector('#aiext-wa-formality')?.value || 'auto';
        const toneVal = panelEl.querySelector('#aiext-wa-tone')?.value || 'auto';
        const formatVal = panelEl.querySelector('#aiext-wa-format')?.value || 'auto';

        drop.innerHTML = `
            <div class="aiext-wa-dropdown-section">
                <div class="aiext-wa-dropdown-label">Length</div>
                <div class="aiext-wa-dropdown-options" id="aiext-wa-length-opts">
                    ${LENGTH_OPTIONS.map((o) => `<button type="button" class="aiext-wa-dropdown-option ${o.value === lengthVal ? 'aiext-wa-active' : ''}" data-wa-length="${o.value}">${o.label}</button>`).join('')}
                </div>
            </div>
            <div class="aiext-wa-dropdown-section">
                <div class="aiext-wa-dropdown-label">Formality</div>
                <div class="aiext-wa-dropdown-options" id="aiext-wa-formality-opts">
                    ${FORMALITY_OPTIONS.map((o) => `<button type="button" class="aiext-wa-dropdown-option ${o.value === formalityVal ? 'aiext-wa-active' : ''}" data-wa-formality="${o.value}">${o.label}</button>`).join('')}
                </div>
            </div>
            <div class="aiext-wa-dropdown-section">
                <div class="aiext-wa-dropdown-label">Format</div>
                <div class="aiext-wa-dropdown-options" id="aiext-wa-format-opts">
                    ${FORMAT_OPTIONS.map((o) => `<button type="button" class="aiext-wa-dropdown-option ${o.value === formatVal ? 'aiext-wa-active' : ''}" data-wa-format="${o.value}">${o.label}</button>`).join('')}
                </div>
            </div>
            <div class="aiext-wa-dropdown-section">
                <div class="aiext-wa-dropdown-label">Tone</div>
                <div class="aiext-wa-dropdown-options" id="aiext-wa-tone-opts">
                    ${TONE_OPTIONS.map((o) => `<button type="button" class="aiext-wa-dropdown-option ${o.value === toneVal ? 'aiext-wa-active' : ''}" data-wa-tone="${o.value}">${o.label}</button>`).join('')}
                </div>
            </div>
        `;

        drop.querySelector('#aiext-wa-length-opts').addEventListener('click', (e) => {
            const b = e.target.closest('[data-wa-length]');
            if (!b) return;
            drop.querySelectorAll('[data-wa-length]').forEach((x) => x.classList.remove('aiext-wa-active'));
            b.classList.add('aiext-wa-active');
            if (!panelEl.querySelector('#aiext-wa-length')) {
                const h = document.createElement('input');
                h.type = 'hidden';
                h.id = 'wa-length';
                h.value = b.dataset.waLength;
                panelEl.querySelector('.aiext-wa-panel-body').appendChild(h);
            } else panelEl.querySelector('#aiext-wa-length').value = b.dataset.waLength;
            saveSettings({
                language: panelEl.querySelector('#aiext-wa-language')?.value || 'auto',
                length: panelEl.querySelector('#aiext-wa-length')?.value || 'auto',
                formality: panelEl.querySelector('#aiext-wa-formality')?.value || 'auto',
                tone: panelEl.querySelector('#aiext-wa-tone')?.value || 'auto',
                format: panelEl.querySelector('#aiext-wa-format')?.value || 'auto'
            });
        });

        drop.querySelector('#aiext-wa-formality-opts').addEventListener('click', (e) => {
            const b = e.target.closest('[data-wa-formality]');
            if (!b) return;
            drop.querySelectorAll('[data-wa-formality]').forEach((x) => x.classList.remove('aiext-wa-active'));
            b.classList.add('aiext-wa-active');
            if (!panelEl.querySelector('#aiext-wa-formality')) {
                const h = document.createElement('input');
                h.type = 'hidden';
                h.id = 'wa-formality';
                h.value = b.dataset.waFormality;
                panelEl.querySelector('.aiext-wa-panel-body').appendChild(h);
            } else panelEl.querySelector('#aiext-wa-formality').value = b.dataset.waFormality;
            saveSettings({
                language: panelEl.querySelector('#aiext-wa-language')?.value || 'auto',
                length: panelEl.querySelector('#aiext-wa-length')?.value || 'auto',
                formality: panelEl.querySelector('#aiext-wa-formality')?.value || 'auto',
                tone: panelEl.querySelector('#aiext-wa-tone')?.value || 'auto',
                format: panelEl.querySelector('#aiext-wa-format')?.value || 'auto'
            });
        });

        drop.querySelector('#aiext-wa-format-opts').addEventListener('click', (e) => {
            const b = e.target.closest('[data-wa-format]');
            if (!b) return;
            drop.querySelectorAll('[data-wa-format]').forEach((x) => x.classList.remove('aiext-wa-active'));
            b.classList.add('aiext-wa-active');
            if (!panelEl.querySelector('#aiext-wa-format')) {
                const h = document.createElement('input');
                h.type = 'hidden';
                h.id = 'wa-format';
                h.value = b.dataset.waFormat;
                panelEl.querySelector('.aiext-wa-panel-body').appendChild(h);
            } else panelEl.querySelector('#aiext-wa-format').value = b.dataset.waFormat;
            saveSettings({
                language: panelEl.querySelector('#aiext-wa-language')?.value || 'auto',
                length: panelEl.querySelector('#aiext-wa-length')?.value || 'auto',
                formality: panelEl.querySelector('#aiext-wa-formality')?.value || 'auto',
                tone: panelEl.querySelector('#aiext-wa-tone')?.value || 'auto',
                format: panelEl.querySelector('#aiext-wa-format')?.value || 'auto'
            });
        });

        drop.querySelector('#aiext-wa-tone-opts').addEventListener('click', (e) => {
            const b = e.target.closest('[data-wa-tone]');
            if (!b) return;
            drop.querySelectorAll('[data-wa-tone]').forEach((x) => x.classList.remove('aiext-wa-active'));
            b.classList.add('aiext-wa-active');
            if (!panelEl.querySelector('#aiext-wa-tone')) {
                const h = document.createElement('input');
                h.type = 'hidden';
                h.id = 'wa-tone';
                h.value = b.dataset.waTone;
                panelEl.querySelector('.aiext-wa-panel-body').appendChild(h);
            } else panelEl.querySelector('#aiext-wa-tone').value = b.dataset.waTone;
            saveSettings({
                language: panelEl.querySelector('#aiext-wa-language')?.value || 'auto',
                length: panelEl.querySelector('#aiext-wa-length')?.value || 'auto',
                formality: panelEl.querySelector('#aiext-wa-formality')?.value || 'auto',
                tone: panelEl.querySelector('#aiext-wa-tone')?.value || 'auto',
                format: panelEl.querySelector('#aiext-wa-format')?.value || 'auto'
            });
        });

        root.appendChild(drop);
        lengthFormatReposition = () => {
            const rect = btn.getBoundingClientRect();
            const margin = 12;
            const gap = 6;
            const dropWidth = Math.min(280, window.innerWidth - margin * 2);
            const left = Math.max(margin, Math.min(rect.left, window.innerWidth - dropWidth - margin));
            const belowTop = rect.bottom + gap;
            const belowSpace = Math.max(0, window.innerHeight - margin - belowTop);
            const aboveSpace = Math.max(0, rect.top - gap - margin);
            const desiredHeight = Math.min(drop.scrollHeight + 2, 320, window.innerHeight - margin * 2);
            const openAbove = belowSpace < desiredHeight && aboveSpace > belowSpace;
            const availableHeight = openAbove ? aboveSpace : belowSpace;
            const height = Math.max(0, Math.floor(Math.min(desiredHeight, availableHeight)));

            drop.style.left = left + 'px';
            drop.style.width = dropWidth + 'px';
            drop.style.top = (openAbove ? rect.top - gap - height : belowTop) + 'px';
            drop.style.setProperty('max-height', height + 'px', 'important');
        };
        lengthFormatReposition();
        window.addEventListener('resize', lengthFormatReposition);
        lengthFormatOpen = true;
    }

    function hideLengthFormatDropdown() {
        if (lengthFormatReposition) window.removeEventListener('resize', lengthFormatReposition);
        lengthFormatReposition = null;
        const el = getOrCreateRoot().querySelector('#aiext-wa-length-format-dropdown');
        if (el) el.remove();
        lengthFormatOpen = false;
    }

    function renderPageContext(panelEl) {
        const attached = pageContextAttached && !!currentPageContext;
        panelEl.querySelector('#aiext-wa-context-area').hidden=!attached;
        panelEl.querySelector('#aiext-wa-context-attach').hidden=attached;
        const title=panelEl.querySelector('#aiext-wa-context-title'),domain=panelEl.querySelector('#aiext-wa-context-domain');
        title.textContent=attached ? currentPageContext.pageTitle || currentPageContext.title : '';
        title.title=title.textContent;
        try{domain.textContent=attached ? new URL(currentPageContext.url).hostname : '';}catch(_){domain.textContent='';}
        const icon=panelEl.querySelector('#aiext-wa-context-favicon'),fallback=panelEl.querySelector('#aiext-wa-context-placeholder');
        icon.hidden=true;fallback.removeAttribute('hidden');
        icon.onerror=()=>{icon.hidden=true;fallback.removeAttribute('hidden');};
        if(attached&&currentPageContext.favIconUrl){icon.src=currentPageContext.favIconUrl;icon.hidden=false;fallback.setAttribute('hidden','');}
        else icon.removeAttribute('src');
    }

    function openPanel(field) {
        if (currentField === field && panel && !panel.classList.contains('aiext-wa-panel-hidden')) {
            focusPrompt(panel);
            return;
        }
        currentField = field;
        currentRequestId = null;
        currentSessionUsageCounted = false;
        currentPageContext = globalThis.SideAIPageContext?.capture(field) || null;
        pageContextAttached = true;
        const p = createPanel();
        renderPageContext(p);
        p.querySelector('#aiext-wa-generate').disabled = false;
        p.querySelector('#aiext-wa-result-area').classList.add('aiext-wa-hidden');
        p.querySelector('#aiext-wa-result-text').classList.remove('aiext-wa-loading-state');
        p.querySelector('#aiext-wa-error').style.display = 'none';
        p.querySelector('#aiext-wa-error').textContent = '';
        setPromptValue(p, '');
        p.querySelector('#aiext-wa-result-text').textContent = '';

        getSavedSettings().then((saved) => {
            applySavedSettingsToPanel(p, saved);
        });

        const rect = field.getBoundingClientRect();
        const panelWidth = Math.min(320, window.innerWidth - 20);
        let left = rect.right - panelWidth;
        let top = rect.top - 10;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        if (top + 360 > window.innerHeight - 10) top = Math.max(10, window.innerHeight - 370);

        p.classList.remove('aiext-wa-panel-hidden');
        p.style.position = 'fixed';
        p.style.left = left + 'px';
        p.style.top = top + 'px';
        p.style.right = 'auto';
        p.style.bottom = 'auto';
        if (!p.parentNode) getOrCreateRoot().appendChild(p);
        setTimeout(() => focusPrompt(p), 80);
    }

    function closePanel() {
        if (panel) {
            panel.classList.add('aiext-wa-panel-hidden');
            currentField = null;
            currentRequestId = null;
            currentSessionUsageCounted = false;
            currentPageContext = null;
        }
        hideLengthFormatDropdown();
        setTimeout(() => {
            const focusedField = resolveWritingField(getWritingActiveElement());
            if (!focusedField || focusedField !== activeDotInstance?.field) removeActiveDot();
        }, 0);
    }

    function replaceContentEditableContent(el, text) {
        const doc = el.ownerDocument;
        const win = doc.defaultView;
        el.focus();
        try {
            const sel = win.getSelection();
            const range = doc.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            if (doc.execCommand) {
                doc.execCommand('insertText', false, text);
            } else {
                el.textContent = text;
            }
        } catch (_) {
            el.textContent = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function insertAtCursor(el, text) {
        if (el.getAttribute('contenteditable') === 'true') {
            const doc = el.ownerDocument;
            const win = doc.defaultView;
            el.focus();
            const sel = win.getSelection();
            const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
            if (doc.execCommand && (!range || el.contains(range.commonAncestorContainer))) {
                doc.execCommand('insertText', false, text);
            } else {
                const textNode = doc.createTextNode(text);
                if (range && el.contains(range.commonAncestorContainer)) {
                    range.deleteContents();
                    range.insertNode(textNode);
                    range.setStartAfter(textNode);
                    range.setEndAfter(textNode);
                    sel.removeAllRanges();
                    sel.addRange(range);
                } else {
                    el.appendChild(textNode);
                }
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        if (typeof el.selectionStart !== 'number') {
            el.value += text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const val = el.value;
        el.value = val.slice(0, start) + text + val.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function buildPrompt(userPrompt, language, length, formality, tone, format) {
        const parts = [
            'You are a writing assistant. Your output must be ONLY the exact text the user will insert or use—nothing else.\n',
            'RULES: Do NOT add any introduction, preamble, or commentary. Do NOT say things like "Sure!", "Here\'s a response...", "Here is what you can send:", or similar. Do NOT use markdown headers, dashes, or labels. Output ONLY the raw content (e.g. the email body, the message, the paragraph) with no extra text before or after.\n'
        ];
        const constraints = [];
        if (language && language !== 'auto') constraints.push(`Write in ${language}.`);
        if (length && length !== 'auto' && LENGTH_DESC[length]) constraints.push(`LENGTH: ${LENGTH_DESC[length]}`);
        if (formality && formality !== 'auto' && FORMALITY_DESC[formality]) constraints.push(`FORMALITY: ${FORMALITY_DESC[formality]}`);
        if (tone && tone !== 'auto' && TONE_DESC[tone]) constraints.push(`TONE: ${TONE_DESC[tone]}`);
        if (format && format !== 'auto' && FORMAT_DESC[format]) constraints.push(`FORMAT: ${FORMAT_DESC[format]}`);
        if (constraints.length) parts.push('Apply these constraints exactly:\n' + constraints.map(c => '- ' + c).join('\n') + '\n\n');
        parts.push('User request: ');
        parts.push(userPrompt);
        return parts.join('');
    }

    function isAuthError(msg) {
        const lower = String(msg || '').toLowerCase();
        return lower.includes('login') || lower.includes('no access token') || lower.includes('401') || lower.includes('failed to get chat requirements');
    }

    function renderError(errEl, msg) {
        if (!errEl) return;
        if (isAuthError(msg)) {
            errEl.innerHTML = `<a href="https://chatgpt.com" target="_blank" rel="noopener">Please login to ChatGPT first</a> to use this feature.`;
        } else {
            errEl.textContent = msg;
        }
        errEl.style.display = 'block';
    }

    function doGenerate(panelEl) {
        if (panelEl.querySelector('#aiext-wa-generate')?.disabled) return;
        const promptInput = getPromptValue(panelEl).trim();
        if (!promptInput) return;

        const language = panelEl.querySelector('#aiext-wa-language').value;
        const length = (panelEl.querySelector('#aiext-wa-length') || {}).value || 'auto';
        const formality = (panelEl.querySelector('#aiext-wa-formality') || {}).value || 'auto';
        const tone = (panelEl.querySelector('#aiext-wa-tone') || {}).value || 'auto';
        const format = (panelEl.querySelector('#aiext-wa-format') || {}).value || 'auto';

        const fullPrompt = buildPrompt(promptInput, language, length, formality, tone, format)
            + (pageContextAttached && currentPageContext ? globalThis.SideAIPageContext?.payload(currentPageContext) || '' : '');
        const requestId = 'wa-' + Date.now() + '-' + Math.random().toString(36).slice(2);
        const noCountUsage = currentSessionUsageCounted;
        currentRequestId = requestId;
        currentBestResponseText = '';

        panelEl.querySelector('#aiext-wa-result-area').classList.remove('aiext-wa-hidden');
        panelEl.querySelector('#aiext-wa-error').style.display = 'none';
        panelEl.querySelector('#aiext-wa-error').textContent = '';
        panelEl.querySelector('#aiext-wa-generate').disabled = true;
        const resultText = panelEl.querySelector('#aiext-wa-result-text');
        resultText.textContent = '';
        resultText.innerHTML = '<span class="aiext-wa-spinner"></span><span>Generating...</span>';
        resultText.classList.add('aiext-wa-loading-state');

        const iframe = getOrCreateWaIframe();
        if (!iframe || !iframe.contentWindow) {
            panelEl.querySelector('#aiext-wa-result-area').classList.add('aiext-wa-hidden');
            panelEl.querySelector('#aiext-wa-result-text').textContent = '';
            panelEl.querySelector('#aiext-wa-result-text').classList.remove('aiext-wa-loading-state');
            panelEl.querySelector('#aiext-wa-generate').disabled = false;
            panelEl.querySelector('#aiext-wa-error').textContent = 'Extension context unavailable.';
            panelEl.querySelector('#aiext-wa-error').style.display = 'block';
            return;
        }
        const post = () => {
            try {
                if (currentRequestId !== requestId) return;
                if (!isExtensionContextValid()) {
                    showPostError('Extension context invalidated');
                    return;
                }
                let targetOrigin;
                try {
                    targetOrigin = chrome.runtime.getURL('/');
                } catch (_) {
                    showPostError('Extension context invalidated');
                    return;
                }
                if (!iframe.contentWindow) {
                    showPostError('Extension context unavailable.');
                    return;
                }
                debugLog(requestId || 'wa-ui-no-id', 'STREAM', 'writing-assistant.js:post', 'stream.waUiPostMessage', {
                    promptLength: typeof fullPrompt === 'string' ? fullPrompt.length : -1,
                    waIframeReady: !!waIframeReady,
                    hasContentWindow: !!iframe?.contentWindow
                });
                iframe.contentWindow.postMessage(
                    { type: 'WA_GENERATE', requestId, prompt: fullPrompt, noCountUsage },
                    targetOrigin
                );
            } catch (e) {
                showPostError((e && e.message) ? e.message : 'Failed to send request');
            }
        };
        const showPostError = (msg) => {
            try {
                const resultArea = panelEl.querySelector('#aiext-wa-result-area');
                const resultText = panelEl.querySelector('#aiext-wa-result-text');
                const genEl = panelEl.querySelector('#aiext-wa-generate');
                const errEl = panelEl.querySelector('#aiext-wa-error');
                if (resultArea) resultArea.classList.add('aiext-wa-hidden');
                if (resultText) { resultText.textContent = ''; resultText.classList.remove('aiext-wa-loading-state'); }
                if (genEl) genEl.disabled = false;
                renderError(errEl, msg);
            } catch (_) {}
        };
        if (waIframeReady) {
            post();
        } else {
            iframe.addEventListener('load', () => { waIframeReady = true; post(); }, { once: true });
        }
    }

    window.addEventListener('message', (event) => {
        try {
            const data = event.data;
            if (!data || data.type !== 'WA_RESPONSE' || !panel) return;
            if (data.requestId !== currentRequestId) return;
            if (waIframe && event.source !== waIframe.contentWindow) return;

            const panelEl = panel;
            const resultText = panelEl.querySelector('#aiext-wa-result-text');
            const resultArea = panelEl.querySelector('#aiext-wa-result-area');
            const errorEl = panelEl.querySelector('#aiext-wa-error');
            const generateBtn = panelEl.querySelector('#aiext-wa-generate');
            if (!resultText || !generateBtn) return;

            if (data.error) {
                logWaProgress(data.requestId || currentRequestId, 'stream.waUiError', {
                    error: data.error,
                    done: !!data.done
                });
                resultText.textContent = '';
                resultText.classList.remove('aiext-wa-loading-state');
                generateBtn.disabled = false;
                if (resultArea) resultArea.classList.add('aiext-wa-hidden');
                if (data.error === 'DAILY_LIMIT') {
                    closePanel();
                    if (isExtensionContextValid()) {
                        try {
                            chrome.runtime.sendMessage({ type: 'SHOW_UPGRADE_MODAL', resetTime: data.resetTime }, () => {});
                        } catch (_) {}
                    }
                } else if (errorEl) {
                    renderError(errorEl, data.error);
                }
                return;
            }

            if (data.text !== undefined && resultText) {
                const renderText = SideAIStreamText.stabilize(currentBestResponseText, data.text, data.done === true);
                currentBestResponseText = renderText;
                if (resultText.textContent !== renderText) {
                    const textNode = resultText.firstChild;
                    if (resultText.childNodes.length === 1 && textNode.nodeType === 3) textNode.nodeValue = renderText;
                    else resultText.textContent = renderText;
                }
                resultText.classList.remove('aiext-wa-loading-state');
                if (resultArea) resultArea.classList.remove('aiext-wa-hidden');
                resultText.scrollTop = resultText.scrollHeight;
                logWaProgress(data.requestId || currentRequestId, 'stream.waUiRendered', {
                    text: renderText,
                    textLength: renderText.length,
                    incomingTextLength: typeof data.text === 'string' ? data.text.length : 0,
                    textTail: debugTail(renderText),
                    done: !!data.done,
                    resultAreaHidden: !!resultArea?.classList?.contains('aiext-wa-hidden')
                });
            }
            if (data.done) {
                currentSessionUsageCounted = true;
                generateBtn.disabled = false;
                if (resultArea) resultArea.classList.remove('aiext-wa-hidden');
                if (!currentBestResponseText && !data.error) {
                    resultText.textContent = '';
                    resultText.classList.remove('aiext-wa-loading-state');
                }
                logWaProgress(data.requestId || currentRequestId, 'stream.waUiDone', {
                    done: true,
                    textLength: typeof data.text === 'string' ? data.text.length : resultText.textContent.length,
                    textTail: debugTail(typeof data.text === 'string' ? data.text : resultText.textContent)
                });
            }
        } catch (e) {
            debugLog(currentRequestId || 'wa-ui-no-id', 'STREAM', 'writing-assistant.js:message', 'stream.waUiMessageError', {
                error: e?.message || 'unknown',
                dataType: event?.data?.type || null,
                requestId: event?.data?.requestId || null
            });
        }
    });

    function attachDots() {
        getTextInputs().forEach((field) => {
            createDotAndTooltip(field);
        });
    }

    function init() {
        writingAssistantEnabled = false;
        if (!isExtensionContextValid()) return;
        if (isPaymentPage()) return;
        try {
            chrome.storage.sync.get([WA_DISABLED_SITES_KEY, WA_DISABLED_ALL_KEY], async (result) => {
                try {
                    if (!isExtensionContextValid()) return;
                    const disabledAll = !!(result && result[WA_DISABLED_ALL_KEY]);
                    const disabledSites = (result && result[WA_DISABLED_SITES_KEY]) || [];
                    const host = location.hostname || '';
                    if (disabledAll || (host && disabledSites.includes(host))) return;
                    const shortcuts = await readShortcutSettingsFromStorage();
                    textMenuShortcutKey = shortcuts.textMenuKey;
                    writingShortcutKey = shortcuts.writingAssistantKey;
                    writingAssistantEnabled = true;
                    document.removeEventListener('focusin', onFocusIn, true);
                    document.removeEventListener('focusout', onFocusOut, true);
                    document.removeEventListener('input', onWritingInputActivity, true);
                    document.removeEventListener('pointerdown', onWritingPointerDown, true);
                    document.addEventListener('focusin', onFocusIn, true);
                    document.addEventListener('focusout', onFocusOut, true);
                    document.addEventListener('input', onWritingInputActivity, true);
                    document.addEventListener('pointerdown', onWritingPointerDown, true);
                    showDotForFieldIfAllowed(resolveWritingField(getWritingActiveElement()));
                } catch (_) {}
            });
        } catch (_) {}
    }

    function showDotForFieldIfAllowed(field) {
        if (!field) return;
        ACTIVE_DOT_RETRY_DELAYS_MS.forEach((delay) => {
            setTimeout(() => {
                if (!isExtensionContextValid()) return;
                chrome.storage.sync.get([WA_DISABLED_ALL_KEY, WA_DISABLED_SITES_KEY], (r) => {
                    try {
                        if (!isExtensionContextValid()) return;
                        if (r && (r[WA_DISABLED_ALL_KEY] || ((r[WA_DISABLED_SITES_KEY] || []).includes(location.hostname)))) return;
                        const activeField = resolveWritingField(getWritingActiveElement());
                        const candidate = activeField && (activeField === field || getWritingActiveElement() === activeField)
                            ? activeField
                            : resolveWritingField(field);
                        if (!candidate || !candidate.isConnected) return;
                        writingAssistantEnabled = true;
                        showDotForField(candidate);
                    } catch (_) {}
                });
            }, delay);
        });
    }

    function onFocusIn(e) {
        showDotForFieldIfAllowed(resolveWritingField(e.composedPath?.()[0] || e.target));
    }

    function onWritingPointerDown(e) {
        showDotForFieldIfAllowed(resolveWritingField(e.composedPath?.()[0] || e.target));
        setTimeout(() => {
            showDotForFieldIfAllowed(resolveWritingField(getWritingActiveElement()) || resolveWritingField(e.composedPath?.()[0] || e.target));
        }, 0);
    }

    function onFocusOut(e) {
        const field = resolveWritingField(e.composedPath?.()[0] || e.target);
        if (!field || field !== activeDotInstance?.field) return;
        scheduleActiveDotRemoval(e.relatedTarget);
    }

    function onWritingInputActivity(e) {
        const field = resolveWritingField(e.composedPath?.()[0] || e.target);
        if (!field || !writingAssistantEnabled) return;
        showDotForField(field);
    }

    try {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            try {
                if (!isExtensionContextValid()) return;
                if (areaName !== 'sync') return;
                if (changes[WA_DISABLED_SITES_KEY] || changes[WA_DISABLED_ALL_KEY]) {
                    writingAssistantEnabled = false;
                    removeAllDotInstances();
                    init();
                }
                if (changes[SIDEAI_SHORTCUTS_KEY]) {
                    const shortcuts = normalizeShortcutSettings(changes[SIDEAI_SHORTCUTS_KEY]?.newValue);
                    textMenuShortcutKey = shortcuts.textMenuKey;
                    writingShortcutKey = shortcuts.writingAssistantKey;
                    refreshActiveDotShortcutLabel();
                }
            } catch (_) {}
        });
    } catch (_) {}

    try {
        chrome.runtime.onMessage.addListener((message) => {
            try {
                if (!isExtensionContextValid()) return;
                if (message?.type === 'sideai-shortcuts-updated' || message?.type === 'sideai-shortcut-updated') {
                    const shortcuts = normalizeShortcutSettings(message?.shortcuts || {
                        textMenuKey: message?.askAiKey,
                        writingAssistantKey: message?.askAiKey
                    });
                    textMenuShortcutKey = shortcuts.textMenuKey;
                    writingShortcutKey = shortcuts.writingAssistantKey;
                    refreshActiveDotShortcutLabel();
                }
            } catch (_) {}
        });
    } catch (_) {}

    document.addEventListener('keydown', event => {
        if (!SideAIShortcuts.matches(event, 'writingAssistant')) return;
        const el = resolveWritingField(event.composedPath?.()[0] || document.activeElement);
        if (!writingAssistantEnabled || !el) return;
        if (hasSelectedTextInWritingField(el) && SideAIShortcuts.matches(event, 'textMenu')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        showDotForField(el);
        openPanel(el);
    }, true);

    SideAIShortcuts.subscribe(refreshActiveDotShortcutLabel);
    SideAIShortcuts.ready.then(refreshActiveDotShortcutLabel);

    const INIT_DELAY_MS = 2500;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, INIT_DELAY_MS));
    } else {
        setTimeout(init, INIT_DELAY_MS);
    }
})();
