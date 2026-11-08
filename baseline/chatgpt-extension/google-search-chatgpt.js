// ==========================
// GOOGLE SEARCH CHATGPT SIDEBAR
// Uses iframe approach like the working extension
// ==========================

(function() {
    'use strict';

    // Only run on Google search results pages
    if (!window.location.hostname.includes('google.') || !window.location.pathname.includes('/search')) {
        return;
    }

    const STORAGE_KEY = 'googleChatgptEnabled';

    async function isEnabled() {
        try {
            const { [STORAGE_KEY]: enabled = true } = await chrome.storage.sync.get(STORAGE_KEY);
            return !!enabled;
        } catch (_) {
            return true;
        }
    }

    // Prevent multiple injections
    if (document.getElementById('chatgpt-google-sidebar')) {
        return;
    }

    // Get search query from URL (normalized for comparison)
    function getSearchQuery() {
        const urlParams = new URLSearchParams(window.location.search);
        const q = urlParams.get('q') || '';
        return q.trim();
    }

    // Create the sidebar UI with iframe - inside #rhs as first child, or after role="main" if #rhs doesn't exist
    function createSidebar() {
        const query = getSearchQuery();
        if (!query) return;

        // Avoid duplicate
        if (document.getElementById('chatgpt-google-sidebar')) return;

        const rhs = document.getElementById('rhs');
        const main = document.querySelector('[role="main"]');
        if (!rhs && !main) return;

        const urlParams = new URLSearchParams(window.location.search);
        const start = parseInt(urlParams.get('start') || '0', 10);
        const isPagination = start > 0;

        // Create sidebar container
        const sidebar = document.createElement('div');
        sidebar.id = 'chatgpt-google-sidebar';

        // Create iframe pointing to our extension page (add ||nobill when pagination = no usage increment)
        const hash = encodeURIComponent(query) + (isPagination ? '||nobill' : '');
        const iframe = document.createElement('iframe');
        iframe.id = 'chatgpt-google-iframe';
        iframe.src = chrome.runtime.getURL('google-chatgpt-frame.html') + '#' + hash;
        iframe.allow = 'clipboard-write';
        iframe.referrerPolicy = 'unsafe-url';
        
        sidebar.appendChild(iframe);

        // Inject styles
        injectStyles();
        attachFrameHeightListener();

        if (rhs) {
            // Insert as first (top) child of #rhs
            rhs.insertBefore(sidebar, rhs.firstChild);
        } else {
            // No #rhs: insert after role="main"
            main.parentNode.insertBefore(sidebar, main.nextSibling);
        }
    }

    // Inject CSS styles
    function injectStyles() {
        if (document.getElementById('chatgpt-google-sidebar-styles')) return;

        const styles = document.createElement('style');
        styles.id = 'chatgpt-google-sidebar-styles';
        styles.textContent = `
            #chatgpt-google-sidebar {
                grid-column: span 7 / -2;
                width: 100%;
                height: auto;
                min-height: 180px;
                max-height: calc(100vh - 220px);
                background: #ffffff;
                border: 1px solid #e0e0e0;
                border-radius: 12px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                overflow: hidden;
                margin-bottom: 16px;
            }

            #chatgpt-google-iframe {
                width: 100%;
                height: 260px;
                min-height: 180px;
                max-height: calc(100vh - 220px);
                border: none;
                border-radius: 12px;
                display: block;
            }

            @media (max-width: 1200px) {
                #chatgpt-google-sidebar {
                    display: none;
                }
            }
        `;
        document.head.appendChild(styles);
    }

    function attachFrameHeightListener() {
        if (window.__sideaiGoogleFrameHeightListenerAttached) return;
        window.__sideaiGoogleFrameHeightListenerAttached = true;
        window.addEventListener('message', (event) => {
            const data = event && event.data;
            if (!data || data.type !== 'SIDEAI_GOOGLE_FRAME_HEIGHT') return;
            const sidebar = document.getElementById('chatgpt-google-sidebar');
            const iframe = document.getElementById('chatgpt-google-iframe');
            if (!sidebar || !iframe || event.source !== iframe.contentWindow) return;
            const maxHeight = Math.max(220, window.innerHeight - 220);
            const requested = Number(data.height) || 260;
            const nextHeight = Math.max(180, Math.min(maxHeight, requested));
            const cssHeight = `${nextHeight}px`;
            if (sidebar.style.height !== cssHeight) sidebar.style.height = cssHeight;
            if (iframe.style.height !== cssHeight) iframe.style.height = cssHeight;
        });
    }

    function removeSidebar() {
        const sidebar = document.getElementById('chatgpt-google-sidebar');
        const styles = document.getElementById('chatgpt-google-sidebar-styles');
        if (sidebar) sidebar.remove();
        if (styles) styles.remove();
    }

    // Try to create sidebar (needs #rhs or role="main" to exist)
    function tryCreateSidebar() {
        if (document.getElementById('rhs') || document.querySelector('[role="main"]')) {
            createSidebar();
            return true;
        }
        return false;
    }

    // Initialize when DOM is ready; retry until #rhs or role="main" is present
    async function init() {
        if (!(await isEnabled())) {
            removeSidebar();
            return;
        }
        if (tryCreateSidebar()) return;
        let attempts = 0;
        const maxAttempts = 20;
        const interval = setInterval(async () => {
            attempts++;
            if (!(await isEnabled())) {
                clearInterval(interval);
                removeSidebar();
                return;
            }
            if (tryCreateSidebar() || attempts >= maxAttempts) {
                clearInterval(interval);
            }
        }, 250);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }

    // Handle URL changes (SPA navigation)
    // Only recreate when search query (q) changes – ignore pagination (start, page, etc.)
    let lastQuery = getSearchQuery();
    const checkQueryChange = () => {
        const query = getSearchQuery();
        if (query && query !== lastQuery) {
            lastQuery = query;
            removeSidebar();
            setTimeout(init, 500);
        }
    };

    const observer = new MutationObserver(checkQueryChange);
    observer.observe(document.body, { childList: true, subtree: true });

    // Poll for query changes (catches pushState when user does new search on same page)
    setInterval(checkQueryChange, 500);

    // Patch history.pushState/replaceState for immediate detection when user searches from bar
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function(...args) {
        origPush.apply(this, args);
        setTimeout(checkQueryChange, 50);
    };
    history.replaceState = function(...args) {
        origReplace.apply(this, args);
        setTimeout(checkQueryChange, 50);
    };

    // Handle setting changes
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[STORAGE_KEY]) {
            const enabled = !!changes[STORAGE_KEY].newValue;
            if (enabled) {
                setTimeout(init, 100);
            } else {
                removeSidebar();
            }
        }
    });
})();
