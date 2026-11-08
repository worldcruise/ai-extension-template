importScripts('polar-config.js');
importScripts('sidepanel-session.js');
importScripts('chatgpt-auth.js');

const SIDEAI_UNINSTALL_SURVEY_URL = 'https://sideai.app/uninstall';

// Register on worker startup for both new installs and existing users after an update.
// Use a static URL: no license keys, browsing data, or user identifiers are appended.
chrome.runtime.setUninstallURL(SIDEAI_UNINSTALL_SURVEY_URL).catch(error => {
    console.warn('[Background] Could not register uninstall survey:', error);
});

let pendingScreenshotRetry = null;

// ==========================
// ACTION MAP + USAGE SYSTEM
// ==========================
const actionMap = {
    'copy': 'Copy',
    'continue': 'Continue this sentence',
    'read': 'Read',
    'improve': 'Improve this sentence',
    'summarize': 'Summarize this sentence',
    'explain': 'Explain this clearly',
    'answer': 'Answer this question',
    'fix': 'Fix this sentence',
    'translate': 'translate this sentence to',
    'compress': 'Compress this sentence',
    'shorter': 'shorter this sentence',
    'longer': 'longer this sentence'
};

const DEFAULT_TEXT_MENU_ITEM_IDS = new Set([
    'copy', 'improve', 'continue', 'explain', 'summarize',
    'answer', 'fix', 'translate', 'shorter', 'longer'
]);

function normalizeActionIds(ids = []) {
    const seen = new Set();
    return (Array.isArray(ids) ? ids : []).filter(id => {
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function normalizeMenuActionItems(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
        .filter(item => item && typeof item.id === 'string' && item.id.trim())
        .filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        })
        .map((item, index) => ({ ...item, order: index }));
}

async function normalizeTextMenuStorage() {
    const { menuItems = [], customItems = [], hiddenItems = [] } =
        await chrome.storage.sync.get(['menuItems', 'customItems', 'hiddenItems']);
    const combinedById = new Map();

    (Array.isArray(menuItems) ? menuItems : []).forEach(item => {
        if (item?.id) combinedById.set(item.id, item);
    });
    (Array.isArray(customItems) ? customItems : []).forEach(item => {
        if (item?.id) combinedById.set(item.id, item);
    });

    const normalizedItems = normalizeMenuActionItems(Array.from(combinedById.values()).sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB = b.order !== undefined ? b.order : Number.MAX_SAFE_INTEGER;
        return orderA - orderB;
    }));
    const normalizedHiddenItems = normalizeActionIds(hiddenItems);
    const defaultItems = normalizedItems.filter(item => DEFAULT_TEXT_MENU_ITEM_IDS.has(item.id));
    const userItems = normalizedItems.filter(item => !DEFAULT_TEXT_MENU_ITEM_IDS.has(item.id));

    const currentCount = (Array.isArray(menuItems) ? menuItems.length : 0) + (Array.isArray(customItems) ? customItems.length : 0);
    const needsCleanup =
        normalizedItems.length !== currentCount ||
        (Array.isArray(menuItems) ? menuItems : []).some(item => item?.id && !DEFAULT_TEXT_MENU_ITEM_IDS.has(item.id)) ||
        normalizedHiddenItems.length !== (Array.isArray(hiddenItems) ? hiddenItems.length : 0);

    if (needsCleanup) {
        await chrome.storage.sync.set({
            menuItems: defaultItems,
            customItems: userItems,
            hiddenItems: normalizedHiddenItems
        });
    }

    return { menuItems: normalizedItems, hiddenItems: normalizedHiddenItems };
}

// Polar license - see polar-config.js for setup
const POLAR_ORG_ID = (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.ORG_ID) || '12627443-7efd-432b-ac34-271c36f2a6b9';
const LICENSE_API_URL = (typeof POLAR_CONFIG !== 'undefined' && POLAR_CONFIG.LICENSE_API_URL) || 'https://kuohjwgaloxhtrckqwcq.supabase.co/functions/v1';

const SIDEAI_UTM_MEDIUM = 'chrome_extension';
const SIDEAI_UTM_CAMPAIGN = 'sideai_extension';

function buildSideAITrackedUrl(rawUrl, source) {
    if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
    try {
        const url = new URL(rawUrl);
        if (url.hostname !== 'sideai.app') return rawUrl;
        url.searchParams.set('utm_source', source);
        url.searchParams.set('utm_medium', SIDEAI_UTM_MEDIUM);
        url.searchParams.set('utm_campaign', SIDEAI_UTM_CAMPAIGN);
        return url.toString();
    } catch (_) {
        return rawUrl;
    }
}

const SIDEAI_UPDATE_NOTICE_VERSION = '6.0.1';
const SIDEAI_UPDATE_NOTICE_PREVIOUS_EQUIVALENTS = ['6.0.0'];
const SIDEAI_UPDATE_NOTICE_DETAILS_URL = buildSideAITrackedUrl('https://sideai.app/?utm_source=ext_update_notice_details&utm_medium=chrome_extension&utm_campaign=sideai_extension', 'ext_update_notice_details');
const SIDEAI_UPDATE_NOTICE_PENDING_KEY = 'sideai_update_notice_pending_version';
const SIDEAI_UPDATE_NOTICE_SHOWN_KEY = 'sideai_update_notice_shown_version';
const SIDEAI_UPDATE_NOTICE_DISMISSED_KEY = 'sideai_update_notice_dismissed_versions';
const SIDEAI_UPDATE_NOTICE_DISABLED_KEY = 'sideai_update_notice_disabled';
const SIDEAI_V6_FRESH_START_CUTOFF_VERSION = '6.0.0';

const TEXT_MENU_DAILY_LIMIT = 3;
const TEXT_MENU_STORAGE_KEY = 'usage_data';

const GOOGLE_SEARCH_DAILY_LIMIT = 10;
const GOOGLE_SEARCH_STORAGE_KEY = 'google_search_usage';

const WRITING_ASSISTANT_DAILY_LIMIT = 3;
const WRITING_ASSISTANT_STORAGE_KEY = 'writing_assistant_usage';

const SCREENSHOT_DAILY_LIMIT = 3;
const SCREENSHOT_STORAGE_KEY = 'screenshot_usage';

const SIDEPANEL_PAGE_DAILY_LIMIT = 3;
const SIDEPANEL_PAGE_STORAGE_KEY = 'sidepanel_page_usage';

// ==========================
// USAGE FUNCTIONS
// ==========================
const LICENSE_ACTIVATION_GRACE_MS = 60000;   // 1 min - trust activation, skip validate
const LICENSE_ON_USE_INTERVAL_MS = 60 * 1000;  // server check on any use, max 1x per 60s
const LICENSE_RENEWAL_GRACE_MS = 48 * 60 * 60 * 1000; // 48h grace for payment processing / offline
const _LICENSE_LAST_CHECK_KEY = '_license_last_check';
const _LICENSE_MIGRATION_DONE_KEY = 'sideai_v6_license_migration_done';
const SIDEAI_V6_FRESH_START_MIGRATION_KEY = 'sideai_v6_fresh_start_migration_done';
const LEGACY_GRANDFATHERED_LICENSE_HASH = '8d96431d4405508da45553885873136928e5ac1af378810c1655d1d2fb84590f';
const LEGACY_GRANDFATHERED_ACTIVATION_ID = 'legacy-grandfathered';
let _lastRenewalCheckReachedServer = true;

async function getVerifiedLicense() {
    await migrateStoredLicenseIfNeeded();
    await maybeValidateLicenseOnUse();
    const data = await chrome.storage.local.get(['license']);
    const license = data.license;
    if (!license) return null;
    if (typeof license === 'string') return null;
    const verified = await verifyLicenseIntegrity(license);
    if (!verified) {
        await chrome.storage.local.remove('license');
        return null;
    }
    if (verified.legacy === true) return verified;
    if (verified.expires_at && new Date(verified.expires_at) < new Date()) {
        const renewed = await _checkRenewalForExpiredLicense(verified, license);
        if (renewed) return renewed;

        const msSinceExpiry = Date.now() - new Date(verified.expires_at).getTime();
        if (!_lastRenewalCheckReachedServer && msSinceExpiry <= LICENSE_RENEWAL_GRACE_MS) {
            return verified;
        }
        await chrome.storage.local.remove('license');
        return null;
    }
    return verified;
}

async function _checkRenewalForExpiredLicense(verified, originalLicense) {
    if (verified?.legacy === true) return verified;
    _lastRenewalCheckReachedServer = false;
    if (!LICENSE_API_URL || LICENSE_API_URL.includes('YOUR-LICENSE')) return null;
    try {
        const sessionId = (verified.activation_id || await getSessionLabel());
        const r = await fetch(LICENSE_API_URL + '/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: verified.key,
                organization_id: POLAR_ORG_ID,
                session_id: sessionId,
            }),
        });
        const d = await r.json();
        _lastRenewalCheckReachedServer = true;
        if (d.valid) {
            const updated = { ...originalLicense };
            if (d.plan_type) updated.plan_type = d.plan_type;
            if (d.expires_at !== undefined) updated.expires_at = d.expires_at;
            await chrome.storage.local.set({ license: updated, [_LICENSE_LAST_CHECK_KEY]: Date.now() });
            const recheck = await verifyLicenseIntegrity(updated);
            if (recheck && (!recheck.expires_at || new Date(recheck.expires_at) >= new Date())) {
                return recheck;
            }
        }
    } catch (_) {}
    return null;
}

async function maybeValidateLicenseOnUse() {
    await migrateStoredLicenseIfNeeded();
    const data = await chrome.storage.local.get(['license', _LICENSE_LAST_CHECK_KEY]);
    const license = data.license;
    const lastCheckAt = (data[_LICENSE_LAST_CHECK_KEY] || 0);
    if (!license) return;
    if (typeof license === 'string') return;
    const verified = await verifyLicenseIntegrity(license);
    if (!verified) {
        await chrome.storage.local.remove('license');
        return;
    }
    if (verified.legacy === true) return;
    const now = Date.now();
    const activatedAt = (verified.ts || license?.ts || 0);
    if ((now - activatedAt) < LICENSE_ACTIVATION_GRACE_MS) return;
    if ((now - lastCheckAt) < LICENSE_ON_USE_INTERVAL_MS) return;
    if (!LICENSE_API_URL || LICENSE_API_URL.includes('YOUR-LICENSE')) return;
    try {
        await chrome.storage.local.set({ [_LICENSE_LAST_CHECK_KEY]: now });
        const sessionId = (verified.activation_id || await getSessionLabel());
        const r = await fetch(LICENSE_API_URL + '/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: verified.key,
                organization_id: POLAR_ORG_ID,
                session_id: sessionId,
            }),
        });
        const d = await r.json();
        if (!d.valid) {
            await chrome.storage.local.remove('license');
            await chrome.storage.local.remove(_LICENSE_LAST_CHECK_KEY);
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, { type: 'license-activated' }).catch(() => {}));
            });
        } else if (d.plan_type || d.expires_at !== undefined || d.legacy) {
            const updated = { ...license };
            if (d.plan_type) updated.plan_type = d.plan_type;
            if (d.expires_at !== undefined) updated.expires_at = d.expires_at;
            if (d.legacy) updated.legacy = true;
            await chrome.storage.local.set({ license: updated });
        }
    } catch (_) {}
}

// All non-search metered features share one serialized daily allowance.
const SHARED_USAGE_KEY = 'sideai_shared_daily_usage';
let sharedUsageQueue = Promise.resolve();
function withSharedUsageLock(operation) {
    const result = sharedUsageQueue.then(operation);
    sharedUsageQueue = result.catch(() => {});
    return result;
}
async function loadSharedUsageData() {
    const today = new Date().toDateString();
    const keys = [SHARED_USAGE_KEY, TEXT_MENU_STORAGE_KEY, WRITING_ASSISTANT_STORAGE_KEY, SCREENSHOT_STORAGE_KEY, SIDEPANEL_PAGE_STORAGE_KEY];
    const data = await chrome.storage.local.get(keys);
    const license = await getVerifiedLicense();
    let usage = data[SHARED_USAGE_KEY];
    if (!usage) {
        // One-time adoption: retain today's uses from v5 or separate-feature versions.
        const count = keys.slice(1).reduce((sum, key) => {
            const item = data[key];
            return sum + (item?.date === today ? Math.max(0, Math.floor(Number(item.count) || 0)) : 0);
        }, 0);
        usage = { date: today, count: Math.min(TEXT_MENU_DAILY_LIMIT, count) };
    }
    usage = {
        date: today,
        count: usage.date === today ? Math.min(TEXT_MENU_DAILY_LIMIT, Math.max(0, Math.floor(Number(usage.count) || 0))) : 0,
        isLicensed: !!license?.key
    };
    await chrome.storage.local.set({ [SHARED_USAGE_KEY]: usage });
    return usage;
}
function initUsageData() {
    return withSharedUsageLock(loadSharedUsageData);
}
async function checkSharedUsage(increment = false) {
    const auth = await checkSideAIAuthentication();
    if (!auth.allowed) return auth;
    return withSharedUsageLock(async () => {
        const usage = await loadSharedUsageData();
        const status = getScreenshotUsageStatus(usage);
        if (status.allowed && increment && !usage.isLicensed) {
            usage.count += 1;
            await chrome.storage.local.set({ [SHARED_USAGE_KEY]: usage });
            return { ...status, chargedDate: usage.date };
        }
        return status;
    });
}

async function getUsageData() {
    const usageData = await initUsageData();
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
        dailyUsage: usageData.count,
        isLicensed: usageData.isLicensed,
        resetTime: tomorrow.toISOString()
    };
}

