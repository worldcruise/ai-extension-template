const enableButton = document.getElementById('enableModern');
const keepButton = document.getElementById('keepCurrent');
const status = document.getElementById('status');
function setBusy(busy) {
    enableButton.disabled = busy;
    keepButton.disabled = busy;
}
function showError() {
    status.textContent = 'Your settings could not be saved. Please try again.';
    setBusy(false);
}
chrome.storage.local.get(['Settings'], function (data) {
    if (chrome.runtime.lastError || !data.Settings) {
        status.textContent = 'Unable to load your settings. Please reopen this page to try again.';
        return;
    }
    if (data.Settings.rangeHighlighting === true) {
        status.textContent = 'Modern highlighting is already enabled. You can close this tab.';
        return;
    }
    status.textContent = 'After enabling, reload your open pages to start fresh.';
    setBusy(false);
});
function saveChoice(enable) {
    setBusy(true);
    chrome.storage.local.get(['Settings'], function (data) {
        if (chrome.runtime.lastError || !data.Settings) { showError(); return; }
        const settings = data.Settings;
        if (enable) settings.rangeHighlighting = true;
        if (settings.rangeHighlightingNotice?.version === '6.3.14') {
            settings.rangeHighlightingNotice.pending = false;
        }
        chrome.storage.local.set({ Settings: settings }, function () {
            if (chrome.runtime.lastError) { showError(); return; }
            status.textContent = enable
                ? 'Modern highlighting is enabled! Reload your open pages to start fresh. You can now close this tab.'
                : 'Your highlighting setting is unchanged. You can enable Modern highlighting later in General settings. You can now close this tab.';
        });
    });
}
enableButton.addEventListener('click', () => saveChoice(true));
keepButton.addEventListener('click', () => saveChoice(false));
