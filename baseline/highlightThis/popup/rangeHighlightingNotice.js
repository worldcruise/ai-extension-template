document.addEventListener('DOMContentLoaded', function () {
    const notice = document.getElementById('rangeUpdateNotice');
    const labels = {
        rangeUpdateTitle: 'range_update_title',
        rangeUpdateDescription: 'range_update_description',
        rangeUpdateSettings: 'range_update_settings',
        rangeUpdateDismiss: 'range_update_dismiss'
    };
    for (const [id, key] of Object.entries(labels)) {
        const text = chrome.i18n.getMessage(key);
        if (text) document.getElementById(id).textContent = text;
    }
    function refresh() {
        chrome.storage.local.get(['Settings'], function (data) {
            const settings = data.Settings;
            // The settings form saves its in-memory copy; keep dismissal in sync.
            if (typeof Settings !== 'undefined' && Settings && settings) {
                Settings.rangeHighlightingNotice = settings.rangeHighlightingNotice;
            }
            notice.hidden = chrome.runtime.getManifest().version !== '6.3.14' ||
                settings?.rangeHighlightingNotice?.version !== '6.3.14' ||
                !settings?.rangeHighlightingNotice?.pending || settings.rangeHighlighting === true;
        });
    }
    document.getElementById('rangeUpdateSettings').addEventListener('click', function () {
        showSettings();
        switchTab(document.getElementById('tabSettingsGeneral'), 'settingsGeneral', 'settings');
        document.getElementById('rangeHighlighting').focus();
    });
    document.getElementById('rangeUpdateDismiss').addEventListener('click', function () {
        // Read the latest settings to preserve changes made since the popup opened.
        chrome.storage.local.get(['Settings'], function (data) {
            const settings = data.Settings;
            if (!settings?.rangeHighlightingNotice) return;
            settings.rangeHighlightingNotice.pending = false;
            chrome.storage.local.set({ Settings: settings }, function () {
                if (!chrome.runtime.lastError) notice.hidden = true;
            });
        });
    });
    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.Settings) refresh();
    });
    refresh();
});