function getDismissedUpdateVersions(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function hasSeenEquivalentUpdateNotice(shownVersion, dismissedVersions, currentVersion = SIDEAI_UPDATE_NOTICE_VERSION) {
    const equivalentVersions = [currentVersion, ...SIDEAI_UPDATE_NOTICE_PREVIOUS_EQUIVALENTS];
    return equivalentVersions.includes(shownVersion) ||
        equivalentVersions.some((version) => dismissedVersions.includes(version));
}

async function queueSideAIUpdateNotice(details) {
    if (!details || details.reason !== 'update') return;

    const currentVersion = chrome.runtime.getManifest().version;
    if (currentVersion !== SIDEAI_UPDATE_NOTICE_VERSION) return;

    const data = await chrome.storage.local.get([
        SIDEAI_UPDATE_NOTICE_DISABLED_KEY,
        SIDEAI_UPDATE_NOTICE_DISMISSED_KEY,
        SIDEAI_UPDATE_NOTICE_SHOWN_KEY
    ]);
    const dismissedVersions = getDismissedUpdateVersions(data[SIDEAI_UPDATE_NOTICE_DISMISSED_KEY]);

    if (data[SIDEAI_UPDATE_NOTICE_DISABLED_KEY]) return;
    if (hasSeenEquivalentUpdateNotice(data[SIDEAI_UPDATE_NOTICE_SHOWN_KEY], dismissedVersions, currentVersion)) return;

    await chrome.storage.local.set({
        [SIDEAI_UPDATE_NOTICE_PENDING_KEY]: currentVersion
    });
}

async function getSideAIUpdateNotice() {
    const data = await chrome.storage.local.get([
        SIDEAI_UPDATE_NOTICE_PENDING_KEY,
        SIDEAI_UPDATE_NOTICE_SHOWN_KEY,
        SIDEAI_UPDATE_NOTICE_DISMISSED_KEY,
        SIDEAI_UPDATE_NOTICE_DISABLED_KEY
    ]);
    const pendingVersion = data[SIDEAI_UPDATE_NOTICE_PENDING_KEY];
    const dismissedVersions = getDismissedUpdateVersions(data[SIDEAI_UPDATE_NOTICE_DISMISSED_KEY]);

    if (data[SIDEAI_UPDATE_NOTICE_DISABLED_KEY]) return { show: false };
    if (pendingVersion !== SIDEAI_UPDATE_NOTICE_VERSION) return { show: false };
    if (hasSeenEquivalentUpdateNotice(data[SIDEAI_UPDATE_NOTICE_SHOWN_KEY], dismissedVersions, pendingVersion)) return { show: false };

    return {
        show: true,
        version: pendingVersion,
        detailsUrl: SIDEAI_UPDATE_NOTICE_DETAILS_URL
    };
}

async function markSideAIUpdateNoticeShown(version) {
    const targetVersion = version || SIDEAI_UPDATE_NOTICE_VERSION;
    if (targetVersion !== SIDEAI_UPDATE_NOTICE_VERSION) return { ok: false };

    await chrome.storage.local.set({
        [SIDEAI_UPDATE_NOTICE_SHOWN_KEY]: targetVersion
    });
    await chrome.storage.local.remove(SIDEAI_UPDATE_NOTICE_PENDING_KEY);
    return { ok: true };
}

async function dismissSideAIUpdateNotice(version, disableNotifications = false) {
    const targetVersion = version || SIDEAI_UPDATE_NOTICE_VERSION;
    const data = await chrome.storage.local.get([SIDEAI_UPDATE_NOTICE_DISMISSED_KEY]);
    const dismissedVersions = getDismissedUpdateVersions(data[SIDEAI_UPDATE_NOTICE_DISMISSED_KEY]);

    if (!dismissedVersions.includes(targetVersion)) {
        dismissedVersions.push(targetVersion);
    }

    const nextState = {
        [SIDEAI_UPDATE_NOTICE_DISMISSED_KEY]: dismissedVersions,
        [SIDEAI_UPDATE_NOTICE_SHOWN_KEY]: targetVersion
    };

    if (disableNotifications) {
        nextState[SIDEAI_UPDATE_NOTICE_DISABLED_KEY] = true;
    }

    await chrome.storage.local.set(nextState);
    await chrome.storage.local.remove(SIDEAI_UPDATE_NOTICE_PENDING_KEY);
    return { ok: true };
}

async function getUsageDataForAll() {
    const [tm, google] = await Promise.all([
        initUsageData(),
        initGoogleSearchUsageData()
    ]);
    const wa = tm, screenshot = tm, sidepanelPage = tm;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const resetTime = tomorrow.toISOString();
    let planType = null;
    let expiresAt = null;
    if (tm.isLicensed) {
        const licData = await chrome.storage.local.get(['license']);
        if (licData.license) {
            planType = licData.license.plan_type || 'lifetime';
            expiresAt = licData.license.expires_at || null;
        }
    }
    return {
        isLicensed: tm.isLicensed,
        planType,
        expiresAt,
        resetTime,
        textMenu: { count: tm.count, limit: TEXT_MENU_DAILY_LIMIT },
        google: { count: google.count, limit: GOOGLE_SEARCH_DAILY_LIMIT },
        writingAssistant: { count: wa.count, limit: WRITING_ASSISTANT_DAILY_LIMIT },
        screenshot: { count: screenshot.count, limit: SCREENSHOT_DAILY_LIMIT },
        sidepanelPage: { count: sidepanelPage.count, limit: SIDEPANEL_PAGE_DAILY_LIMIT }
    };
}

function getDefaultUsageDataForAllResponse() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return {
        isLicensed: false,
        planType: null,
        expiresAt: null,
        resetTime: tomorrow.toISOString(),
        textMenu: { count: 0, limit: TEXT_MENU_DAILY_LIMIT },
        google: { count: 0, limit: GOOGLE_SEARCH_DAILY_LIMIT },
        writingAssistant: { count: 0, limit: WRITING_ASSISTANT_DAILY_LIMIT },
        screenshot: { count: 0, limit: SCREENSHOT_DAILY_LIMIT },
        sidepanelPage: { count: 0, limit: SIDEPANEL_PAGE_DAILY_LIMIT }
    };
}

/** Normalize hostname for blockedSites matching (www, scheme, case). */
function normalizeHost(value) {
    if (!value || typeof value !== 'string') return null;
    let host = value.trim().toLowerCase();
    host = host.replace(/^https?:\/\//, '').split('/')[0];
    host = host.replace(/^www\./, '');
    return host || null;
}

const LICENSE_INTEGRITY_SALT = 'sfchatgpt_2024_v1'; // Anti-tampering salt

async function hashForIntegrity(str) {
    try {
        const enc = new TextEncoder();
        const data = await crypto.subtle.digest('SHA-256', enc.encode(str));
        return Array.from(new Uint8Array(data)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (_) {
        return '';
    }
}

async function verifyLicenseIntegrity(license) {
    if (!license || typeof license !== 'object' || !license.key) return null;
    const storedHash = license._h;
    if (!storedHash) return license; // Legacy format without hash
    const toHash = license.key + '|' + (license.activation_id || '') + '|' + LICENSE_INTEGRITY_SALT;
    const expected = await hashForIntegrity(toHash);
    return !!(expected && storedHash === expected) ? license : null;
}

function normalizeLicenseCode(value) {
    return typeof value === 'string' ? value.trim() : '';
}

async function isGrandfatheredLegacyLicenseCode(code) {
    const normalized = normalizeLicenseCode(code).toLowerCase();
    if (!normalized) return false;
    const hash = await hashForIntegrity(normalized);
    return hash === LEGACY_GRANDFATHERED_LICENSE_HASH;
}

async function createStoredLicenseData(key, data = {}) {
    const inferredPlanType = data.plan_type || (data.expires_at ? 'monthly' : 'lifetime');
    const licenseData = {
        key,
        display_key: data.display_key || key,
        activation_id: data.activation_id || LEGACY_GRANDFATHERED_ACTIVATION_ID,
        plan_type: inferredPlanType,
        expires_at: data.expires_at || null,
        legacy: !!data.legacy,
        ts: Date.now(),
    };
    const toHash = licenseData.key + '|' + (licenseData.activation_id || '') + '|' + LICENSE_INTEGRITY_SALT;
    licenseData._h = await hashForIntegrity(toHash);
    return licenseData;
}

async function storeMigratedLicense(licenseData) {
    await chrome.storage.local.set({
        license: licenseData,
        [_LICENSE_MIGRATION_DONE_KEY]: Date.now(),
        [_LICENSE_LAST_CHECK_KEY]: Date.now(),
    });
    return licenseData;
}

async function migrateStoredLicenseIfNeeded() {
    const data = await chrome.storage.local.get(['license']);
    const existingLicense = data.license;
    if (!existingLicense || typeof existingLicense !== 'string') return null;

    const code = normalizeLicenseCode(existingLicense);
    if (!code) {
        await chrome.storage.local.remove('license');
        await chrome.storage.local.set({ [_LICENSE_MIGRATION_DONE_KEY]: Date.now() });
        return null;
    }

    if (await isGrandfatheredLegacyLicenseCode(code)) {
        const migrated = await createStoredLicenseData(code, {
            activation_id: LEGACY_GRANDFATHERED_ACTIVATION_ID,
            plan_type: 'lifetime',
            expires_at: null,
            legacy: true,
        });
        return storeMigratedLicense(migrated);
    }

    if (!LICENSE_API_URL || LICENSE_API_URL.includes('YOUR-LICENSE-SERVER')) return null;

    try {
        const label = await getSessionLabel();
        const res = await fetch(LICENSE_API_URL + '/validate-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: code,
                organization_id: POLAR_ORG_ID,
                label,
                force_takeover: false,
            }),
        });
        const result = await res.json();
        if (result.valid) {
            const migrated = await createStoredLicenseData(code, {
                display_key: result.display_key || code,
                activation_id: result.activation_id || label,
                plan_type: result.plan_type || (result.expires_at ? 'monthly' : 'lifetime'),
                expires_at: result.expires_at || null,
                legacy: !!result.legacy,
            });
            return storeMigratedLicense(migrated);
        }
        await chrome.storage.local.remove('license');
        await chrome.storage.local.set({ [_LICENSE_MIGRATION_DONE_KEY]: Date.now() });
    } catch (err) {
        console.warn('[License] Could not migrate saved license yet:', err);
    }
    return null;
}

function compareVersions(a, b) {
    const left = String(a || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const right = String(b || '').split('.').map((part) => Number.parseInt(part, 10) || 0);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        const diff = (left[i] || 0) - (right[i] || 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
}

function shouldRunV6FreshStartMigration(details) {
    if (!details || details.reason !== 'update') return false;
    const currentVersion = chrome.runtime.getManifest().version;
    if (currentVersion !== SIDEAI_UPDATE_NOTICE_VERSION) return false;
    return !details.previousVersion || compareVersions(details.previousVersion, SIDEAI_V6_FRESH_START_CUTOFF_VERSION) < 0;
}

function preserveStringList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

async function getLicenseForFreshStartMigration() {
    await migrateStoredLicenseIfNeeded();
    const { license } = await chrome.storage.local.get(['license']);
    if (!license || typeof license === 'string') return null;
    const verified = await verifyLicenseIntegrity(license);
    return verified ? { ...license } : null;
}

async function runV6FreshStartMigration(details) {
    // Lab updates preserve all existing preferences, sessions and license records.
    // The normal license migration still handles legacy license formats.
    return false;
}

async function getSessionLabel() {
    try {
        const id = chrome.runtime?.id || 'ext';
        const info = await chrome.storage.local.get(['_sid']);
        let sid = info._sid;
        if (!sid) {
            sid = id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
            await chrome.storage.local.set({ _sid: sid });
        }
        return sid;
    } catch (_) {
        return 'extension-' + Date.now();
    }
}

async function validateLicense(licenseCode, forceTakeover = false) {
    const code = (licenseCode || '').trim();
    if (!code) return { valid: false, message: 'Please enter a license code' };

    const apiUrl = LICENSE_API_URL;
    if (!apiUrl || apiUrl.includes('YOUR-LICENSE-SERVER')) {
        console.error('[License] LICENSE_API_URL not configured. Deploy license-server and set the URL.');
        return { valid: false, message: 'License service not configured. Please contact support.' };
    }

    try {
        const label = await getSessionLabel();
        const res = await fetch(apiUrl + '/validate-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                key: code,
                organization_id: POLAR_ORG_ID,
                label,
                force_takeover: !!forceTakeover,
            }),
        });
        const data = await res.json();

        if (data.valid) {
            const licenseData = await createStoredLicenseData(code, {
                display_key: data.display_key || code,
                activation_id: data.activation_id,
                plan_type: data.plan_type || (data.expires_at ? 'monthly' : 'lifetime'),
                expires_at: data.expires_at || null,
                legacy: !!data.legacy,
            });
            await chrome.storage.local.set({ license: licenseData });
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { type: 'license-activated' }).catch(() => {});
                });
            });
            return {
                valid: true,
                message: data.message || 'License activated successfully',
                display_key: data.display_key || code,
                previous_session_revoked: !!data.previous_session_revoked,
                plan_type: data.plan_type || (data.expires_at ? 'monthly' : 'lifetime'),
                expires_at: data.expires_at || null,
            };
        }
        return {
            valid: false,
            message: data.message || 'Invalid license code',
            in_use: !!data.in_use,
            expired: !!data.expired,
        };
    } catch (err) {
        console.error('[License] Validation error:', err);
        return { valid: false, message: 'Network error. Please try again.' };
    }
}

// Check if user can perform an action (optional: increment now or not)
// usageType: 'textMenu' | 'screenshot' - defaults to textMenu for backward compat
function checkUsage(options = {}) {
    const { increment = true, usageType = 'textMenu' } = typeof options === 'object' ? options : {};
    return checkSharedUsage(usageType === 'screenshot' ? false : increment);
}

// Increment usage count for text menu only
function incrementUsage() { return checkSharedUsage(true); }

// Writing Assistant usage (3/day)
function initWritingAssistantUsageData() { return initUsageData(); }

const writingUsageReservations = new Map();
async function checkWritingAssistantUsage(requestId) {
    const status = await checkSharedUsage(true);
    if (status.chargedDate) writingUsageReservations.set(requestId, status.chargedDate);
    return status;
}

function finishWritingUsage(requestId, failed) {
    const date = writingUsageReservations.get(requestId);
    writingUsageReservations.delete(requestId);
    if (!date || !failed) return Promise.resolve();
    return withSharedUsageLock(async () => {
        const usage = await loadSharedUsageData();
        if (usage.date === date && !usage.isLicensed) {
            usage.count = Math.max(0, usage.count - 1);
            await chrome.storage.local.set({ [SHARED_USAGE_KEY]: usage });
        }
    });
}

function incrementWritingAssistantUsage() { return Promise.resolve(); }

// Serialize screenshot reads and commits so options refreshes cannot overwrite a capture.
function withScreenshotUsageLock(operation) { return withSharedUsageLock(operation); }

function loadScreenshotUsageData() { return loadSharedUsageData(); }

