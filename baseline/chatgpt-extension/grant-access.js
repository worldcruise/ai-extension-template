const grantBtn = document.getElementById('grantBtn');
const cancelBtn = document.getElementById('cancelBtn');
const statusEl = document.getElementById('status');

function setStatus(text, cls) {
    statusEl.textContent = text || '';
    statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

chrome.permissions.contains({ origins: ['<all_urls>'] }, (already) => {
    if (already) {
        setStatus('Access already granted. You can close this tab.', 'ok');
        grantBtn.textContent = 'Access granted';
        grantBtn.disabled = true;
    }
});

grantBtn.addEventListener('click', () => {
    setStatus('Requesting permission...');
    try {
        chrome.permissions.request({ origins: ['<all_urls>'] }, (granted) => {
            const err = chrome.runtime.lastError;
            if (err) {
                setStatus('Permission request failed: ' + err.message, 'err');
                return;
            }
            if (granted) {
                setStatus('Access granted. Reopening your screenshot...', 'ok');
                try {
                    chrome.runtime.sendMessage({ type: 'SCREENSHOT_AFTER_GRANT' });
                } catch (_) {}
                setTimeout(() => {
                    chrome.tabs.getCurrent((t) => {
                        if (t && t.id) chrome.tabs.remove(t.id);
                    });
                }, 500);
            } else {
                setStatus('Permission was not granted.', 'err');
            }
        });
    } catch (e) {
        setStatus('Unexpected error: ' + (e && e.message ? e.message : e), 'err');
    }
});

cancelBtn.addEventListener('click', () => {
    chrome.tabs.getCurrent((t) => {
        if (t && t.id) chrome.tabs.remove(t.id);
    });
});