function initScreenshotUsageData() {
    return withScreenshotUsageLock(loadScreenshotUsageData);
}

function getScreenshotUsageStatus(usageData) {
    if (usageData.isLicensed || usageData.count < SCREENSHOT_DAILY_LIMIT) return { allowed: true };
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return { allowed: false, resetTime: tomorrow.toISOString() };
}

async function checkScreenshotUsage() {
    return getScreenshotUsageStatus(await initScreenshotUsageData());
}

// Sidepanel page assistant usage (3/day)
function initSidepanelPageUsageData() { return initUsageData(); }

function checkSidepanelPageUsage(increment = true) { return checkSharedUsage(increment); }

// ==========================
// GOOGLE SEARCH USAGE (10/day on free tier)
// ==========================
async function initGoogleSearchUsageData() {
    const today = new Date().toDateString();
    const data = await chrome.storage.local.get([GOOGLE_SEARCH_STORAGE_KEY]);
    const license = await getVerifiedLicense();
    const usageData = data[GOOGLE_SEARCH_STORAGE_KEY] || {};

    if (usageData.date !== today) {
        usageData.date = today;
        usageData.count = 0;
    }
    usageData.isLicensed = !!(license && license.key);
    await chrome.storage.local.set({ [GOOGLE_SEARCH_STORAGE_KEY]: usageData });
    return usageData;
}

async function checkGoogleSearchUsage() {
    const usageData = await initGoogleSearchUsageData();
    if (usageData.isLicensed) return { allowed: true };

    if (usageData.count >= GOOGLE_SEARCH_DAILY_LIMIT) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return { allowed: false, resetTime: tomorrow.toISOString() };
    }
    return { allowed: true };
}

async function incrementGoogleSearchUsage() {
    const usageData = await initGoogleSearchUsageData();
    if (usageData.isLicensed) return;
    usageData.count++;
    await chrome.storage.local.set({ [GOOGLE_SEARCH_STORAGE_KEY]: usageData });
}

// ==========================
// MESSAGE HANDLERS
// ==========================

// Listen for the "sendToChatGPT" message (sync listener — async outer breaks MV3 sendResponse / return true)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'sendToChatGPT' && message.selectionText && message.action) {
        console.log('[Background] Message received:', message);
        void (async () => {
            try {
                console.log('[Background] Opening sidepanel...');
                let windowId = sender.tab?.windowId;
                if (windowId == null) {
                    try {
                        const w = await chrome.windows.getLastFocused();
                        if (w && w.id != null) windowId = w.id;
                    } catch (_) {}
                }
                if (windowId != null) {
                    try {
                        await chrome.sidePanel.open({ windowId });
                    } catch (e) {
                        if (!/user gesture/i.test(String(e?.message))) console.warn('[Background] sidePanel.open:', e);
                    }
                }
                console.log('[Background] Waiting for panel to open...');
                if (!sidePanelOpen) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                console.log('[Background] Waiting for connection...');
                const connected = await waitForSidepanelConnection(5000);
                if (connected) {
                    console.log('[Background] Connected! Sending text...');
                    let prompt = '';
                    if (message.action === 'translate') {
                        prompt = `${actionMap[message.action]} ${message.language}: ${message.selectionText}`;
                        console.log('[Background] Using translate prompt:', prompt);
                    } else if (actionMap[message.action]) {
                        prompt = `${actionMap[message.action]}: ${message.selectionText}`;
                        console.log('[Background] Using default action prompt:', prompt);
                    } else {
                        prompt = `${message.action}: ${message.selectionText}`;
                        console.log('[Background] Using custom prompt:', prompt);
                    }
                    const chunks = chunkText(prompt);
                    sendTextChunks(chunks);
                } else {
                    console.error('[Background] Failed to connect to sidepanel');
                }
            } catch (error) {
                console.error('[Background] Error:', error);
            }
        })();
        return;
    }
    if (message.type === 'openOptions' || message.type === 'switchOptionsTab') {
        void (async () => {
            await chrome.runtime.openOptionsPage();
            if (message.type === 'switchOptionsTab' && message.tab) {
                await new Promise(resolve => setTimeout(resolve, 500));
                const tabs = await chrome.tabs.query({});
                const optionsTab = tabs.find(tab => tab.url?.includes('chrome-extension://') && tab.url?.includes('/options/options.html'));
                if (optionsTab) {
                    await chrome.tabs.sendMessage(optionsTab.id, { type: 'switchOptionsTab', tab: message.tab });
                }
            }
        })();
        return;
    }
});

async function deliverScreenshotsToChatGPT(images) {
    if (!Array.isArray(images) || images.length === 0) return { success: false };
    const auth = await checkSideAIAuthentication();
    if (!auth.allowed) return { success: false, ...auth };
    return withScreenshotUsageLock(async () => {
        const usageData = await loadScreenshotUsageData();
        const status = getScreenshotUsageStatus(usageData);
        if (!status.allowed) return { success: false, limitReached: true, resetTime: status.resetTime };

        // One destination per capture. Never broadcast to both the sidebar and a tab.
        let delivered = false;
        if (sidebarPort) {
            try {
                sidebarPort.postMessage({ action: 'uploadScreenshots', images });
                delivered = true;
            } catch (error) {
                console.warn('[Background] Screenshot sidebar delivery failed:', error);
            }
        }
        if (!delivered) {
            const tabs = await chrome.tabs.query({ url: ['*://chatgpt.com/*', '*://chat.openai.com/*'] });
            if (!tabs.length) return { success: false, error: 'Open the sidepanel and try again.' };
            const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'UPLOAD_SCREENSHOTS', images });
            if (!response?.success) return { success: false, error: 'Screenshot delivery failed.' };
        }
        // The third completed capture is allowed; only subsequent captures are blocked.
        if (!usageData.isLicensed) {
            usageData.count = Math.min(SCREENSHOT_DAILY_LIMIT, usageData.count + 1);
            await chrome.storage.local.set({ [SHARED_USAGE_KEY]: usageData });
        }
        return { success: true };
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'openOptionsPage') {
        chrome.runtime.openOptionsPage();
    } else if (request.type === 'sendToChatGPT') {
        console.log('Background: Received sendToChatGPT request:', request);

        // Function to handle sending the message
        const sendMessage = () => {
            chrome.tabs.query({ url: 'https://chat.openai.com/*' }, (tabs) => {
                console.log('Background: Found ChatGPT tabs:', tabs);
                if (tabs.length > 0) {
                    console.log('Background: Sending to existing ChatGPT tab');
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'sendPrompt',
                        text: request.selectionText,
                        prompt: request.action
                    }).catch(() => {});
                } else {
                    console.log('Background: No ChatGPT tab found, sending to panel');
                    chrome.runtime.sendMessage({
                        action: 'sendPrompt',
                        text: request.selectionText,
                        prompt: request.action
                    }).catch(() => {});
                }
            });
        };

        const windowId = sender.tab && sender.tab.windowId != null ? sender.tab.windowId : null;
        const doOpenAndSend = (wid) => {
            if (wid == null) {
            setTimeout(sendMessage, 1000);
                return;
            }
            // sidePanel.open() requires user gesture - only succeeds from context menu; content-menu sends async so gesture is lost
            const openPromise = chrome.sidePanel.open({ windowId: wid }).catch((e) => {
                if (!/user gesture/i.test(String(e?.message))) console.warn('Background: sidePanel.open:', e);
            });
            chrome.sidePanel.setOptions({ path: 'sidepanel/index.html' })
                .then(() => openPromise)
                .then(() => setTimeout(sendMessage, 1000))
                .catch(() => setTimeout(sendMessage, 1000));
        };
        if (windowId != null) {
            doOpenAndSend(windowId);
        } else {
            chrome.windows.getLastFocused().then((w) => doOpenAndSend(w && w.id != null ? w.id : null));
        }
    }
    if (request.action === 'getConversations') {
        getConversations(request.offset, request.limit)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Will respond asynchronously
    }
    if (request.action === 'fetchFromChatGPT') {
        fetchFromChatGPT(request.url, request.options)
            .then(response => sendResponse({ success: true, ...response }))
            .catch(error => sendResponse({ 
                success: false, 
                error: error.message,
                stack: error.stack
            }));
        return true; // Will respond asynchronously
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'SIDEAI_GET_ACTIVE_PAGE_CONTEXT') {
        (async () => {
            const tab = await getSideAIActiveTab();
            if (!tab) {
                sendResponse({ success: false, error: 'No active tab found.' });
                return;
            }
            const context = await getSideAIVisibleTextForTab(tab);
            sendResponse({ success: true, tab: serializeSideAIPageTab(tab, true), context });
        })().catch((err) => {
            console.error('[Background] SIDEAI_GET_ACTIVE_PAGE_CONTEXT error:', err);
            sendResponse({ success: false, error: err?.message || 'Unable to get active page.' });
        });
        return true;
    } else if (request.type === 'SIDEAI_GET_OPEN_PAGE_TABS') {
        getSideAIOpenPageTabs(sender.tab?.windowId, request.metadataOnly === true)
            .then((tabs) => sendResponse({ success: true, tabs }))
            .catch((err) => {
                console.error('[Background] SIDEAI_GET_OPEN_PAGE_TABS error:', err);
                sendResponse({ success: false, tabs: [], error: err?.message || 'Unable to get tabs.' });
            });
        return true;
    } else if (request.type === 'SIDEAI_GET_PAGE_CONTEXTS') {
        (async () => {
            const requestedIds = Array.isArray(request.tabIds) ? request.tabIds.map(Number).filter(Number.isFinite) : [];
            const activeTab = await getSideAIActiveTab();
            const tabs = requestedIds.length
                ? await Promise.all(requestedIds.map((id) => chrome.tabs.get(id).catch(() => null)))
                : [activeTab];
            const contexts = await Promise.all(tabs.filter(Boolean).map(getSideAIVisibleTextForTab));
            const readableContexts = contexts.filter((context) => context && context.available && context.text);
            sendResponse({
                success: true,
                contexts: readableContexts
            });
        })().catch((err) => {
            console.error('[Background] SIDEAI_GET_PAGE_CONTEXTS error:', err);
            sendResponse({ success: false, contexts: [], error: err?.message || 'Unable to get page context.' });
        });
        return true;
    } else if (request.type === 'checkUsage') {
        const opts = request.usageType ? { ...request, usageType: request.usageType } : request;
        checkUsage(opts)
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] checkUsage error:', err);
                sendResponse({ allowed: false });
            });
        return true;
    } else if (request.type === 'incrementScreenshotUsage') {
        // Older content scripts must not count the same capture a second time.
        sendResponse({ ok: true });
        return true;
    } else if (request.type === 'getUsageData') {
        getUsageData()
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] getUsageData error:', err);
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                sendResponse({ dailyUsage: 0, isLicensed: false, resetTime: tomorrow.toISOString() });
            });
        return true;
    } else if (request.type === 'sidepanelOpened') {
        Promise.all([
            rememberSideAIContextWindowId(),
            maybeValidateLicenseOnUse()
        ])
            .then(() => sendResponse({ ok: true }))
            .catch((err) => {
                console.error('[Background] sidepanelOpened / maybeValidateLicenseOnUse:', err);
                sendResponse({ ok: true });
            });
        return true;
    } else if (request.type === 'getSideAIUpdateNotice') {
        getSideAIUpdateNotice()
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] getSideAIUpdateNotice error:', err);
                sendResponse({ show: false });
            });
        return true;
    } else if (request.type === 'markSideAIUpdateNoticeShown') {
        markSideAIUpdateNoticeShown(request.version)
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] markSideAIUpdateNoticeShown error:', err);
                sendResponse({ ok: false });
            });
        return true;
    } else if (request.type === 'dismissSideAIUpdateNotice') {
        dismissSideAIUpdateNotice(request.version, !!request.disableNotifications)
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] dismissSideAIUpdateNotice error:', err);
                sendResponse({ ok: false });
            });
        return true;
    } else if (request.type === 'getUsageDataForAll') {
        getUsageDataForAll()
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] getUsageDataForAll error:', err);
                sendResponse(getDefaultUsageDataForAllResponse());
            });
        return true;
    } else if (request.type === 'validateLicense') {
        validateLicense(request.licenseCode, request.forceTakeover)
            .then(sendResponse)
            .catch((err) => {
                console.error('[Background] validateLicense error:', err);
                sendResponse({ valid: false, message: 'License validation failed' });
            });
        return true;
    } else if (request.type === 'openOptions') {
        chrome.runtime.openOptionsPage(() => {
            // If a specific section is requested, send a message to the options page
            if (request.section) {
                setTimeout(() => {
                    chrome.runtime.sendMessage({ type: 'switchOptionsTab', tab: request.section });
                }, 500); // Increased timeout to ensure options page is fully loaded
            }
        });
        sendResponse({ success: true });
        return true;
    } else if (request.type === 'openRatingPage') {
        // Open Chrome Web Store rating page
        chrome.tabs.create({ 
            url: 'https://chromewebstore.google.com/detail/sidebar-for-chatgpt-free/hcjmcpfahioghphbgfokmijhkccofkci/reviews' 
        });
        sendResponse({ success: true });
        return true;
    } else if (request.type === 'SHOW_UPGRADE_MODAL') {
        // Keep the offer with the feature that reached its allowance, even if
        // the user switched tabs while ChatGPT was responding.
        (async()=>{
            try{
                let tabId=sender.tab?.id;
                if(tabId==null){const focused=await chrome.windows.getLastFocused({populate:true});tabId=focused?.tabs?.find(tab=>tab.active)?.id;}
                if(tabId==null){sendResponse({success:false});return;}
                const response=await chrome.tabs.sendMessage(tabId,{
                    type:'SHOW_UPGRADE_MODAL',resetTime:request.resetTime,upgradeRequestId:request.upgradeRequestId
                },{frameId:sender.tab ? sender.frameId || 0 : 0});
                sendResponse({success:response?.success===true});
            }catch(_){sendResponse({success:false});}
        })();
        return true;
    } else if (request.type === 'openExternalUrl' && request.url) {
        chrome.tabs.create({ url: request.url }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Background] Failed to open external URL:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    } else if (request.type === 'OPEN_GRANT_PAGE') {
        // Open the grant page so the user can call chrome.permissions.request
        // with a real user gesture from within an extension page.
        chrome.windows.getLastFocused({ populate: true }, (win) => {
            const activeTab = win?.tabs?.find(t => t.active);
            if (activeTab?.id) {
                pendingScreenshotRetry = { tabId: activeTab.id, windowId: win.id };
            } else {
                pendingScreenshotRetry = null;
            }
            chrome.tabs.create({ url: chrome.runtime.getURL('grant-access.html') }, () => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ success: true });
                }
            });
        });
        return true;
    } else if (request.type === 'SCREENSHOT_AFTER_GRANT') {
        // Called by grant-access.js after the user grants <all_urls>. Re-open
        // the screenshot capture overlay on the original tab.
        const pending = pendingScreenshotRetry;
        pendingScreenshotRetry = null;
        if (!pending) {
            sendResponse({ success: false, error: 'No pending screenshot' });
            return true;
        }
        chrome.windows.update(pending.windowId, { focused: true }, () => {
            chrome.tabs.update(pending.tabId, { active: true }, () => {
                chrome.tabs.sendMessage(pending.tabId, { type: 'SHOW_SCREENSHOT_GRANTED' })
                    .catch(() => {});

                const start = () => {
                    chrome.tabs.sendMessage(pending.tabId, {
                        type: 'START_CAPTURE',
                        windowId: pending.windowId
                    }, (response) => {
                        if (chrome.runtime.lastError) {
                            console.error('[Background] retry START_CAPTURE failed:', chrome.runtime.lastError.message);
                            return;
                        }
                        if (response && response.success && response.images && response.images.length > 0) {
                            deliverScreenshotsToChatGPT(response.images).catch(error => {
                                console.error('[Background] Screenshot retry delivery failed:', error);
                            });
                        }
                    });
                };

                chrome.tabs.sendMessage(pending.tabId, { type: 'PING_SCREENSHOT_CAPTURE' }, (pong) => {
                    if (chrome.runtime.lastError || !pong) {
                        chrome.scripting.executeScript({
                            target: { tabId: pending.tabId },
                            files: ['screenshot-capture.js']
                        }, () => {
                            if (chrome.runtime.lastError) return;
                            setTimeout(start, 150);
                        });
                        return;
                    }
                    start();
                });
            });
        });

        sendResponse({ success: true });
        return true;
    } else if (request.type === 'REQUEST_SCREENSHOT') {
        // Handle screenshot capture request from screenshot capture UI.
        // If <all_urls> is not granted, show the same page-level hint flow as
        // the reference version instead of prompting from inside ChatGPT.
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            const activeTab = tabs?.[0];
            if (!activeTab || !activeTab.id) {
                console.error('[Background] REQUEST_SCREENSHOT: no active tab');
                sendResponse(null);
                return;
            }

            chrome.tabs.captureVisibleTab(activeTab.windowId, { format: 'png' }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    const errMsg = chrome.runtime.lastError.message || '';
                    console.error('[Background] captureVisibleTab failed:', errMsg);
                    if (/permission|all_urls|host/i.test(errMsg)) {
                        chrome.tabs.sendMessage(activeTab.id, { type: 'SHOW_SCREENSHOT_HINT' }).catch(() => {});
                    }
                    sendResponse(null);
                    return;
                }
                sendResponse(dataUrl);
            });
        });
        return true; // Will send response asynchronously
    } else if (request.type === 'START_SCREENSHOT_CAPTURE') {
        // Start screenshot capture.
        // Note: Without broad host permissions, tab.url may be undefined for
        // pages outside declared hosts. Target the active tab and let Chrome
        // decide whether the content script can run.
        chrome.windows.getLastFocused({ populate: true }, (win) => {
            if (chrome.runtime.lastError || !win) {
                sendResponse({ success: false, error: 'No window found' });
                return;
            }

            const activeTab = win.tabs?.find(tab => tab.active);

            if (!activeTab || !activeTab.id) {
                sendResponse({ success: false, error: 'No active tab found for screenshot' });
                return;
            }

            console.log('[Background] Starting screenshot capture on tab:', activeTab.id, activeTab.url || '(url unavailable without tabs permission)');

            const targetWindowId = win.id;
            const targetTabId = activeTab.id;

            let captureResponseHandled = false;
            const forwardResponse = (response) => {
                if (captureResponseHandled) return;
                captureResponseHandled = true;
                if (response && response.success && response.images && response.images.length > 0) {
                    deliverScreenshotsToChatGPT(response.images).then(sendResponse).catch(error => {
                        console.error('[Background] Screenshot delivery failed:', error);
                        sendResponse({ success: false, error: 'Screenshot delivery failed.' });
                    });
                } else {
                    sendResponse(response || { success: false, error: 'Capture cancelled' });
                }
            };

            const sendStartCapture = () => {
                chrome.tabs.sendMessage(targetTabId, {
                    type: 'START_CAPTURE',
                    windowId: targetWindowId
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] Error starting capture:', chrome.runtime.lastError.message);
                        sendResponse({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    forwardResponse(response);
                });
            };

            chrome.tabs.sendMessage(targetTabId, { type: 'PING_SCREENSHOT_CAPTURE' }, (pong) => {
                if (chrome.runtime.lastError || !pong) {
                    console.log('[Background] Content script not present, trying dynamic injection');
                    chrome.scripting.executeScript({
                        target: { tabId: targetTabId },
                        files: ['screenshot-capture.js']
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('[Background] Dynamic injection failed:', chrome.runtime.lastError.message);
                            sendResponse({ success: false, error: 'Please open the sidepanel on this tab first using the toolbar icon, then try again.' });
                            return;
                        }
                        setTimeout(sendStartCapture, 150);
                    });
                    return;
                }
                sendStartCapture();
            });
        });
        return true; // Will send response asynchronously
    }
});

// ==========================
// UPDATE / BADGE SYSTEM
// ==========================
// Open 'What's New' page on first install
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        try {
            await chrome.tabs.create({ url: buildSideAITrackedUrl('https://sideai.app/?utm_source=ext_first_install&utm_medium=chrome_extension&utm_campaign=sideai_extension', 'ext_first_install') });
        } catch (e) {
            console.error('[Background] Failed to open first-install page:', e);
        }
    }
});

// DISABLED: Update badge functionality - will be re-enabled later
/*
async function showNewBadge() {
    console.log('[Background] Setting NEW badge and storing state');
    await chrome.storage.local.set({ hasUnseenUpdate: true });
    await chrome.action.setBadgeText({ text: 'NEW' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
    await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function clearBadge() {
    console.log('[Background] Clearing NEW badge and storing state');
    await chrome.storage.local.set({ hasUnseenUpdate: false });
    await chrome.action.setBadgeText({ text: '' });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function getHasUnseenUpdate() {
    const result = await chrome.storage.local.get(['hasUnseenUpdate']);
    return result.hasUnseenUpdate || false;
}

// Restore badge state on service worker startup
async function restoreBadgeState() {
    const hasUnseenUpdate = await getHasUnseenUpdate();
    console.log('[Background] Restoring badge state, hasUnseenUpdate:', hasUnseenUpdate);
    
    if (hasUnseenUpdate) {
        // Restore the NEW badge
        await chrome.action.setBadgeText({ text: 'NEW' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
        await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    } else {
        // Ensure side panel opens on click
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
}

// Restore badge state when service worker starts
restoreBadgeState();
*/

// ==========================
// ICON CLICK HANDLER
// ==========================
chrome.action.onClicked.addListener(async (tab) => {
    // DISABLED: Update badge click handler - will be re-enabled later
    /*
    const hasUnseenUpdate = await getHasUnseenUpdate();
    console.log('[Background] Icon clicked, hasUnseenUpdate:', hasUnseenUpdate);
    
    if (hasUnseenUpdate) {
        console.log('[Background] Opening what\'s new page...');
        try {
            await chrome.tabs.create({ url: buildSideAITrackedUrl('https://sideai.app/?utm_source=ext_action_badge_update_page&utm_medium=chrome_extension&utm_campaign=sideai_extension', 'ext_action_badge_update_page') });
            await clearBadge();
        } catch (error) {
            console.error('[Background] Error opening update page:', error);
            // Clear badge anyway to prevent stuck state
            await clearBadge();
        }
        return;
    }
    */
    
    console.log('[Background] Side panel will open automatically');
});

// ==========================
// INSTALLATION HANDLER
// ==========================
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[Background] Extension installed/updated');
    await normalizeTextMenuStorage();
    const didFreshStartMigration = await runV6FreshStartMigration(details);
    if (!didFreshStartMigration) {
        await migrateStoredLicenseIfNeeded();
    }
    await queueSideAIUpdateNotice(details);
    
    // DISABLED: Update badge on update - will be re-enabled later
    /*
    if (details.reason === 'update') {
        await showNewBadge();
    } else {
    */
        // For new installs, enable side panel immediately
    if (details.reason === 'install') {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
    // }

    // Create context menu
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({
        id: 'openChatGPTSidebar',
        title: 'Open ChatGPT sidebar',
        contexts: ['page', 'selection', 'link', 'image', 'video', 'audio', 'editable', 'frame']
    }, () => {
        if (chrome.runtime.lastError)
            console.error('[Background] Open sidebar context menu error:', chrome.runtime.lastError);
    });
    chrome.contextMenus.create({
        id: 'sendToChatGPT',
        title: 'Summarize with ChatGPT',
        contexts: ['selection']
    }, () => {
        if (chrome.runtime.lastError)
            console.error('[Background] Context menu error:', chrome.runtime.lastError);
    });

    // Setup side panel registration
    await chrome.sidePanel.setOptions({ path: "sidepanel/index.html", enabled: true });
    console.log('[Background] Side panel registered');
});

chrome.runtime.onStartup.addListener(() => {
    normalizeTextMenuStorage().catch(error => {
        console.warn('[Background] Failed to normalize text menu storage on startup:', error);
    });
});

normalizeTextMenuStorage().catch(error => {
    console.warn('[Background] Failed to normalize text menu storage:', error);
});

// ==========================
// SIDE PANEL + CONTEXT MENU
// ==========================
let sidebarPort = null;
let sidePanelOpen = false;

function chunkText(text, maxLength = 5000) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength)
        chunks.push(text.slice(i, i + maxLength));
    return chunks;
}

function sendTextChunks(chunks) {
    if (!sidebarPort) return;
    chunks.forEach((chunk, i) => {
        setTimeout(() => {
            sidebarPort?.postMessage({
                action: 'summarizeText',
                prompt: chunk,
                chunkIndex: i,
                totalChunks: chunks.length
            });
        }, i * 100);
    });
}

async function waitForSidepanelConnection(maxWait = 5000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            if (sidebarPort) resolve(true);
            else if (Date.now() - start > maxWait) resolve(false);
            else setTimeout(check, 100);
        };
        check();
    });
}

function isSideAIContextEligibleTab(tab) {
    if (!tab || !tab.id) return false;
    const url = tab.url || '';
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    if (/^https?:\/\/([^/]+\.)?(chatgpt\.com|chat\.openai\.com)\//i.test(url)) return false;
    return true;
}

function serializeSideAIPageTab(tab, isCurrent = false) {
    return {
        id: tab.id,
        windowId: tab.windowId,
        title: tab.title || '',
        url: tab.url || '',
        favIconUrl: tab.favIconUrl || '',
        active: !!tab.active,
        current: !!isCurrent
    };
}

let sideAIContextWindowId = null;

async function rememberSideAIContextWindowId(windowId = null) {
    if (Number.isFinite(windowId)) {
        sideAIContextWindowId = windowId;
        return sideAIContextWindowId;
    }
    try {
        const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
        if (Number.isFinite(win?.id)) sideAIContextWindowId = win.id;
    } catch (_) {}
    return sideAIContextWindowId;
}

async function getSideAIActiveTab(preferredWindowId = null) {
    const windowId = Number.isFinite(preferredWindowId) ? preferredWindowId : sideAIContextWindowId;
    if (Number.isFinite(windowId)) {
        const tabs = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
        if (tabs && tabs[0]) return tabs[0];
    }
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    if (tabs && tabs[0]) {
        sideAIContextWindowId = tabs[0].windowId;
        return tabs[0];
    }
    return null;
}

async function getSideAIVisibleTextForTab(tab) {
    if (!isSideAIContextEligibleTab(tab)) {
        return {
            ...serializeSideAIPageTab(tab, !!tab?.active),
            text: '',
            available: false,
            error: 'This page cannot be used as context.'
        };
    }

    const runFallbackExtraction = async () => {
        const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [0] },
            func: () => {
                const visibleText = (() => {
                    if (!document.body) return '';

                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: (node) => {
                                const parent = node.parentElement;
                                if (!parent) return NodeFilter.FILTER_REJECT;
                                if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.tagName === 'NOSCRIPT') {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                const cs = getComputedStyle(parent);
                                if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
                                return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                            }
                        }
                    );

                    let text = '';
                    let node;
                    while ((node = walker.nextNode())) {
                        text += node.textContent.trim() + ' ';
                    }
                    return text.trim();
                })();

                return {
                    title: document.title || '',
                    url: location.href || '',
                    text: visibleText
                };
            }
        });

        return {
            ...serializeSideAIPageTab(tab, !!tab.active),
            title: result?.title || tab.title || '',
            url: result?.url || tab.url || '',
            favIconUrl: tab.favIconUrl || '',
            text: result?.text || '',
            available: !!(result && result.text)
        };
    };

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'getVisibleTextForSidepanelAssistant' }, { frameId: 0 });
        if (response?.text) {
            return {
                ...serializeSideAIPageTab(tab, !!tab.active),
                title: response?.title || tab.title || '',
                url: response?.url || tab.url || '',
                favIconUrl: response?.favIconUrl || tab.favIconUrl || '',
                text: response?.text || '',
                available: true
            };
        }

        const fallbackResult = await runFallbackExtraction();
        if (fallbackResult.available) return fallbackResult;

        return {
            ...serializeSideAIPageTab(tab, !!tab.active),
            title: fallbackResult.title || response?.title || tab.title || '',
            url: fallbackResult.url || response?.url || tab.url || '',
            favIconUrl: response?.favIconUrl || tab.favIconUrl || '',
            text: '',
            available: false,
            error: 'Unable to read visible text from this page.'
        };
    } catch (error) {
        try {
            return await runFallbackExtraction();
        } catch (fallbackError) {
            const errorMessage = fallbackError?.message || error?.message || 'Unable to read this page.';
            return {
                ...serializeSideAIPageTab(tab, !!tab.active),
                text: '',
                available: false,
                error: errorMessage
            };
        }
    }
}

async function getSideAIOpenPageTabs(preferredWindowId = null, metadataOnly = false) {
    const activeTab = await getSideAIActiveTab(preferredWindowId);
    const query = Number.isFinite(activeTab?.windowId)
        ? { windowId: activeTab.windowId }
        : (Number.isFinite(sideAIContextWindowId) ? { windowId: sideAIContextWindowId } : { lastFocusedWindow: true });
    const tabs = await chrome.tabs.query(query);
    const eligibleTabs = tabs.filter(isSideAIContextEligibleTab);
    if (metadataOnly) return eligibleTabs.map(tab => serializeSideAIPageTab(tab, tab.id === activeTab?.id));
    const contexts = await Promise.all(eligibleTabs.map(getSideAIVisibleTextForTab));
    return contexts
        .filter((context) => context && context.available && context.text)
        .map((context) => ({
            id: context.id,
            windowId: context.windowId,
            title: context.title || '',
            url: context.url || '',
            favIconUrl: context.favIconUrl || '',
            active: !!context.active,
            current: !!activeTab && context.id === activeTab.id
        }));
}

async function notifySidepanelActivePageChanged() {
    if (!sidebarPort) return;
    try {
        const activeTab = await getSideAIActiveTab();
        const serializedTab = isSideAIContextEligibleTab(activeTab)
            ? serializeSideAIPageTab(activeTab, true)
            : null;
        sidebarPort.postMessage({
            action: 'sideaiActivePageChanged',
            tab: serializedTab
        });
    } catch (error) {
        console.warn('[Background] Failed to notify sidepanel active page:', error);
    }
}

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel') {
        sidebarPort = port;
        sidePanelOpen = true;
        rememberSideAIContextWindowId().then(() => notifySidepanelActivePageChanged());
        port.onDisconnect.addListener(() => {
            sidePanelOpen = false;
            sidebarPort = null;
        });
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    if (Number.isFinite(activeInfo?.windowId)) sideAIContextWindowId = activeInfo.windowId;
    notifySidepanelActivePageChanged();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!sidebarPort) return;
    if (!tab.active) return;
    if (Number.isFinite(tab?.windowId)) sideAIContextWindowId = tab.windowId;
    if (changeInfo.url || changeInfo.title || changeInfo.status === 'complete') {
        notifySidepanelActivePageChanged();
    }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'openChatGPTSidebar') {
        if (!Number.isInteger(tab?.windowId)) return;
        try {
            // Open directly during the click gesture; do not wait for other work first.
            await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch (error) {
            console.warn('[Background] Unable to open sidebar from context menu:', error);
        }
        return;
    }
    if (info.menuItemId === 'sendToChatGPT' && info.selectionText) {
        try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch (e) {
            if (!/user gesture/i.test(String(e?.message))) console.warn('[Background] sidePanel.open:', e);
        }
        await new Promise(r => setTimeout(r, 2000));
        const connected = await waitForSidepanelConnection(5000);
        if (connected) {
            const chunks = chunkText(info.selectionText);
            sendTextChunks(chunks);
        }
    }
});

// ==========================
// CHATGPT API HELPERS
// ==========================
async function fetchChatGPT(endpoint, options = {}) {
    const baseUrl = 'https://chatgpt.com/backend-api';
    const url = `${baseUrl}/${endpoint}`;
    const defaultHeaders = {
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Origin": "https://chatgpt.com",
        "Referer": "https://chatgpt.com/"
    };
    const config = {
        ...options,
        headers: { ...defaultHeaders, ...options.headers },
        credentials: 'include'
    };
    const response = await fetch(url, config);
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    return await response.json();
}

async function getConversations(offset = 0, limit = 28) {
    return await fetchChatGPT(`conversations?offset=${offset}&limit=${limit}&order=updated`);
}

async function fetchFromChatGPT(url, options = {}) {
    const headers = {
        "Host": "chatgpt.com",
        "Accept": "*/*",
        "Content-Type": "application/json",
        "Origin": "https://chatgpt.com",
        "Referer": "https://chatgpt.com/",
        ...options.headers
    };
    const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
        mode: 'cors'
    });
    const text = await response.text();
    return {
        status: response.status,
        text,
        headers: Object.fromEntries(response.headers.entries())
    };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getConversations') {
        getConversations(request.offset, request.limit)
            .then(data => sendResponse({ success: true, data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
    if (request.action === 'fetchFromChatGPT') {
        fetchFromChatGPT(request.url, request.options)
            .then(response => sendResponse({ success: true, ...response }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});

const MIC_PERMISSION_PROMPT_URL = chrome.runtime.getURL('permission_prompt.html');
const MIC_PERMISSION_PROMPT_REUSE_MS = 60000;

function notifyMicrophonePermissionResult(status, details = {}) {
    const type = status === 'granted' ? 'mic-permission-granted' : 'mic-permission-denied';

    chrome.storage.local.get(['voiceRequestTab', 'voiceRequestIds'], (result) => {
        const requestIds = Array.isArray(result.voiceRequestIds) ? result.voiceRequestIds : [];
        const payload = {
            type,
            requestIds,
            error: details.error
        };

        if (result.voiceRequestTab) {
            chrome.tabs.sendMessage(result.voiceRequestTab, payload).catch((error) => {
                console.log('[Background] Could not notify tab:', error);
            });
        }

        if (sidebarPort) {
            try {
                sidebarPort.postMessage({
                    action: 'micPermissionResult',
                    status,
                    requestIds,
                    error: details.error
                });
            } catch (error) {
                console.log('[Background] Could not notify sidepanel:', error);
            }
        }

        chrome.storage.local.remove([
            'voiceRequestTab',
            'voiceRequestIds',
            'voiceRequestTime',
            'voicePromptTab'
        ]);
    });
}

function openMicrophonePermissionPrompt(sendResponse) {
    chrome.tabs.create({
        url: MIC_PERMISSION_PROMPT_URL,
        active: true
    }, (tab) => {
        chrome.storage.local.set({ voicePromptTab: tab.id });
        sendResponse({
            status: 'Permission prompt opened in new tab',
            promptTabId: tab.id
        });
    });
}

// Voice mode message handling (sync listener — keep return true only when sendResponse is async)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'request-mic-access') {
        console.log('[Background] Microphone access requested from:', sender.tab?.id);

        const requestId = message.requestId || null;
        const now = Date.now();

        chrome.storage.local.get(['voiceRequestIds', 'voicePromptTab', 'voiceRequestTime'], (result) => {
            const requestIds = Array.isArray(result.voiceRequestIds) ? result.voiceRequestIds : [];
            if (requestId && !requestIds.includes(requestId)) requestIds.push(requestId);

            // Store the tab ID that requested permission when available. Sidepanel
            // requests are also relayed through the long-lived sidepanel port.
            chrome.storage.local.set({
                voiceRequestTab: sender.tab?.id || null,
                voiceRequestIds: requestIds,
                voiceRequestTime: now,
                voiceRequestSource: message.source || null
            }, () => {
                if (result.voicePromptTab && now - (result.voiceRequestTime || 0) < MIC_PERMISSION_PROMPT_REUSE_MS) {
                    chrome.tabs.get(result.voicePromptTab, (tab) => {
                        if (!chrome.runtime.lastError && tab) {
                            chrome.tabs.update(result.voicePromptTab, { active: true });
                            if (tab.windowId && chrome.windows?.update) {
                                chrome.windows.update(tab.windowId, { focused: true });
                            }
                            sendResponse({
                                status: 'Permission prompt already open',
                                promptTabId: result.voicePromptTab
                            });
                            return;
                        }

                        openMicrophonePermissionPrompt(sendResponse);
                    });
                    return;
                }

                openMicrophonePermissionPrompt(sendResponse);
            });
        });

        return true; // Keep channel open
    } 
    else if (message.type === 'mic-permission-granted') {
        console.log('[Background] Microphone permission granted by user');

        notifyMicrophonePermissionResult('granted');
        sendResponse({ status: 'Permission broadcasted' });
        return;
    } 
    else if (message.type === 'mic-permission-denied') {
        console.error('[Background] Microphone permission denied:', message.error);

        notifyMicrophonePermissionResult('denied', { error: message.error });
        sendResponse({ status: 'Denial broadcasted' });
        return;
    }
    else if (message.type === 'open-login') {
        chrome.tabs.create({ url: message.url });
        sendResponse({ status: 'Login tab opened' });
        return; // synchronous response; do not keep the port open
    }
    
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'check-disabled-state') {
        chrome.storage.sync.get(['blockedSites', 'globalDisabled']).then(({ blockedSites = [], globalDisabled = false }) => {
            let disabled = !!globalDisabled;
            if (!disabled) {
                let host = null;
                try {
                    host = normalizeHost(message.host || (sender.tab?.url ? new URL(sender.tab.url).hostname : null));
                } catch (e) { /* ignore */ }
                if (host) {
                    disabled = blockedSites.some((site) => {
                        const normalizedSite = normalizeHost(site);
                        return normalizedSite ? (host === normalizedSite || host.endsWith('.' + normalizedSite)) : false;
                    });
                }
            }
            sendResponse({ disabled });
        }).catch((e) => {
            console.log('[Background] check-disabled-state error:', e);
            sendResponse({ disabled: false });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'disable-site') {
        let host = normalizeHost(message.host || null);
        if (!host && sender.tab?.url) {
            try { host = normalizeHost(new URL(sender.tab.url).hostname); } catch (e) { /* ignore */ }
        }
        chrome.storage.sync.get(['blockedSites']).then(({ blockedSites = [] }) => {
            if (host) {
                const set = new Set(blockedSites.map((site) => normalizeHost(site)).filter(Boolean));
                set.add(host);
                return chrome.storage.sync.set({ blockedSites: Array.from(set) });
            }
        }).then(() => {
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'extension-state-changed', disabled: true }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] disable-site error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'enable-site') {
        const siteToEnable = normalizeHost(message.site);
        chrome.storage.sync.get(['blockedSites']).then(({ blockedSites = [] }) => {
            if (!siteToEnable) return;
            const filteredSites = blockedSites.filter((site) => normalizeHost(site) !== siteToEnable);
            return chrome.storage.sync.set({ blockedSites: filteredSites });
        }).then(() => {
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'extension-state-changed', disabled: false }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] enable-site error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'disable-all') {
        chrome.storage.sync.set({ globalDisabled: true }).then(() => {
            // Notify the current tab so UI hides immediately
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'extension-state-changed', disabled: true }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] disable-all error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'enable-all') {
        chrome.storage.sync.set({ globalDisabled: false }).then(() => {
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'extension-state-changed', disabled: false }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] enable-all error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    // Handle text menu disable messages
    if (message.type === 'disable-text-menu-site') {
        let host = message.host || null;
        if (!host && sender.tab?.url) {
            try { host = new URL(sender.tab.url).hostname; } catch (e) { /* ignore */ }
        }
        chrome.storage.sync.get(['blockedTextMenuSites']).then(({ blockedTextMenuSites = [] }) => {
            if (host) {
                const set = new Set(blockedTextMenuSites);
                set.add(host);
                return chrome.storage.sync.set({ blockedTextMenuSites: Array.from(set) });
            }
        }).then(() => {
            // Notify the current tab so text menu hides immediately
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'text-menu-state-changed', disabled: true }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] disable-text-menu-site error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'disable-text-menu-all') {
        chrome.storage.sync.set({ globalTextMenuDisabled: true }).then(() => {
            // Notify the current tab so text menu hides immediately
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'text-menu-state-changed', disabled: true }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] disable-text-menu-all error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    // Handle text menu enable messages
    if (message.type === 'enable-text-menu-site') {
        const site = message.site;
        chrome.storage.sync.get(['blockedTextMenuSites']).then(({ blockedTextMenuSites = [] }) => {
            const filteredSites = blockedTextMenuSites.filter(s => s !== site);
            return chrome.storage.sync.set({ blockedTextMenuSites: filteredSites });
        }).then(() => {
            // Notify the current tab so text menu shows immediately
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'text-menu-state-changed', disabled: false }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] enable-text-menu-site error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    if (message.type === 'enable-text-menu-all') {
        chrome.storage.sync.set({ globalTextMenuDisabled: false }).then(() => {
            // Notify the current tab so text menu shows immediately
            if (sender.tab?.id) {
                chrome.tabs.sendMessage(sender.tab.id, { type: 'text-menu-state-changed', disabled: false }).catch(() => {});
            }
            sendResponse({ success: true });
        }).catch((e) => {
            console.log('[Background] enable-text-menu-all error:', e);
            sendResponse({ success: false, error: e?.message });
        });
        return true; // respond asynchronously
    }

    // Handle menu order updates
    if (message.type === 'menuOrderUpdated') {
        (async () => {
            try {
                const defaultMenuItemIds = new Set([
                    'copy', 'improve', 'continue', 'explain', 'summarize',
                    'answer', 'fix', 'translate', 'shorter', 'longer'
                ]);
                const seenItems = new Set();
                const normalizedItems = (Array.isArray(message.menuItems) ? message.menuItems : [])
                    .filter(item => item && typeof item.id === 'string' && item.id.trim())
                    .filter(item => {
                        if (seenItems.has(item.id)) return false;
                        seenItems.add(item.id);
                        return true;
                    })
                    .map((item, index) => ({ ...item, order: index }));
                const seenHidden = new Set();
                const hiddenItems = (Array.isArray(message.hiddenItems) ? message.hiddenItems : [])
                    .filter(id => {
                        if (!id || seenHidden.has(id)) return false;
                        seenHidden.add(id);
                        return true;
                    });

                // Keep storage split: defaults in menuItems, user-created actions in customItems.
                await chrome.storage.sync.set({
                    menuItems: normalizedItems.filter(item => defaultMenuItemIds.has(item.id)),
                    customItems: normalizedItems.filter(item => !defaultMenuItemIds.has(item.id)),
                    hiddenItems
                });
                
                // Notify all tabs about the menu order update
                const tabs = await chrome.tabs.query({});
                for (const tab of tabs) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, { 
                            type: 'menuOrderChanged', 
                            menuItems: normalizedItems,
                            hiddenItems
                        });
                    } catch (error) {
                        // Ignore errors for tabs that don't have the content script
                    }
                }
                
                sendResponse({ success: true });
            } catch (error) {
                console.error('[Background] Error updating menu order:', error);
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true; // respond asynchronously
    }
});

// ==========================
// CHATGPT BACKEND API FOR GOOGLE SEARCH
// ==========================
const CHATGPT_BASE_URL = 'https://chatgpt.com';

// Generate fresh device ID for EACH request - working extension does this!
// Looking at HAR: each request (chat-requirements, conversation) has DIFFERENT device IDs
function getDeviceId() {
    // Generate a new UUID for each call - matching working extension behavior
    return generateUUID();
}

// Generate UUID for messages
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Generate fingerprint data for p parameter and proof token
// Matches working extension HAR: first element 11982, script path background.js, exact strings
function generateFingerprintArray(scriptPath) {
    const now = new Date();
    const timeString = now.toString();
    const userAgent = navigator?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
    const perfNow = typeof performance !== 'undefined' ? performance.now() : Math.random() * 5000;
    
    // Working extension decoded from HAR: 11982 (not 12114), appName-Netscape, _reactListening+suffix, ondevicemotion
    const randomIndex = Math.floor(Math.random() * 30);
    const navigatorProps = [
        'appName-Netscape',
        'storageBuckets-[object StorageBucketManager]',
        'login-[object NavigatorLogin]'
    ];
    const reactSuffix = () => {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = '';
        for (let i = 0; i < 11; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    };
    const functionNames = ['ondevicemotion', 'onemptied', 'onloadedmetadata'];
    
    return [
        11982,  // Working extension uses 11982 (decoded from HAR)
        timeString,
        4294967296,
        0,  // Nonce - replaced during PoW
        userAgent,
        scriptPath,
        null,
        'en-US',
        'en-US,en,ar',
        randomIndex,
        navigatorProps[Math.floor(Math.random() * navigatorProps.length)],
        '_reactListening' + reactSuffix(),
        functionNames[Math.floor(Math.random() * functionNames.length)],
        perfNow,
        ''
    ];
}

// Encode fingerprint with proper prefix (6-byte gAAAAAC/gAAAAABW format matching working extension)
function encodeFingerprintPayload(fingerprintArray, isProofToken = false) {
    const jsonStr = JSON.stringify(fingerprintArray);
    
    // CRITICAL: Working extension uses 6-byte prefix, NOT 5 bytes!
    // Decoded from working HAR:
    // - p parameter: gAAAAACW = [0x80, 0x00, 0x00, 0x00, 0x00, 0x96]
    // - proof token: gAAAAABW = [0x80, 0x00, 0x00, 0x00, 0x00, 0x56]
    const prefixByte = isProofToken ? 0x56 : 0x96;
    const prefix = new Uint8Array([0x80, 0x00, 0x00, 0x00, 0x00, prefixByte]);
    
    const jsonBytes = new TextEncoder().encode(jsonStr);
    
    const combined = new Uint8Array(prefix.length + jsonBytes.length);
    combined.set(prefix);
    combined.set(jsonBytes, prefix.length);
    
    // Standard base64 (OpenAI expects this in headers)
    let binary = '';
    for (let i = 0; i < combined.length; i++) {
        binary += String.fromCharCode(combined[i]);
    }
    return btoa(binary);
}

// js-sha3 library (MIT License) - used for proof-of-work
// Based on the same library used by the working extension
const jsSha3 = (function() {
    'use strict';
    
    const HEX_CHARS = '0123456789abcdef'.split('');
    const KECCAK_PADDING = [1, 256, 65536, 16777216];
    const SHA3_PADDING = [6, 1536, 393216, 100663296];
    const SHIFT = [0, 8, 16, 24];
    const RC = [
        1, 0, 32898, 0, 32906, 2147483648, 2147516416, 2147483648,
        32907, 0, 2147483649, 0, 2147516545, 2147483648, 32777, 2147483648,
        138, 0, 136, 0, 2147516425, 0, 2147483658, 0,
        2147516555, 0, 139, 2147483648, 32905, 2147483648, 32771, 2147483648,
        32770, 2147483648, 128, 2147483648, 32778, 0, 2147483658, 2147483648,
        2147516545, 2147483648, 32896, 2147483648, 2147483649, 0, 2147516424, 2147483648
    ];
    
    function Keccak(bits, padding, outputBits) {
        this.blocks = [];
        this.s = [];
        this.padding = padding;
        this.outputBits = outputBits;
        this.reset = true;
        this.finalized = false;
        this.block = 0;
        this.start = 0;
        this.blockCount = (1600 - (bits << 1)) >> 5;
        this.byteCount = this.blockCount << 2;
        this.outputBlocks = outputBits >> 5;
        this.extraBytes = (outputBits & 31) >> 3;
        for (let i = 0; i < 50; ++i) {
            this.s[i] = 0;
        }
    }
    
    Keccak.prototype.update = function(message) {
        if (this.finalized) return;
        
        let isString = typeof message === 'string';
        let blocks = this.blocks;
        let byteCount = this.byteCount;
        let length = message.length;
        let blockCount = this.blockCount;
        let index = 0;
        let s = this.s;
        let i, code;
        
        while (index < length) {
            if (this.reset) {
                this.reset = false;
                blocks[0] = this.block;
                for (i = 1; i < blockCount + 1; ++i) {
                    blocks[i] = 0;
                }
            }
            if (isString) {
                for (i = this.start; index < length && i < byteCount; ++index) {
                    code = message.charCodeAt(index);
                    if (code < 0x80) {
                        blocks[i >> 2] |= code << SHIFT[i++ & 3];
                    } else if (code < 0x800) {
                        blocks[i >> 2] |= (0xc0 | (code >> 6)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    } else if (code < 0xd800 || code >= 0xe000) {
                        blocks[i >> 2] |= (0xe0 | (code >> 12)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    } else {
                        code = 0x10000 + (((code & 0x3ff) << 10) | (message.charCodeAt(++index) & 0x3ff));
                        blocks[i >> 2] |= (0xf0 | (code >> 18)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 12) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | ((code >> 6) & 0x3f)) << SHIFT[i++ & 3];
                        blocks[i >> 2] |= (0x80 | (code & 0x3f)) << SHIFT[i++ & 3];
                    }
                }
            } else {
                for (i = this.start; index < length && i < byteCount; ++index) {
                    blocks[i >> 2] |= message[index] << SHIFT[i++ & 3];
                }
            }
            this.lastByteIndex = i;
            if (i >= byteCount) {
                this.start = i - byteCount;
                this.block = blocks[blockCount];
                for (i = 0; i < blockCount; ++i) {
                    s[i] ^= blocks[i];
                }
                keccakF(s);
                this.reset = true;
            } else {
                this.start = i;
            }
        }
        return this;
    };
    
    Keccak.prototype.finalize = function() {
        if (this.finalized) return;
        this.finalized = true;
        let blocks = this.blocks;
        let i = this.lastByteIndex;
        let blockCount = this.blockCount;
        let s = this.s;
        blocks[i >> 2] |= this.padding[i & 3];
        if (this.lastByteIndex === this.byteCount) {
            blocks[0] = blocks[blockCount];
            for (i = 1; i < blockCount + 1; ++i) {
                blocks[i] = 0;
            }
        }
        blocks[blockCount - 1] |= 0x80000000;
        for (i = 0; i < blockCount; ++i) {
            s[i] ^= blocks[i];
        }
        keccakF(s);
    };
    
    Keccak.prototype.hex = function() {
        this.finalize();
        let blockCount = this.blockCount;
        let s = this.s;
        let outputBlocks = this.outputBlocks;
        let extraBytes = this.extraBytes;
        let i = 0, j = 0;
        let hex = '';
        let block;
        while (j < outputBlocks) {
            for (i = 0; i < blockCount && j < outputBlocks; ++i, ++j) {
                block = s[i];
                hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F] +
                       HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F] +
                       HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F] +
                       HEX_CHARS[(block >> 28) & 0x0F] + HEX_CHARS[(block >> 24) & 0x0F];
            }
            if (j % blockCount === 0) {
                keccakF(s);
                i = 0;
            }
        }
        if (extraBytes) {
            block = s[i];
            hex += HEX_CHARS[(block >> 4) & 0x0F] + HEX_CHARS[block & 0x0F];
            if (extraBytes > 1) {
                hex += HEX_CHARS[(block >> 12) & 0x0F] + HEX_CHARS[(block >> 8) & 0x0F];
            }
            if (extraBytes > 2) {
                hex += HEX_CHARS[(block >> 20) & 0x0F] + HEX_CHARS[(block >> 16) & 0x0F];
            }
        }
        return hex;
    };
    
    function keccakF(s) {
        let h, l, n, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9,
            b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15, b16, b17,
            b18, b19, b20, b21, b22, b23, b24, b25, b26, b27, b28, b29, b30, b31, b32, b33,
            b34, b35, b36, b37, b38, b39, b40, b41, b42, b43, b44, b45, b46, b47, b48, b49;
        for (n = 0; n < 48; n += 2) {
            c0 = s[0] ^ s[10] ^ s[20] ^ s[30] ^ s[40];
            c1 = s[1] ^ s[11] ^ s[21] ^ s[31] ^ s[41];
            c2 = s[2] ^ s[12] ^ s[22] ^ s[32] ^ s[42];
            c3 = s[3] ^ s[13] ^ s[23] ^ s[33] ^ s[43];
            c4 = s[4] ^ s[14] ^ s[24] ^ s[34] ^ s[44];
            c5 = s[5] ^ s[15] ^ s[25] ^ s[35] ^ s[45];
            c6 = s[6] ^ s[16] ^ s[26] ^ s[36] ^ s[46];
            c7 = s[7] ^ s[17] ^ s[27] ^ s[37] ^ s[47];
            c8 = s[8] ^ s[18] ^ s[28] ^ s[38] ^ s[48];
            c9 = s[9] ^ s[19] ^ s[29] ^ s[39] ^ s[49];

            h = c8 ^ ((c2 << 1) | (c3 >>> 31));
            l = c9 ^ ((c3 << 1) | (c2 >>> 31));
            s[0] ^= h; s[1] ^= l; s[10] ^= h; s[11] ^= l;
            s[20] ^= h; s[21] ^= l; s[30] ^= h; s[31] ^= l;
            s[40] ^= h; s[41] ^= l;
            h = c0 ^ ((c4 << 1) | (c5 >>> 31));
            l = c1 ^ ((c5 << 1) | (c4 >>> 31));
            s[2] ^= h; s[3] ^= l; s[12] ^= h; s[13] ^= l;
            s[22] ^= h; s[23] ^= l; s[32] ^= h; s[33] ^= l;
            s[42] ^= h; s[43] ^= l;
            h = c2 ^ ((c6 << 1) | (c7 >>> 31));
            l = c3 ^ ((c7 << 1) | (c6 >>> 31));
            s[4] ^= h; s[5] ^= l; s[14] ^= h; s[15] ^= l;
            s[24] ^= h; s[25] ^= l; s[34] ^= h; s[35] ^= l;
            s[44] ^= h; s[45] ^= l;
            h = c4 ^ ((c8 << 1) | (c9 >>> 31));
            l = c5 ^ ((c9 << 1) | (c8 >>> 31));
            s[6] ^= h; s[7] ^= l; s[16] ^= h; s[17] ^= l;
            s[26] ^= h; s[27] ^= l; s[36] ^= h; s[37] ^= l;
            s[46] ^= h; s[47] ^= l;
            h = c6 ^ ((c0 << 1) | (c1 >>> 31));
            l = c7 ^ ((c1 << 1) | (c0 >>> 31));
            s[8] ^= h; s[9] ^= l; s[18] ^= h; s[19] ^= l;
            s[28] ^= h; s[29] ^= l; s[38] ^= h; s[39] ^= l;
            s[48] ^= h; s[49] ^= l;

            b0 = s[0]; b1 = s[1];
            b32 = (s[11] << 4) | (s[10] >>> 28); b33 = (s[10] << 4) | (s[11] >>> 28);
            b14 = (s[20] << 3) | (s[21] >>> 29); b15 = (s[21] << 3) | (s[20] >>> 29);
            b46 = (s[31] << 9) | (s[30] >>> 23); b47 = (s[30] << 9) | (s[31] >>> 23);
            b28 = (s[40] << 18) | (s[41] >>> 14); b29 = (s[41] << 18) | (s[40] >>> 14);
            b20 = (s[2] << 1) | (s[3] >>> 31); b21 = (s[3] << 1) | (s[2] >>> 31);
            b2 = (s[13] << 12) | (s[12] >>> 20); b3 = (s[12] << 12) | (s[13] >>> 20);
            b34 = (s[22] << 10) | (s[23] >>> 22); b35 = (s[23] << 10) | (s[22] >>> 22);
            b16 = (s[33] << 13) | (s[32] >>> 19); b17 = (s[32] << 13) | (s[33] >>> 19);
            b48 = (s[42] << 2) | (s[43] >>> 30); b49 = (s[43] << 2) | (s[42] >>> 30);
            b40 = (s[5] << 30) | (s[4] >>> 2); b41 = (s[4] << 30) | (s[5] >>> 2);
            b22 = (s[14] << 6) | (s[15] >>> 26); b23 = (s[15] << 6) | (s[14] >>> 26);
            b4 = (s[25] << 11) | (s[24] >>> 21); b5 = (s[24] << 11) | (s[25] >>> 21);
            b36 = (s[34] << 15) | (s[35] >>> 17); b37 = (s[35] << 15) | (s[34] >>> 17);
            b18 = (s[45] << 29) | (s[44] >>> 3); b19 = (s[44] << 29) | (s[45] >>> 3);
            b10 = (s[6] << 28) | (s[7] >>> 4); b11 = (s[7] << 28) | (s[6] >>> 4);
            b42 = (s[17] << 23) | (s[16] >>> 9); b43 = (s[16] << 23) | (s[17] >>> 9);
            b24 = (s[26] << 25) | (s[27] >>> 7); b25 = (s[27] << 25) | (s[26] >>> 7);
            b6 = (s[36] << 21) | (s[37] >>> 11); b7 = (s[37] << 21) | (s[36] >>> 11);
            b38 = (s[47] << 24) | (s[46] >>> 8); b39 = (s[46] << 24) | (s[47] >>> 8);
            b30 = (s[8] << 27) | (s[9] >>> 5); b31 = (s[9] << 27) | (s[8] >>> 5);
            b12 = (s[18] << 20) | (s[19] >>> 12); b13 = (s[19] << 20) | (s[18] >>> 12);
            b44 = (s[29] << 7) | (s[28] >>> 25); b45 = (s[28] << 7) | (s[29] >>> 25);
            b26 = (s[38] << 8) | (s[39] >>> 24); b27 = (s[39] << 8) | (s[38] >>> 24);
            b8 = (s[48] << 14) | (s[49] >>> 18); b9 = (s[49] << 14) | (s[48] >>> 18);

            s[0] = b0 ^ (~b2 & b4); s[1] = b1 ^ (~b3 & b5);
            s[10] = b10 ^ (~b12 & b14); s[11] = b11 ^ (~b13 & b15);
            s[20] = b20 ^ (~b22 & b24); s[21] = b21 ^ (~b23 & b25);
            s[30] = b30 ^ (~b32 & b34); s[31] = b31 ^ (~b33 & b35);
            s[40] = b40 ^ (~b42 & b44); s[41] = b41 ^ (~b43 & b45);
            s[2] = b2 ^ (~b4 & b6); s[3] = b3 ^ (~b5 & b7);
            s[12] = b12 ^ (~b14 & b16); s[13] = b13 ^ (~b15 & b17);
            s[22] = b22 ^ (~b24 & b26); s[23] = b23 ^ (~b25 & b27);
            s[32] = b32 ^ (~b34 & b36); s[33] = b33 ^ (~b35 & b37);
            s[42] = b42 ^ (~b44 & b46); s[43] = b43 ^ (~b45 & b47);
            s[4] = b4 ^ (~b6 & b8); s[5] = b5 ^ (~b7 & b9);
            s[14] = b14 ^ (~b16 & b18); s[15] = b15 ^ (~b17 & b19);
            s[24] = b24 ^ (~b26 & b28); s[25] = b25 ^ (~b27 & b29);
            s[34] = b34 ^ (~b36 & b38); s[35] = b35 ^ (~b37 & b39);
            s[44] = b44 ^ (~b46 & b48); s[45] = b45 ^ (~b47 & b49);
            s[6] = b6 ^ (~b8 & b0); s[7] = b7 ^ (~b9 & b1);
            s[16] = b16 ^ (~b18 & b10); s[17] = b17 ^ (~b19 & b11);
            s[26] = b26 ^ (~b28 & b20); s[27] = b27 ^ (~b29 & b21);
            s[36] = b36 ^ (~b38 & b30); s[37] = b37 ^ (~b39 & b31);
            s[46] = b46 ^ (~b48 & b40); s[47] = b47 ^ (~b49 & b41);
            s[8] = b8 ^ (~b0 & b2); s[9] = b9 ^ (~b1 & b3);
            s[18] = b18 ^ (~b10 & b12); s[19] = b19 ^ (~b11 & b13);
            s[28] = b28 ^ (~b20 & b22); s[29] = b29 ^ (~b21 & b23);
            s[38] = b38 ^ (~b30 & b32); s[39] = b39 ^ (~b31 & b33);
            s[48] = b48 ^ (~b40 & b42); s[49] = b49 ^ (~b41 & b43);

            s[0] ^= RC[n]; s[1] ^= RC[n + 1];
        }
    }
    
    return {
        sha3_512: function(message) {
            return new Keccak(512, SHA3_PADDING, 512).update(message).hex();
        },
        keccak_512: function(message) {
            return new Keccak(512, KECCAK_PADDING, 512).update(message).hex();
        }
    };
})();

// Use SHA-3-512 for proof-of-work (this is what OpenAI expects)
function sha3_512(message) {
    return jsSha3.sha3_512(message);
}

// Solve proof-of-work - match working extension: hash = seed + base64(JSON), token = "gAAAAAB" + base64(JSON)
function solveProofOfWork(seed, difficulty) {
    const difficultyPrefix = difficulty || '000000';
    const difficultyLength = difficultyPrefix.length;
    
    console.log('[Background] Starting PoW with seed:', seed.substring(0, 20) + '...', 'difficulty:', difficultyPrefix);
    
    const extensionId = chrome.runtime.id || 'cbgecfllfhmmnknmamkejadjmnmpfjmp';
    const scriptPath = `chrome-extension://${extensionId}/background.js`;
    const fingerprintArray = generateFingerprintArray(scriptPath);
    const startTime = typeof performance !== 'undefined' ? performance.now() : 0;
    
    for (let nonce = 0; nonce < 500000; nonce++) {
        fingerprintArray[3] = nonce;
        fingerprintArray[9] = Math.round((typeof performance !== 'undefined' ? performance.now() : startTime + nonce) - startTime);
        
        const jsonStr = JSON.stringify(fingerprintArray);
        const z = btoa(String.fromCharCode(...new TextEncoder().encode(jsonStr)));
        const toHash = seed + z;  // Working extension hashes seed + base64(JSON)
        const hashHex = sha3_512(toHash);
        
        if (hashHex.substring(0, difficultyLength) <= difficultyPrefix) {
            console.log('[Background] PoW solved at nonce:', nonce, 'hash prefix:', hashHex.substring(0, difficultyLength));
            return 'gAAAAAB' + z;  // Working extension: proof token = "gAAAAAB" + base64(JSON)
        }
    }
    
    console.log('[Background] PoW fallback used after max iterations');
    fingerprintArray[3] = 499999;
    fingerprintArray[9] = Math.round((typeof performance !== 'undefined' ? performance.now() : startTime) - startTime);
    const zFallback = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(fingerprintArray))));
    return 'gAAAAAB' + zFallback;
}

// Get user's ChatGPT session and access token
async function getChatGPTSession() {
    try {
        const response = await fetch(`${CHATGPT_BASE_URL}/api/auth/session`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': '*/*',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (!response.ok) {
            throw new Error('Failed to get session');
        }
        
        const data = await response.json();
        if (!data.accessToken) {
            throw new Error('No access token - please login to ChatGPT');
        }
        
        return data;
    } catch (error) {
        console.error('[Background] getChatGPTSession error:', error);
        throw error;
    }
}

// Get chat requirements token WITH fingerprint p parameter
async function getChatRequirements(accessToken) {
    try {
        const deviceId = getDeviceId();
        
        // Generate fingerprint payload (p parameter) - working extension uses background.js path (HAR)
        const extensionId = chrome.runtime.id || 'cbgecfllfhmmnknmamkejadjmnmpfjmp';
        const scriptPath = `chrome-extension://${extensionId}/background.js`;
        const fingerprintArray = generateFingerprintArray(scriptPath);
        const pPayload = encodeFingerprintPayload(fingerprintArray, false); // false = not proof token
        
        console.log('[Background] Sending chat-requirements with p parameter...');
        
        const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/sentinel/chat-requirements`, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'accept': '*/*',
                'content-type': 'application/json',
                'authorization': `Bearer ${accessToken}`,
                'oai-device-id': deviceId,
                'oai-language': 'en-us'
            },
            body: JSON.stringify({ p: pPayload })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Background] Chat requirements error:', response.status, errorText);
            throw new Error('Failed to get chat requirements');
        }
        
        const data = await response.json();
        console.log('[Background] Chat requirements received:', Object.keys(data));
        
        // If proof-of-work is required, solve it
        if (data.proofofwork?.required && data.proofofwork?.seed && data.proofofwork?.difficulty) {
            console.log('[Background] Solving proof-of-work challenge...');
            data.proofToken = await solveProofOfWork(data.proofofwork.seed, data.proofofwork.difficulty);
            console.log('[Background] Proof-of-work solved');
        }
        
        return data;
    } catch (error) {
        console.error('[Background] getChatRequirements error:', error);
        throw error;
    }
}

// Send message to ChatGPT and stream response
// Working extension uses a fresh device ID per request (see HAR)
async function sendChatGPTMessage(prompt, accessToken, requirements, tabId) {
    const messageId = generateUUID();
    const parentMessageId = generateUUID();
    const deviceId = getDeviceId();  // Fresh device ID per request like working extension
    
    // Full body matching the working extension
    const body = {
        action: 'next',
        messages: [{
            id: messageId,
            author: { role: 'user' },
            content: {
                content_type: 'text',
                parts: [prompt]
            }
        }],
        model: 'auto',
        parent_message_id: parentMessageId,
        is_visible: false,  // Create hidden so Google Search conversations never appear in sidebar
        force_nulligen: false,
        force_paragen: false,
        force_paragen_model_slug: '',
        force_rate_limit: false,
        suggestions: [],
        supported_encodings: ["v1"]
    };
    
    const headers = {
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
        'oai-device-id': deviceId,
        'oai-language': 'en-us'
    };
    
    // Add the requirements token if available (lowercase header names per HAR)
    if (requirements?.token) {
        headers['openai-sentinel-chat-requirements-token'] = requirements.token;
    }
    
    // Add the proof-of-work token if available (CRITICAL for bypassing 403)
    if (requirements?.proofToken) {
        headers['openai-sentinel-proof-token'] = requirements.proofToken;
    }
    
    try {
        console.log('[Background] Sending conversation request with proof token:', !!requirements?.proofToken);
        
        const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation`, {
            method: 'POST',
            credentials: 'include',
            headers: headers,
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Background] Conversation API error:', response.status, errorText);
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }
        
        console.log('[Background] Conversation request successful!');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let conversationId = null;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        // Get conversation ID for cleanup later
                        if (parsed.conversation_id) {
                            conversationId = parsed.conversation_id;
                        }
                        
                        // Only show assistant reply, not user prompt
                        const isAssistant = parsed.message?.author?.role === 'assistant';
                        if (isAssistant && parsed.message?.content?.parts) {
                            const text = parsed.message.content.parts.join('');
                            if (text && text !== fullText) {
                                fullText = text;
                                // Send streaming update to tab
                                chrome.tabs.sendMessage(tabId, {
                                    type: 'CHATGPT_STREAM_UPDATE',
                                    text: fullText
                                }).catch(() => {});
                            }
                        }
                    } catch (e) {
                        // Skip non-JSON lines
                    }
                }
            }
        }
        
        if (conversationId) {
            await hideConversationWithRetry(conversationId, accessToken);
        }
        
        return { text: fullText, conversationId };
        
    } catch (error) {
        console.error('[Background] sendChatGPTMessage error:', error);
        throw error;
    }
}

// Hide conversation with delay + retries so it reliably disappears from "Your chats"
async function hideConversationWithRetry(conversationId, accessToken) {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const maxAttempts = 3;
    await delay(500);  // Server may need a moment to persist the conversation
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation/${conversationId}`, {
                method: 'PATCH',
                credentials: 'include',
                headers: {
                    'accept': '*/*',
                    'content-type': 'application/json',
                    'authorization': `Bearer ${accessToken}`,
                    'oai-device-id': getDeviceId()
                },
                body: JSON.stringify({ is_visible: false })
            });
            if (res.ok) return;
            if (res.status === 404 && attempt < maxAttempts) {
                await delay(400 * attempt);
                continue;
            }
        } catch (error) {
            if (attempt < maxAttempts) await delay(400 * attempt);
        }
    }
}

async function deleteConversation(conversationId, accessToken) {
    await hideConversationWithRetry(conversationId, accessToken);
}

const CHAT_URLS = ['https://chatgpt.com/', 'https://chat.openai.com/'];

function isChatGPTTab(tab) {
    return tab?.url && CHAT_URLS.some(u => tab.url.startsWith(u));
}

// Find existing chatgpt.com tab only - never creates (avoids opening new tab)
async function getExistingChatGPTTab() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (isChatGPTTab(tab) && tab.status === 'complete') return tab.id;
    }
    return null;
}

const OFFSCREEN_CHATGPT_PATH = 'offscreen-chatgpt.html';
let offscreenChatGPTCreating = null;

// Ensure offscreen document exists for ChatGPT API (extension context = cookies work)
async function ensureOffscreenChatGPTDocument() {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_CHATGPT_PATH);
    if (typeof chrome.runtime.getContexts === 'function') {
        const existing = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [offscreenUrl]
        });
        if (existing.length > 0) return;
    }
    if (offscreenChatGPTCreating) {
        await offscreenChatGPTCreating;
        return;
    }
    offscreenChatGPTCreating = chrome.offscreen.createDocument({
        url: OFFSCREEN_CHATGPT_PATH,
        reasons: ['IFRAME_SCRIPTING'],
        justification: 'ChatGPT API integration for Google search - requires extension context for session cookies'
    });
    try {
        await offscreenChatGPTCreating;
    } finally {
        offscreenChatGPTCreating = null;
    }
}

// Increment usage when chatgpt-api.js reports successful completion
chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'CHATGPT_SEARCH_RESPONSE' && message.done === true && !message.noBill) {
        incrementGoogleSearchUsage().catch(() => {});
    }
    if (message.type === 'WRITING_ASSISTANT_RESPONSE' && message.done === true && !message.noCountUsage) {
        finishWritingUsage(message.requestId, !!message.error).catch(() => {});
    }
});

const receivedWritingRequests = new Set();

// Handle Google search ChatGPT requests from iframe
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SIDEAI_CHATGPT_REQUEST_ACTIVE') {
        sendResponse({ ok: true });
        return false;
    }
    if (message.type === 'SIDEAI_PREWARM_WRITING') {
        ensureOffscreenChatGPTDocument()
            .then(() => sendResponse({ ok: true }))
            .catch((error) => sendResponse({ error: error.message || 'ChatGPT could not load' }));
        return true;
    }
    if (message.type === 'checkGoogleSearchUsage') {
        checkGoogleSearchUsage().then(sendResponse);
        return true;
    }
    if (message.type === 'incrementGoogleSearchUsage') {
        incrementGoogleSearchUsage().then(() => sendResponse({ ok: true }));
        return true;
    }
    if (message.type === 'CHATGPT_SEARCH_QUERY') {
        const requestId = message.requestId || ('gs-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        const tabId = sender.tab?.id;
        const frameId = sender.frameId;
        
        console.log('[Background] Received CHATGPT_SEARCH_QUERY, tabId:', tabId, 'frameId:', frameId);
        
        // Stream events carry the result; do not hold this UI message port open.
        sendResponse({ accepted: true });
        (async () => {
            try {
                const usageCheck = await checkGoogleSearchUsage();
                if (!usageCheck.allowed) {
                    chrome.runtime.sendMessage({
                        type: 'CHATGPT_SEARCH_RESPONSE',
                        requestId,
                        error: 'DAILY_LIMIT',
                        resetTime: usageCheck.resetTime
                    }).catch(() => {});

                    return;
                }
                await ensureOffscreenChatGPTDocument();
                chrome.runtime.sendMessage({
                    type: 'OFFSCREEN_CHATGPT_API_CALL',
                    requestId,
                    prompt: message.prompt,
                    query: message.query,
                    noBill: !!message.noBill
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Background] offscreen error:', chrome.runtime.lastError.message);
                        chrome.runtime.sendMessage({
                            type: 'CHATGPT_SEARCH_RESPONSE',
                            requestId,
                            error: chrome.runtime.lastError.message || 'ChatGPT not ready - try again'
                        }).catch(() => {});

                    } else if (response?.error) {
                        if (!response.delivered) chrome.runtime.sendMessage({
                            type: 'CHATGPT_SEARCH_RESPONSE',
                            requestId,
                            error: response.error,
                            resetTime: response.resetTime
                        }).catch(() => {});

                    } else {

                    }
                });
                
            } catch (error) {
                console.error('[Background] CHATGPT_SEARCH_QUERY error:', error);
                
                chrome.runtime.sendMessage({
                    type: 'CHATGPT_SEARCH_RESPONSE',
                    requestId,
                    error: error.message || 'Failed to get response from ChatGPT',
                    query: message.query
                }).catch(() => {});

            }
        })();
        
        return false; // Request already acknowledged; results arrive as stream events
    }
    
    if (message.type === 'ABORT_CHATGPT_SEARCH') {
        // Handle abort request
        if (activeAbortControllers[message.query]) {
            activeAbortControllers[message.query].abort();
            delete activeAbortControllers[message.query];
            console.log('[Background] Aborted search for:', message.query);
        }
        return;
    }

    // AI Writing Assistant - uses offscreen doc (same method as Google Search)
    if (message.type === 'WRITING_ASSISTANT_QUERY') {
        const requestId = message.requestId;
        const prompt = message.prompt;
        const noCountUsage = !!message.noCountUsage; // true = from text-menu panel regenerate/chat; do not count as new usage
        sendResponse({ ok: true }); // Close message channel immediately; result comes via WRITING_ASSISTANT_RESPONSE
        // Relay retries must not charge or reject an already admitted third use.
        if (!requestId || receivedWritingRequests.has(requestId)) return false;
        receivedWritingRequests.add(requestId);
        if (receivedWritingRequests.size > 128) receivedWritingRequests.delete(receivedWritingRequests.values().next().value);

        (async () => {
            try {
                if (!noCountUsage) {
                    const usageCheck = await checkWritingAssistantUsage(requestId);
                    if (!usageCheck.allowed) {
                        if (usageCheck.loginRequired || usageCheck.authUnavailable) {
                            sendWritingAssistantResponse(requestId, null, usageCheck.error);
                            return;
                        }
                        sendWritingAssistantResponseWithLimit(requestId, usageCheck.resetTime);
                        return;
                    }
                }
                await ensureOffscreenChatGPTDocument();
                const result = await chrome.runtime.sendMessage({
                    type: 'OFFSCREEN_WRITING_ASSISTANT_API_CALL',
                    requestId,
                    prompt,
                    noCountUsage
                });
                if (result?.error && !result.delivered) {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('[Background] WRITING_ASSISTANT_QUERY error:', error);
                await finishWritingUsage(requestId, true);
                const errMsg = error.message || 'Failed to get response from ChatGPT';
                sendWritingAssistantResponse(requestId, null, errMsg);
            }
        })();
        return false;
    }
});

// Track active abort controllers
const activeAbortControllers = {};

// Strip ChatGPT citation markers - multiple formats (E200-E202, tether/source, turn0 refs)
function stripCitationMarkers(text) {
    if (!text || typeof text !== 'string') return text || '';
    const normalizeEntityMarker = (match, markerType, markerPayload) => {
        if (String(markerType).trim().toLowerCase() !== 'entity') return '';
        try {
            const parsed = JSON.parse(markerPayload);
            if (Array.isArray(parsed)) {
                const preferred = parsed.find((value, index) => index > 0 && typeof value === 'string' && value.trim());
                if (preferred) return preferred.trim();
            }
        } catch (_) {}
        return '';
    };
    return text
        .replace(/\uE200([^\uE202]+)\uE202([\s\S]*?)\uE201/g, normalizeEntityMarker)
        .replace(/\uE200[\s\S]*?\uE201/g, '')   // cite/navlist blocks: E200...E201
        .replace(/[\uE200-\uE202]/g, '')        // any leftover private-use markers
        .replace(/\u3010\d+\u2020source\u3011/g, '')  // Gizmo tether: 〠6†source〠
        .replace(/\[cite\][^\]]*\[\]/g, '')     // fallback: literal [cite]...[]
        .replace(/\s*cite\s*turn0(news|search)\d+(\s*turn0(news|search)\d+)*\s*/gi, ' ')   // orphan cite+turn0 refs
        .replace(/\s*navlist[^\n]*turn0(news|search)\d+[^\n]*\n?/g, '');  // navlist lines
}

function sendWritingAssistantResponse(requestId, text, error) {
    const cleaned = (text && typeof text === 'string') ? stripCitationMarkers(text) : text;
    chrome.runtime.sendMessage({
        type: 'WRITING_ASSISTANT_RESPONSE',
        requestId,
        text: cleaned || undefined,
        error: error || undefined,
        done: true
    }).catch(() => {});
}

function sendWritingAssistantResponseWithLimit(requestId, resetTime) {
    chrome.runtime.sendMessage({
        type: 'WRITING_ASSISTANT_RESPONSE',
        requestId,
        error: 'DAILY_LIMIT',
        resetTime: resetTime,
        done: true
    }).catch(() => {});
}

async function sendChatGPTMessageForWritingAssistant(prompt, accessToken, requirements, requestId) {
    const messageId = generateUUID();
    const parentMessageId = generateUUID();
    const deviceId = getDeviceId();

    const body = {
        action: 'next',
        messages: [{
            id: messageId,
            author: { role: 'user' },
            content: {
                content_type: 'text',
                parts: [prompt]
            }
        }],
        model: 'auto',
        parent_message_id: parentMessageId,
        is_visible: false,
        force_nulligen: false,
        force_paragen: false,
        force_paragen_model_slug: '',
        force_rate_limit: false,
        suggestions: [],
        supported_encodings: ["v1"]
    };

    const headers = {
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
        'oai-device-id': deviceId,
        'oai-language': 'en-us'
    };

    if (requirements?.token) {
        headers['openai-sentinel-chat-requirements-token'] = requirements.token;
    }
    if (requirements?.proofToken) {
        headers['openai-sentinel-proof-token'] = requirements.proofToken;
    }

    const abortController = new AbortController();
    activeAbortControllers[requestId] = abortController;

    try {
        const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation`, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText.substring(0, 200)}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let conversationId = null;
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]' || !data) continue;
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.conversation_id) conversationId = parsed.conversation_id;

                        // Gizmo/JSON Patch format: {"o":"patch","v":[{"p":"/message/content/parts/0","o":"append","v":"..."}]}
                        const patches = (parsed.o === 'patch' && Array.isArray(parsed.v)) ? parsed.v : (Array.isArray(parsed.v) ? parsed.v : null);
                        if (patches) {
                            for (const op of patches) {
                                if (op && op.o === 'append' && typeof op.v === 'string' && op.p === '/message/content/parts/0') {
                                    fullText += op.v;
                                    if (fullText) {
                                        chrome.runtime.sendMessage({
                                            type: 'WRITING_ASSISTANT_RESPONSE',
                                            requestId,
                                            text: stripCitationMarkers(fullText),
                                            done: false
                                        }).catch(() => {});
                                    }
                                }
                            }
                            continue;
                        }

                        // Gizmo full message in v: {"v":{"message":{...}}}
                        const vMsg = parsed.v?.message;
                        if (vMsg?.author?.role === 'assistant' && vMsg?.content) {
                            const parts = vMsg.content.parts;
                            const text = Array.isArray(parts) ? parts.map(p => typeof p === 'string' ? p : (p?.text || '')).join('') : (vMsg.content.text || '');
                            if (text && text !== fullText) {
                                fullText = text;
                                chrome.runtime.sendMessage({
                                    type: 'WRITING_ASSISTANT_RESPONSE',
                                    requestId,
                                    text: stripCitationMarkers(fullText),
                                    done: false
                                }).catch(() => {});
                            }
                            continue;
                        }

                        // Legacy format: {"message":{"content":{"parts":[...]}}}
                        const isAssistant = parsed.message?.author?.role === 'assistant';
                        if (isAssistant && parsed.message?.content?.parts) {
                            const parts = parsed.message.content.parts;
                            const text = Array.isArray(parts)
                                ? parts.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('')
                                : '';
                            if (text && text !== fullText) {
                                fullText = text;
                                chrome.runtime.sendMessage({
                                    type: 'WRITING_ASSISTANT_RESPONSE',
                                    requestId,
                                    text: stripCitationMarkers(fullText),
                                    done: false
                                }).catch(() => {});
                            }
                        }
                    } catch (e) { /* skip */ }
                }
            }
        }

        delete activeAbortControllers[requestId];
        chrome.runtime.sendMessage({
            type: 'WRITING_ASSISTANT_RESPONSE',
            requestId,
            text: stripCitationMarkers(fullText),
            done: true
        }).catch(() => {});

        if (conversationId) {
            await hideConversationWithRetry(conversationId, accessToken);
        }
    } catch (error) {
        delete activeAbortControllers[requestId];
        sendWritingAssistantResponse(requestId, null, error.message || 'Failed to get response');
        throw error;
    }
}

// Send ChatGPT message with broadcast updates for iframe
async function sendChatGPTMessageWithBroadcast(prompt, accessToken, requirements, queryId) {
    const messageId = generateUUID();
    const parentMessageId = generateUUID();
    const deviceId = getDeviceId();
    
    const body = {
        action: 'next',
        messages: [{
            id: messageId,
            author: { role: 'user' },
            content: {
                content_type: 'text',
                parts: [prompt]
            }
        }],
        model: 'auto',
        parent_message_id: parentMessageId,
        is_visible: false,  // Create hidden so Google Search conversations never appear in sidebar
        force_nulligen: false,
        force_paragen: false,
        force_paragen_model_slug: '',
        force_rate_limit: false,
        suggestions: [],
        supported_encodings: ["v1"]
    };
    
    const headers = {
        'accept': 'text/event-stream',
        'content-type': 'application/json',
        'authorization': `Bearer ${accessToken}`,
        'oai-device-id': deviceId,
        'oai-language': 'en-us'
    };
    
    if (requirements?.token) {
        headers['openai-sentinel-chat-requirements-token'] = requirements.token;
    }
    
    if (requirements?.proofToken) {
        headers['openai-sentinel-proof-token'] = requirements.proofToken;
    }
    
    // Create abort controller for this request
    const abortController = new AbortController();
    activeAbortControllers[queryId] = abortController;
    
    try {
        console.log('[Background] Sending conversation request...');
        
        const response = await fetch(`${CHATGPT_BASE_URL}/backend-api/conversation`, {
            method: 'POST',
            credentials: 'include',
            headers: headers,
            body: JSON.stringify(body),
            signal: abortController.signal
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[Background] Conversation API error:', response.status, errorText);
            throw new Error(`API error: ${response.status} - ${errorText.substring(0, 200)}`);
        }
        
        console.log('[Background] Conversation request successful, streaming...');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let conversationId = null;
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data === '[DONE]') continue;
                    if (!data) continue;
                    
                    try {
                        const parsed = JSON.parse(data);
                        
                        if (parsed.conversation_id) {
                            conversationId = parsed.conversation_id;
                        }
                        
                        // Only show assistant reply, not user prompt
                        const isAssistant = parsed.message?.author?.role === 'assistant';
                        if (isAssistant && parsed.message?.content?.parts) {
                            const text = parsed.message.content.parts.join('');
                            if (text && text !== fullText) {
                                fullText = text;
                                
                                // Broadcast update to all extension contexts (including iframe)
                                chrome.runtime.sendMessage({
                                    type: 'CHATGPT_SEARCH_RESPONSE',
                                    text: fullText,
                                    query: queryId
                                }).catch(() => {});
                            }
                        }
                    } catch (e) {
                        // Skip non-JSON lines
                    }
                }
            }
        }
        
        // Clean up
        delete activeAbortControllers[queryId];
        
        // Send done signal
        chrome.runtime.sendMessage({
            type: 'CHATGPT_SEARCH_RESPONSE',
            text: fullText,
            done: true,
            query: queryId
        }).catch(() => {});
        
        if (conversationId) {
            await hideConversationWithRetry(conversationId, accessToken);
        }
        
        return { text: fullText, conversationId };
        
    } catch (error) {
        delete activeAbortControllers[queryId];
        console.error('[Background] sendChatGPTMessageWithBroadcast error:', error);
        throw error;
    }
}

// Warm the hidden connection when the worker starts, not after a user sends a query.
// This only loads ChatGPT; it never submits a prompt or consumes an AI usage credit.
async function prewarmSideAIChatGPT() {
    try {
        const { googleChatgptEnabled = true } = await chrome.storage.sync.get('googleChatgptEnabled');
        if (googleChatgptEnabled) await ensureOffscreenChatGPTDocument();
    } catch (_) { /* A request can retry document creation if startup was interrupted. */ }
}
void prewarmSideAIChatGPT();

// Content scripts cannot directly access trusted chrome.storage.session by default.
// Keep native drafts in the background rather than exposing the whole session store.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type !== 'SIDEAI_COMPOSER_DRAFT') return;
    if (sender.id !== chrome.runtime.id || !/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(sender.url || '') ||
        !/^(panel-\d+|document-[\w-]{1,80})$/.test(message.scope || '')) { respond({ok:false}); return false; }
    (async () => {
        const key='sideai-held-draft:'+message.scope;
        if (message.action === 'save') {
            if (typeof message.draft?.text !== 'string' || message.draft.text.length > 1000000) return respond({ok:false});
            await chrome.storage.session.set({[key]:message.draft});
        } else if (message.action === 'read') return respond({ok:true,draft:(await chrome.storage.session.get(key))[key] || null});
        else if (message.action === 'clear') await chrome.storage.session.remove(key);
        else return respond({ok:false});
        respond({ok:true});
    })().catch(()=>respond({ok:false}));
    return true;
});
