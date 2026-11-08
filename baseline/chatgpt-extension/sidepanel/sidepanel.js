// Loading slowly is not evidence of logout. Keep ChatGPT visible while it loads.
let sideAIFrameWatchdog = null;
let sideAIFrameLoadAttempt = 0;
let sideAIFrameReady = false;
let sideAIStartupChatUrl = 'https://chatgpt.com/';
function sideAIHideLoginHelp() {
  const help = document.getElementById('sideai-login-help-frame');
  if (help) help.hidden = true;
}
function sideAIRequestFrameState() {
  document.getElementById('chatgpt-iframe')?.contentWindow?.postMessage(
    { type: 'SIDEAI_PROBE_PANEL_READY' }, 'https://chatgpt.com');
}
function sideAIShowLoginHelp(reason) {
  if (reason === 'unavailable' || sideAIFrameReady) {
    sideAIHideLoginHelp();
    return false;
  }
  document.body?.classList.add('sideai-login-active');
  ++sideAIFrameLoadAttempt;
  clearTimeout(sideAIFrameWatchdog);
  const help = document.getElementById('sideai-login-help-frame');
  if (!help) return false;
  const url = chrome.runtime.getURL('sidepanel/login_redirect.html?reason=' + reason);
  if (help.src !== url) help.src = url;
  help.hidden = false;
  return true;
}
async function sideAIConfirmLoginHelp(openLogin = false) {
  const attempt = sideAIFrameLoadAttempt;
  let auth;
  try { auth = await chrome.runtime.sendMessage({ type: 'SIDEAI_CHECK_AUTH' }); }
  catch (_) {}
  if (attempt !== sideAIFrameLoadAttempt || sideAIFrameReady) return false;
  if (auth?.loginRequired === true && auth.state === 'guest') {
    const shown = sideAIShowLoginHelp('login');
    if (shown && openLogin) void chrome.runtime.sendMessage({ type: 'SIDEAI_OPEN_CHATGPT_LOGIN' }).catch(() => {});
    return shown;
  }
  sideAIHideLoginHelp();
  sideAIRequestFrameState();
  return false;
}
function sideAIHandleSlowFrame() {
  // A missing readiness signal, network delay or unknown session must never
  // replace a working chat with the old "Continue with SideAI" screen.
  if (!sideAIFrameReady) sideAIRequestFrameState();
}
async function sideAILoadChatGPT(url = sideAIStartupChatUrl) {
  ++sideAIFrameLoadAttempt;
  sideAIFrameReady = false;
  sideAIHideLoginHelp();
  const frame = document.getElementById('chatgpt-iframe');
  if (!frame) return;
  // Let ChatGPT render its own sign-in dialog for guests.
  clearTimeout(sideAIFrameWatchdog);
  sideAIFrameWatchdog = setTimeout(sideAIHandleSlowFrame, 25000);
  frame.src = url;
}
window.addEventListener('message', event => {
  const frame = document.getElementById('chatgpt-iframe');
  const help = document.getElementById('sideai-login-help-frame');
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');
  if (event.source === help?.contentWindow && event.origin === extensionOrigin &&
      event.data?.type === 'SIDEAI_RETRY_LOGIN') {
    if (sideAIFrameReady) { sideAIHideLoginHelp(); return; }
    void sideAILoadChatGPT();
    return;
  }
  if (event.source !== frame?.contentWindow) return;
  if (event.data?.type === 'SIDEAI_REQUEST_PANEL_CONTEXT' && event.origin === 'https://chatgpt.com') {
    void chrome.windows.getCurrent().then(win=>frame.contentWindow.postMessage({type:'SIDEAI_PANEL_CONTEXT',windowId:win.id},'https://chatgpt.com'));
    return;
  }
  if (['https://chatgpt.com', 'https://chat.openai.com'].includes(event.origin) &&
      event.data?.type === 'SIDEAI_REQUIRE_LOGIN') {
    if (event.data.unavailable) { sideAIHideLoginHelp(); sideAIRequestFrameState(); }
    else void sideAIConfirmLoginHelp(true);
  }
  if (['https://chatgpt.com', 'https://chat.openai.com'].includes(event.origin) &&
      (['SIDEAI_CHAT_READY', 'SIDEAI_GUEST_READY'].includes(event.data?.type) ||
       (event.data?.type === 'SIDEAI_PANEL_RENDER_STATE' && ['chat', 'guest'].includes(event.data.state)))) {
    ++sideAIFrameLoadAttempt; // invalidate any older authentication check
    sideAIFrameReady = true;
    clearTimeout(sideAIFrameWatchdog);
    if (help) help.hidden = true;
    document.body?.classList.toggle('sideai-login-active', event.data.type === 'SIDEAI_GUEST_READY' || event.data.state === 'guest');
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'SIDEAI_SHOW_LOGIN_HELP') return;
  void chrome.windows.getCurrent().then(async win => {
    if (win.id !== message.windowId) {
      sendResponse({ shown: false });
      return;
    }
    if (message.reason === 'unavailable') { sideAIHideLoginHelp(); sideAIRequestFrameState(); }
    else if (message.reason === 'waiting') await sideAIConfirmLoginHelp();
    else void sideAILoadChatGPT();
    await chrome.storage.session.remove('sideai-login-help-' + win.id);
    sendResponse({ shown: true });
  }).catch(() => sendResponse({ shown: false }));
  return true;
});
window.addEventListener('load', () => {
  const frame = document.getElementById('chatgpt-iframe');
  if (!frame) return;
  frame.addEventListener('load', sideAIRequestFrameState);
  new MutationObserver(() => {
    ++sideAIFrameLoadAttempt;
    sideAIFrameReady = false;
    sideAIHideLoginHelp();
    clearTimeout(sideAIFrameWatchdog);
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(frame.src)) return;
    sideAIFrameWatchdog = setTimeout(sideAIHandleSlowFrame, 25000);
  }).observe(frame, { attributes: true, attributeFilter: ['src'] });
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    clearTimeout(fallback);
    const resume = await Promise.race([
      window.sideAIResumeStartup,
      new Promise(resolve => setTimeout(() => resolve(null), 3000))
    ]);
    sideAIStartupChatUrl = resume?.url || frame.dataset.src || sideAIStartupChatUrl;
    try {
      const win = await chrome.windows.getCurrent();
      const key = 'sideai-login-help-' + win.id;
      const pending = (await chrome.storage.session.get(key))[key];
      if (pending) {
        await chrome.storage.session.remove(key);
        if (Date.now() - pending.at < 60000) {
          await sideAILoadChatGPT();
          if (pending.reason === 'waiting') await sideAIConfirmLoginHelp();
          return;
        }
      }
    } catch (_) {}
    if (!frame.hasAttribute('src')) await sideAILoadChatGPT();
  };
  // Chrome can pause animation frames while the panel is becoming visible.
  // Keep startup moving without navigating twice or discarding the saved chat.
  const fallback = setTimeout(start, 100);
  requestAnimationFrame(start);
}, { once: true });

document.addEventListener('DOMContentLoaded', () => {
// Connect to the background script
console.log('Sidepanel script starting...');

   chrome.runtime.sendMessage({ type: 'sidepanelOpened' }).catch(() => {});

   let iframe = document.getElementById('chatgpt-iframe');
   const MIC_PERMISSION_GRANTED_MESSAGE = 'SIDEAI_EXTENSION_MIC_PERMISSION_GRANTED';
   const MIC_PERMISSION_DENIED_MESSAGE = 'SIDEAI_EXTENSION_MIC_PERMISSION_DENIED';
   const SIDEAI_SHORTCUT_HINT_DISMISSED_KEY = 'sideai_shortcut_hint_dismissed';
   const SIDEAI_RATING_PROMPT_STATE_KEY = 'sideai_rating_prompt_state';
   const SIDEAI_RATING_PROMPT_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
   const SIDEAI_RATING_PROMPT_MIN_OPEN_COUNT = 3;
   const SIDEAI_UPDATE_FEATURES = [
     {
       title: 'Improved Text Menu',
       text: 'Select text anywhere and use quick AI actions like ask, summarize, explain, rewrite, and translate.',
       image: 'images/whats-new/improved-text-menu.png'
     },
     {
       title: 'Writing Assistant',
       text: 'Rewrite, improve, and generate polished text directly inside fields and editors.',
       image: 'images/whats-new/writing-assistant.png'
     },
     {
       title: 'Page Assistant',
       text: 'Chat with the current page, summarize content, and ask follow-up questions without leaving the tab.',
       image: 'images/whats-new/page-assistant.png'
     },
     {
       title: 'Search Insights',
       text: 'Get AI answers alongside Google results for faster research.',
       image: 'images/whats-new/search-insights.png'
     },
     {
       title: 'Screenshot Auto Upload',
       text: 'Capture a page screenshot and send it into your assistant workflow with less manual work.',
       image: 'images/whats-new/screenshot-auto-upload.png'
     },
     {
       title: 'Quick Chat',
       text: 'Open SideAI quickly and ask about the current page using the keyboard shortcut.',
       image: 'images/whats-new/quick-chat.png'
     },
     {
       title: 'Customizable Menu',
       text: 'Choose which actions appear and organize SideAI around your workflow.',
       image: 'images/whats-new/customizable-menu.png'
     }
   ];

   let sideAIUpdateNotice = null;
   let sideAIUpdateSlideIndex = 0;
   let sideAIUpdateIframeLoaded = false;
   let sideAIUpdateWaitingForAnswer = false;
   let sideAIUpdateIdleTimer = null;
   let sideAIUpdateVisible = false;
   let sideAIRatingPromptState = null;
   let sideAIRatingPromptVisible = false;
   let sideAIRatingPromptSuppressedForSession = false;
   let sideAIShortcutHintDismissed = false;
   let sideAIUpdateNoticeResolved = false;

   const sideAIUpdateEls = {
     overlay: document.getElementById('sideai-update-overlay'),
     close: document.getElementById('sideai-update-close'),
     image: document.getElementById('sideai-update-image'),
     title: document.getElementById('sideai-update-feature-title'),
     text: document.getElementById('sideai-update-feature-text'),
     dots: document.getElementById('sideai-update-dots'),
     prev: document.getElementById('sideai-update-prev'),
     next: document.getElementById('sideai-update-next'),
     details: document.getElementById('sideai-update-details'),
     disable: document.getElementById('sideai-update-disable')
   };

   const sideAIShortcutHintEls = {
     banner: document.getElementById('sideai-shortcut-hint'),
     keys: document.getElementById('sideai-shortcut-keys'),
     resumeKeys: document.getElementById('sideai-resume-shortcut-keys'),
     lastKeys: document.getElementById('sideai-last-shortcut-keys'),
     dismiss: document.getElementById('sideai-shortcut-dismiss'),
     settings: document.getElementById('sideai-shortcut-settings')
   };

   const sideAIRatingPromptEls = {
     banner: document.getElementById('sideai-rating-prompt'),
     starsGroup: document.getElementById('sideai-rating-prompt-stars'),
     stars: Array.from(document.querySelectorAll('.sideai-rating-prompt-star')),
     later: document.getElementById('sideai-rating-prompt-later'),
     dismiss: document.getElementById('sideai-rating-prompt-dismiss')
   };

   function isMacPlatform() {
     const platform = navigator.userAgentData?.platform || navigator.platform || '';
     return /mac|iphone|ipad|ipod/i.test(platform);
   }

   function normalizeShortcutLabel(shortcut) {
     if (!shortcut) return '';
     return shortcut
       .replace(/\bMacCtrl\b/g, '__MAC_CONTROL__')
       .replace(/\bCommand\b/g, '⌘')
       .replace(/\bCommandOrControl\b/g, isMacPlatform() ? '⌘' : 'Ctrl')
       .replace(/\bCtrl\b/g, isMacPlatform() ? '⌘' : 'Ctrl')
       .replace(/__MAC_CONTROL__/g, 'Ctrl')
       .replace(/\bOption\b/g, '⌥')
       .replace(/\bAlt\b/g, isMacPlatform() ? '⌥' : 'Alt')
       .replace(/\bShift\b/g, 'Shift')
       .replace(/\bSpace\b/g, 'Space');
   }

   function renderShortcutKeys(shortcutText, target = sideAIShortcutHintEls.keys) {
     if (!target) return;
     const normalized = normalizeShortcutLabel(shortcutText);
     target.innerHTML = '';
     if (!normalized) {
       target.textContent = shortcutText == null ? 'Unavailable' : 'Not assigned';
       if (shortcutText === '') {
         const assign = document.createElement('button');
         assign.type = 'button';
         assign.className = 'sideai-shortcut-settings';
         assign.textContent = 'Assign';
         assign.setAttribute('aria-label', 'Assign a keyboard shortcut in Chrome');
         assign.title = 'Chrome has no key assigned. Choose an available combination in Chrome shortcut settings.';
         assign.addEventListener('click', () => {
           chrome.runtime.sendMessage({ type: 'SIDEAI_EDIT_SHORTCUTS' }).catch(() => {});
         });
         target.appendChild(assign);
       }
       return;
     }
     normalized.split('+').map((part) => part.trim()).filter(Boolean).forEach((part, index, parts) => {
       const key = document.createElement('span');
       key.className = 'sideai-shortcut-key';
       key.textContent = part;
       target.appendChild(key);
       if (index < parts.length - 1) {
         target.appendChild(document.createTextNode('+'));
       }
     });
   }

   async function getSideAIShortcuts() {
     try {
       const commands = await chrome.commands.getAll();
       return {
         action: commands.find(command => command.name === '_execute_action')?.shortcut,
         resume: commands.find(command => command.name === 'toggle-resume-sidepanel')?.shortcut,
         last: commands.find(command => command.name === 'open-last-closed-sidepanel')?.shortcut
       };
     } catch (error) {
       console.warn('[Sidepanel] Unable to read extension shortcut:', error);
       return { action: null, resume: null, last: null };
     }
   }

   function buildSideAITrackedUrl(rawUrl, source) {
     if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
     try {
       const url = new URL(rawUrl);
       if (url.hostname !== 'sideai.app') return rawUrl;
       url.searchParams.set('utm_source', source);
       url.searchParams.set('utm_medium', 'chrome_extension');
       url.searchParams.set('utm_campaign', 'sideai_extension');
       return url.toString();
     } catch (_) {
       return rawUrl;
     }
   }

   function getDefaultSideAIRatingPromptState() {
     return {
       openCount: 0,
       hasSuccessfulResponse: false,
       successfulResponseCount: 0,
       dismissedUntil: null,
       completedAt: null,
       completedReason: null,
       lastShownAt: null,
       lastRating: null
     };
   }

   function normalizeSideAIRatingPromptState(value) {
     const defaults = getDefaultSideAIRatingPromptState();
     const input = value && typeof value === 'object' ? value : {};
     const toNumberOrNull = (candidate) => {
       const parsed = Number(candidate);
       return Number.isFinite(parsed) ? parsed : null;
     };

     return {
       openCount: Math.max(0, Number(input.openCount) || 0),
       hasSuccessfulResponse: Boolean(input.hasSuccessfulResponse),
       successfulResponseCount: Math.max(0, Number(input.successfulResponseCount) || 0),
       dismissedUntil: toNumberOrNull(input.dismissedUntil),
       completedAt: toNumberOrNull(input.completedAt),
       completedReason: typeof input.completedReason === 'string' ? input.completedReason : defaults.completedReason,
       lastShownAt: toNumberOrNull(input.lastShownAt),
       lastRating: toNumberOrNull(input.lastRating)
     };
   }

   async function loadSideAIRatingPromptState() {
     const data = await chrome.storage.local.get([SIDEAI_RATING_PROMPT_STATE_KEY]);
     sideAIRatingPromptState = normalizeSideAIRatingPromptState(data[SIDEAI_RATING_PROMPT_STATE_KEY]);
     return sideAIRatingPromptState;
   }

   async function saveSideAIRatingPromptState() {
     if (!sideAIRatingPromptState) {
       sideAIRatingPromptState = getDefaultSideAIRatingPromptState();
     }
     await chrome.storage.local.set({
       [SIDEAI_RATING_PROMPT_STATE_KEY]: normalizeSideAIRatingPromptState(sideAIRatingPromptState)
     });
   }

   async function ensureSideAIRatingPromptState() {
     if (sideAIRatingPromptState) return sideAIRatingPromptState;
     return loadSideAIRatingPromptState();
   }

   function updateTopSlotBanners() {
     if (sideAIRatingPromptEls.banner) {
       sideAIRatingPromptEls.banner.hidden = !(sideAIRatingPromptVisible && !sideAIUpdateVisible);
     }

     if (sideAIShortcutHintEls.banner) {
       const shouldShowShortcutHint = !sideAIUpdateVisible && !sideAIRatingPromptVisible && !sideAIShortcutHintDismissed;
       sideAIShortcutHintEls.banner.hidden = !shouldShowShortcutHint;
     }
   }

   function isSideAIRatingPromptEligible() {
     if (!sideAIUpdateNoticeResolved) return false;
     if (sideAIRatingPromptSuppressedForSession || sideAIUpdateVisible) return false;
     if (!sideAIRatingPromptState) return false;
     if (sideAIRatingPromptState.completedAt) return false;
     if (sideAIRatingPromptState.openCount < SIDEAI_RATING_PROMPT_MIN_OPEN_COUNT) return false;
     if (sideAIRatingPromptState.dismissedUntil && sideAIRatingPromptState.dismissedUntil > Date.now()) return false;
     return true;
   }

   async function showSideAIRatingPrompt() {
     if (!sideAIRatingPromptEls.banner) return;
     await ensureSideAIRatingPromptState();
     if (!isSideAIRatingPromptEligible()) return;
     sideAIRatingPromptVisible = true;
     sideAIRatingPromptState.lastShownAt = Date.now();
     await saveSideAIRatingPromptState();
     updateTopSlotBanners();
   }

   function hideSideAIRatingPrompt() {
     sideAIRatingPromptVisible = false;
     hoveredSideAIRatingPromptStarValue = 0;
     highlightSideAIRatingPromptStars(0);
     updateTopSlotBanners();
   }

   async function snoozeSideAIRatingPrompt(lastRating = null) {
     await ensureSideAIRatingPromptState();
     sideAIRatingPromptState.dismissedUntil = Date.now() + SIDEAI_RATING_PROMPT_SNOOZE_MS;
     sideAIRatingPromptState.lastRating = Number.isFinite(Number(lastRating)) ? Number(lastRating) : sideAIRatingPromptState.lastRating;
     await saveSideAIRatingPromptState();
     hideSideAIRatingPrompt();
   }

   async function completeSideAIRatingPrompt(lastRating) {
     await ensureSideAIRatingPromptState();
     sideAIRatingPromptState.completedAt = Date.now();
     sideAIRatingPromptState.completedReason = 'high_rating';
     sideAIRatingPromptState.lastRating = Number(lastRating);
     sideAIRatingPromptState.dismissedUntil = null;
     await saveSideAIRatingPromptState();
     hideSideAIRatingPrompt();
   }

   async function recordSideAIRatingPromptSuccess() {
     await ensureSideAIRatingPromptState();
     sideAIRatingPromptState.hasSuccessfulResponse = true;
     sideAIRatingPromptState.successfulResponseCount += 1;
     await saveSideAIRatingPromptState();
   }

   async function refreshSideAIShortcutHint() {
     const shortcuts = await getSideAIShortcuts();
     renderShortcutKeys(shortcuts.action);
     renderShortcutKeys(shortcuts.resume, sideAIShortcutHintEls.resumeKeys);
     renderShortcutKeys(shortcuts.last, sideAIShortcutHintEls.lastKeys);
   }

   async function initSideAIShortcutHint() {
     if (!sideAIShortcutHintEls.banner) return;
     try {
       const data = await chrome.storage.local.get([SIDEAI_SHORTCUT_HINT_DISMISSED_KEY]);
       sideAIShortcutHintDismissed = Boolean(data[SIDEAI_SHORTCUT_HINT_DISMISSED_KEY]);
       if (sideAIShortcutHintDismissed) {
         updateTopSlotBanners();
         return;
       }
       await refreshSideAIShortcutHint();
       updateTopSlotBanners();
     } catch (error) {
       console.warn('[Sidepanel] Unable to initialize shortcut hint:', error);
     }
   }

   window.addEventListener('focus', () => {
     if (sideAIShortcutHintEls.banner && !sideAIShortcutHintDismissed) void refreshSideAIShortcutHint();
   });
   document.addEventListener('visibilitychange', () => {
     if (!document.hidden && sideAIShortcutHintEls.banner && !sideAIShortcutHintDismissed) void refreshSideAIShortcutHint();
   });

   async function initSideAIRatingPrompt() {
     if (!sideAIRatingPromptEls.banner) return;
     try {
       await loadSideAIRatingPromptState();
       sideAIRatingPromptState.openCount += 1;
       await saveSideAIRatingPromptState();
       await showSideAIRatingPrompt();
     } catch (error) {
       console.warn('[Sidepanel] Unable to initialize rating prompt:', error);
     }
   }

   sideAIShortcutHintEls.dismiss?.addEventListener('click', async () => {
     sideAIShortcutHintDismissed = true;
     updateTopSlotBanners();
     try {
       await chrome.storage.local.set({ [SIDEAI_SHORTCUT_HINT_DISMISSED_KEY]: true });
     } catch (error) {
       console.warn('[Sidepanel] Unable to save shortcut hint dismiss state:', error);
     }
   });

   sideAIShortcutHintEls.settings?.addEventListener('click', () => {
     chrome.runtime.sendMessage({
       type: 'SIDEAI_OPEN_SHORTCUT_SETTINGS'
     }).catch(() => {});
   });

   function renderSideAIUpdateSlide() {
     if (!sideAIUpdateEls.overlay) return;
     const feature = SIDEAI_UPDATE_FEATURES[sideAIUpdateSlideIndex] || SIDEAI_UPDATE_FEATURES[0];
     sideAIUpdateEls.image.src = chrome.runtime.getURL(feature.image);
     sideAIUpdateEls.image.alt = feature.title;
     sideAIUpdateEls.title.textContent = feature.title;
     sideAIUpdateEls.text.textContent = feature.text;
     sideAIUpdateEls.prev.disabled = sideAIUpdateSlideIndex === 0;
     sideAIUpdateEls.prev.style.opacity = sideAIUpdateSlideIndex === 0 ? '0.55' : '1';
     sideAIUpdateEls.next.textContent = sideAIUpdateSlideIndex === SIDEAI_UPDATE_FEATURES.length - 1 ? 'Done' : 'Next';

     sideAIUpdateEls.dots.innerHTML = '';
     SIDEAI_UPDATE_FEATURES.forEach((item, index) => {
       const dot = document.createElement('button');
       dot.type = 'button';
       dot.className = `sideai-update-dot${index === sideAIUpdateSlideIndex ? ' active' : ''}`;
       dot.setAttribute('aria-label', `Show ${item.title}`);
       dot.addEventListener('click', () => {
         sideAIUpdateSlideIndex = index;
         renderSideAIUpdateSlide();
       });
       sideAIUpdateEls.dots.appendChild(dot);
     });
   }

   function scheduleSideAIUpdateNotice(delay = 0) {
     clearTimeout(sideAIUpdateIdleTimer);
     sideAIUpdateIdleTimer = setTimeout(() => {
       if (!sideAIUpdateNotice || sideAIUpdateVisible || !sideAIUpdateIframeLoaded || sideAIUpdateWaitingForAnswer) return;
       showSideAIUpdateNotice();
     }, delay);
   }

   async function showSideAIUpdateNotice() {
     if (document.body.classList.contains('sideai-login-active')) return;
     if (!sideAIUpdateNotice || sideAIUpdateVisible || !sideAIUpdateEls.overlay) return;
     sideAIUpdateVisible = true;
     sideAIUpdateSlideIndex = 0;
     renderSideAIUpdateSlide();
     sideAIUpdateEls.overlay.hidden = false;
     updateTopSlotBanners();
     try {
       await chrome.runtime.sendMessage({
         type: 'markSideAIUpdateNoticeShown',
         version: sideAIUpdateNotice.version
       });
     } catch (_) {}
   }

   async function dismissSideAIUpdateNotice(disableNotifications = false) {
     if (!sideAIUpdateEls.overlay) return;
     const version = sideAIUpdateNotice?.version;
     sideAIUpdateEls.overlay.hidden = true;
     sideAIUpdateVisible = false;
     sideAIUpdateNotice = null;
     clearTimeout(sideAIUpdateIdleTimer);
     updateTopSlotBanners();
     try {
       await chrome.runtime.sendMessage({
         type: 'dismissSideAIUpdateNotice',
         version,
         disableNotifications
       });
     } catch (_) {}
   }

   async function initSideAIUpdateNotice() {
     try {
       const notice = await chrome.runtime.sendMessage({ type: 'getSideAIUpdateNotice' });
       if (!notice?.show) {
         sideAIUpdateNoticeResolved = true;
         await showSideAIRatingPrompt();
         return;
       }
       sideAIUpdateNotice = notice;
       sideAIRatingPromptSuppressedForSession = true;
       sideAIUpdateNoticeResolved = true;
       updateTopSlotBanners();
       if (sideAIUpdateIframeLoaded) {
         scheduleSideAIUpdateNotice(sideAIUpdateWaitingForAnswer ? 0 : 1800);
       }
     } catch (error) {
       sideAIUpdateNoticeResolved = true;
       void showSideAIRatingPrompt();
       console.warn('[Sidepanel] Unable to load update notice:', error);
     }
   }

   sideAIUpdateEls.close?.addEventListener('click', () => dismissSideAIUpdateNotice(false));
   sideAIUpdateEls.disable?.addEventListener('click', () => dismissSideAIUpdateNotice(true));
   sideAIUpdateEls.details?.addEventListener('click', () => {
     const url = buildSideAITrackedUrl(sideAIUpdateNotice?.detailsUrl || 'https://sideai.app/?utm_source=ext_update_onboarding_details_link&utm_medium=chrome_extension&utm_campaign=sideai_extension', 'ext_update_onboarding_details_link');
     chrome.runtime.sendMessage({ type: 'openExternalUrl', url }).catch(() => {});
   });
   sideAIUpdateEls.prev?.addEventListener('click', () => {
     if (sideAIUpdateSlideIndex === 0) return;
     sideAIUpdateSlideIndex -= 1;
     renderSideAIUpdateSlide();
   });
   sideAIUpdateEls.next?.addEventListener('click', () => {
     if (sideAIUpdateSlideIndex >= SIDEAI_UPDATE_FEATURES.length - 1) {
       dismissSideAIUpdateNotice(false);
       return;
     }
     sideAIUpdateSlideIndex += 1;
     renderSideAIUpdateSlide();
   });

   function relayMicrophoneResultToIframe(status, payload = {}) {
     const targetIframe = document.getElementById('chatgpt-iframe');
     if (!targetIframe || !targetIframe.contentWindow) return;

     const messageType = status === 'granted'
       ? MIC_PERMISSION_GRANTED_MESSAGE
       : MIC_PERMISSION_DENIED_MESSAGE;

     targetIframe.contentWindow.postMessage({
       type: messageType,
       source: 'sideai-sidepanel',
       requestIds: payload.requestIds || [],
       error: payload.error
     }, '*');

     if (status === 'granted') {
       targetIframe.contentWindow.postMessage({ type: 'MIC_ACCESS_GRANTED' }, '*');
     }

     console.log(`[Sidepanel ${timestamp()}] Relayed microphone ${status} result to iframe`);
   }

   function enableIframeMicrophoneDetector() {
     const targetIframe = document.getElementById('chatgpt-iframe');
     if (!targetIframe || !targetIframe.contentWindow) return;

     targetIframe.contentWindow.postMessage({
       type: 'SIDEAI_ENABLE_MIC_DETECTOR',
       source: 'sideai-sidepanel'
     }, '*');
   }

   async function relayCurrentActivePageToIframe() {
     const targetIframe = document.getElementById('chatgpt-iframe');
     if (!targetIframe || !targetIframe.contentWindow) return;
     try {
       const response = await chrome.runtime.sendMessage({ type: 'SIDEAI_GET_OPEN_PAGE_TABS', metadataOnly: true });
       if (!response?.success) return;
       const tabs = Array.isArray(response?.tabs) ? response.tabs : [];
       const current = tabs.find((tab) => tab.current) || null;
       targetIframe.contentWindow.postMessage({
         type: 'SIDEAI_ACTIVE_PAGE_CHANGED',
         source: 'sideai-sidepanel',
         tab: current
       }, '*');
     } catch (error) {
       console.warn('[Sidepanel] Unable to relay current active page:', error);
     }
   }

   let queuedExplicitFocusUntil = 0;
   function focusChatGPTIframeComposer(reason = 'keyboard-shortcut') {
     if (reason !== 'keyboard-shortcut') return;
     const targetIframe = document.getElementById('chatgpt-iframe');
     if (!targetIframe?.contentWindow) return;
     try {
       window.focus();
       targetIframe.focus({ preventScroll: true });
       targetIframe.contentWindow.focus?.();
     } catch (_) {}
     targetIframe.contentWindow.postMessage({ type: 'SIDEAI_FOCUS_COMPOSER', source: 'sideai-sidepanel', reason }, 'https://chatgpt.com');
   }
   window.sideAIFocusComposer = () => {
     window.sideAIPendingExplicitFocus = false;
     queuedExplicitFocusUntil = Date.now() + 30000;
     focusChatGPTIframeComposer();
   };
   window.addEventListener('blur', () => { setTimeout(() => { if (!document.hasFocus()) queuedExplicitFocusUntil = 0; }, 0); });
   window.addEventListener('message', event => {
     if (event.source === iframe.contentWindow && event.origin === 'https://chatgpt.com' &&
         event.data?.type === 'SIDEAI_CHAT_READY' && queuedExplicitFocusUntil > Date.now() && document.hasFocus()) {
       queuedExplicitFocusUntil = 0;
       focusChatGPTIframeComposer();
     }
   });
   if (window.sideAIPendingExplicitFocus) window.sideAIFocusComposer();

    iframe.addEventListener('load', () => {
      if (!iframe.hasAttribute('src')) return;
      sideAIUpdateIframeLoaded = true;
      enableIframeMicrophoneDetector();
      setTimeout(enableIframeMicrophoneDetector, 500);
      setTimeout(enableIframeMicrophoneDetector, 1500);
      setTimeout(relayCurrentActivePageToIframe, 500);
      setTimeout(relayCurrentActivePageToIframe, 1500);
      void chrome.windows.getCurrent().then(win => {
        iframe.contentWindow?.postMessage({type:'SIDEAI_PANEL_CONTEXT',windowId:win.id},'https://chatgpt.com');
      });
      if (queuedExplicitFocusUntil > Date.now() && document.hasFocus()) focusChatGPTIframeComposer();
      scheduleSideAIUpdateNotice(1800);
    });

    window.addEventListener('focus', () => {
      refreshSideAIShortcutHint();
      setTimeout(relayCurrentActivePageToIframe, 250);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        refreshSideAIShortcutHint();
        setTimeout(relayCurrentActivePageToIframe, 250);
      }
    });


    initSideAIUpdateNotice();
    initSideAIShortcutHint();

    // ==========================
    // APPEARANCE / THEME HANDLING
    // ==========================
    const applyTheme = (isLight) => {
        document.body.classList.toggle('light-mode', Boolean(isLight));
    };

    try {
        const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)');
        applyTheme(colorSchemeQuery.matches);
        colorSchemeQuery.addEventListener('change', (event) => applyTheme(event.matches));
    } catch (error) {
        console.warn('[Sidepanel] Unable to listen for color scheme changes:', error);
        applyTheme(false);
    }

    // ==========================
    // FOOTER UI ENHANCEMENTS
    // ==========================
    const modalOverlay = document.getElementById('modal-overlay');
    const shareModal = document.getElementById('share-modal');
    const feedbackModal = document.getElementById('feedback-modal');
    const shareTrigger = document.getElementById('share-trigger');
    const feedbackTrigger = document.getElementById('feedback-trigger');
    const closeButtons = document.querySelectorAll('[data-close]');
    const shareStatus = document.getElementById('share-status');
    const feedbackStatus = document.getElementById('feedback-status');
    const shareOptions = document.querySelectorAll('.share-option');
    const feedbackForm = document.getElementById('feedback-form');
    const feedbackSubmit = document.getElementById('feedback-submit');
    const feedbackMessage = document.getElementById('feedback-message');
    const feedbackRatingInput = document.getElementById('feedback-rating-input');
    const ratingContainer = document.getElementById('rating-container');
    const ratingTooltip = document.getElementById('rating-emoji-tooltip');
    const ratingEmoji = document.getElementById('rating-emoji');
    const ratingCaption = document.getElementById('rating-caption');
    const ratingStars = Array.from(document.querySelectorAll('.rating-star'));

    const shareUrl = 'https://chromewebstore.google.com/detail/hcjmcpfahioghphbgfokmijhkccofkci';
    const shareText = 'Sidebar for ChatGPT - Free Access';
    const shareTargets = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        x: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`
    };

    const ratingEmotions = {
        1: { emoji: '😞', caption: 'Not great' },
        2: { emoji: '😕', caption: 'Needs work' },
        3: { emoji: '😐', caption: 'It’s okay' },
        4: { emoji: '😊', caption: 'Pretty good' },
        5: { emoji: '😍', caption: 'Love it!' }
    };

    let currentRating = 0;
    let tooltipTimeout = null;
    let hoveredStarValue = 0;
    let hoveredSideAIRatingPromptStarValue = 0;

    const resetShareStatus = () => {
        if (!shareStatus) return;
        shareStatus.textContent = '';
        shareStatus.classList.remove('success', 'error', 'info');
    };

    const resetFeedbackStatus = () => {
        if (!feedbackStatus) return;
        feedbackStatus.textContent = '';
        feedbackStatus.classList.remove('success', 'error', 'info');
    };

    const highlightStars = (value) => {
        ratingStars.forEach((star) => {
            const starValue = Number(star.dataset.value);
            const isActive = value && starValue <= value;
            star.classList.toggle('active', Boolean(isActive));
            star.setAttribute('aria-checked', starValue === value ? 'true' : 'false');
        });
    };

    const highlightSideAIRatingPromptStars = (value) => {
        sideAIRatingPromptEls.stars.forEach((star) => {
            const starValue = Number(star.dataset.value);
            const isActive = value && starValue <= value;
            star.classList.toggle('active', Boolean(isActive));
            star.setAttribute('aria-checked', starValue === value ? 'true' : 'false');
        });
    };

    const hideRatingTooltip = () => {
        if (!ratingTooltip) return;
        ratingTooltip.classList.remove('visible');
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }
    };

    const showRatingTooltip = (value, anchor) => {
        if (!ratingTooltip || !ratingContainer) return;
        const emotion = ratingEmotions[value];
        if (!emotion) return;

        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = null;
        }

        if (ratingEmoji) ratingEmoji.textContent = emotion.emoji;
        if (ratingCaption) ratingCaption.textContent = emotion.caption;
        ratingTooltip.setAttribute('aria-label', emotion.caption);

        const containerRect = ratingContainer.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const left = anchorRect.left + anchorRect.width / 2 - containerRect.left;
        ratingTooltip.style.left = `${left}px`;
        ratingTooltip.classList.add('visible');
    };

    const scheduleTooltipHide = (delay = 1800) => {
        if (!ratingTooltip) return;
        if (tooltipTimeout) {
            clearTimeout(tooltipTimeout);
        }
        tooltipTimeout = setTimeout(() => {
            hideRatingTooltip();
        }, delay);
    };

    const closeModals = (options = {}) => {
        const { keepOverlay = false } = options;
        [shareModal, feedbackModal].forEach((modal) => modal?.classList.remove('visible'));

        if (!keepOverlay) {
            modalOverlay?.classList.remove('visible');
        }

        resetShareStatus();
        resetFeedbackStatus();
        // Restore hover state if mouse is still over a star, otherwise reset
        if (hoveredStarValue > 0) {
            highlightStars(hoveredStarValue);
        } else {
            highlightStars(0);
        }

        if (feedbackSubmit) {
            feedbackSubmit.disabled = false;
            feedbackSubmit.textContent = 'Send';
        }
    };

    const openModal = (modal) => {
        if (!modal) return;
        closeModals({ keepOverlay: true });
        modalOverlay?.classList.add('visible');
        modal.classList.add('visible');

        if (modal === feedbackModal) {
            if (feedbackRatingInput) {
                feedbackRatingInput.value = currentRating ? String(currentRating) : '';
            }
            if (feedbackMessage) {
                // Focus textarea slightly after opening for smooth animation
                setTimeout(() => {
                    try {
                        feedbackMessage.focus({ preventScroll: true });
                    } catch (error) {
                        feedbackMessage.focus();
                    }
                }, 160);
            }
        }
    };

    const handleShareOption = async (option) => {
        const type = option.dataset.share;
        resetShareStatus();

        if (type === 'copy') {
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(shareUrl);
                } else {
                    const tempInput = document.createElement('textarea');
                    tempInput.value = shareUrl;
                    tempInput.style.position = 'fixed';
                    tempInput.style.opacity = '0';
                    document.body.appendChild(tempInput);
                    tempInput.select();
                    document.execCommand('copy');
                    document.body.removeChild(tempInput);
                }
                shareStatus.textContent = 'Link copied — thank you for sharing!';
                shareStatus.classList.add('success');
            } catch (error) {
                console.error('[Sidepanel] Clipboard copy failed:', error);
                shareStatus.textContent = 'Could not copy the link. Please try again.';
                shareStatus.classList.add('error');
            }
            return;
        }

        const targetUrl = shareTargets[type];
        if (targetUrl) {
            shareStatus.textContent = 'Opening share window…';
            shareStatus.classList.add('info');
            chrome.runtime.sendMessage({ type: 'openExternalUrl', url: targetUrl });
        }
    };

    const openRatingPage = () => {
        chrome.runtime.sendMessage({ type: 'openRatingPage' });
    };

    const applyRatingSelection = async (value) => {
        currentRating = value;
        if (feedbackRatingInput) {
            feedbackRatingInput.value = String(value);
        }

        if (value <= 3) {
            await snoozeSideAIRatingPrompt(value);
            resetFeedbackStatus();
            openModal(feedbackModal);
            return;
        }

        await completeSideAIRatingPrompt(value);
        closeModals();
        openRatingPage();
    };

    const handleStarInteraction = (value, anchor, triggerAction = false) => {
        currentRating = value;
        // Maintain hover state - if hovering, keep it; otherwise highlight clicked value
        if (hoveredStarValue > 0) {
            highlightStars(hoveredStarValue);
        } else {
            highlightStars(value);
        }
        if (feedbackRatingInput) {
            feedbackRatingInput.value = String(value);
        }
        showRatingTooltip(value, anchor);

        if (triggerAction) {
            scheduleTooltipHide(1400);
            void applyRatingSelection(value);
        }
    };

    // Event bindings
    shareTrigger?.addEventListener('click', () => {
        resetShareStatus();
        openModal(shareModal);
    });

    feedbackTrigger?.addEventListener('click', () => {
        resetFeedbackStatus();
        openModal(feedbackModal);
    });

    closeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            closeModals();
        });
    });

    modalOverlay?.addEventListener('click', () => {
        closeModals();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeModals();
        }
    });

    ratingStars.forEach((star) => {
        star.addEventListener('mouseenter', (event) => {
            const value = Number(star.dataset.value);
            hoveredStarValue = value;
            highlightStars(value);
            showRatingTooltip(value, event.currentTarget);
        });

        star.addEventListener('focus', (event) => {
            const value = Number(star.dataset.value);
            highlightStars(value);
            showRatingTooltip(value, event.currentTarget);
        });

        star.addEventListener('blur', () => {
            if (hoveredStarValue > 0) {
                highlightStars(hoveredStarValue);
            } else if (currentRating > 0) {
                highlightStars(currentRating);
            } else {
                highlightStars(0);
            }
            scheduleTooltipHide(200);
        });

        star.addEventListener('click', (event) => {
            event.stopPropagation();
            const value = Number(star.dataset.value);
            // Update hoveredStarValue to current star before handling interaction
            hoveredStarValue = value;
            handleStarInteraction(value, event.currentTarget, true);
            // Hover state is maintained naturally by mouseenter/mouseleave on container
        });

        star.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const value = Number(star.dataset.value);
                hoveredStarValue = value;
                handleStarInteraction(value, event.currentTarget, true);
                if (hoveredStarValue > 0) {
                    highlightStars(hoveredStarValue);
                } else if (currentRating > 0) {
                    highlightStars(currentRating);
                }
            }
        });
    });

    // Handle mouseleave on the entire rating container (not individual stars)
    // This prevents reset when clicking or moving between stars
    ratingContainer?.addEventListener('mouseleave', () => {
        hoveredStarValue = 0;
        highlightStars(0);
        scheduleTooltipHide(200);
    });

    sideAIRatingPromptEls.stars.forEach((star) => {
        star.addEventListener('mouseenter', () => {
            const value = Number(star.dataset.value);
            hoveredSideAIRatingPromptStarValue = value;
            highlightSideAIRatingPromptStars(value);
        });

        star.addEventListener('focus', () => {
            const value = Number(star.dataset.value);
            hoveredSideAIRatingPromptStarValue = value;
            highlightSideAIRatingPromptStars(value);
        });

        star.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const value = Number(star.dataset.value);
            hoveredSideAIRatingPromptStarValue = value;
            highlightSideAIRatingPromptStars(value);
            void applyRatingSelection(value);
        });

        star.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                const value = Number(star.dataset.value);
                hoveredSideAIRatingPromptStarValue = value;
                highlightSideAIRatingPromptStars(value);
                void applyRatingSelection(value);
            }
        });
    });

    sideAIRatingPromptEls.starsGroup?.addEventListener('mouseleave', () => {
        hoveredSideAIRatingPromptStarValue = 0;
        highlightSideAIRatingPromptStars(0);
    });

    sideAIRatingPromptEls.banner?.addEventListener('focusout', (event) => {
        if (!sideAIRatingPromptEls.banner?.contains(event.relatedTarget)) {
            hoveredSideAIRatingPromptStarValue = 0;
            highlightSideAIRatingPromptStars(0);
        }
    });

    sideAIRatingPromptEls.later?.addEventListener('click', () => {
        void snoozeSideAIRatingPrompt();
    });

    sideAIRatingPromptEls.dismiss?.addEventListener('click', () => {
        void snoozeSideAIRatingPrompt();
    });

    shareOptions.forEach((option) => {
        option.addEventListener('click', () => handleShareOption(option));
        option.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleShareOption(option);
            }
        });
    });

    feedbackForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!feedbackForm || !feedbackSubmit) return;

        resetFeedbackStatus();

        const messageValue = feedbackMessage?.value.trim();
        if (!messageValue) {
            feedbackStatus.textContent = 'Please add a quick note before sending.';
            feedbackStatus.classList.add('error');
            return;
        }

        feedbackSubmit.disabled = true;
        feedbackSubmit.textContent = 'Sending…';
        feedbackStatus.textContent = 'Sending your feedback…';
        feedbackStatus.classList.add('info');

        const formData = new FormData(feedbackForm);
        formData.set('timestamp', new Date().toISOString());
        if (currentRating) {
            formData.set('rating', String(currentRating));
        }

        try {
            const response = await fetch('https://formspree.io/f/xwpparjj', {
                method: 'POST',
                body: formData,
                headers: {
                    Accept: 'application/json'
                }
            });

            if (response.ok) {
                feedbackStatus.textContent = 'Thank you! We read every note. 💜';
                feedbackStatus.classList.remove('info');
                feedbackStatus.classList.add('success');
                feedbackForm.reset();
                if (feedbackRatingInput) {
                    feedbackRatingInput.value = '';
                }
                setTimeout(() => {
                    feedbackSubmit.disabled = false;
                    feedbackSubmit.textContent = 'Send';
                    closeModals();
                }, 1400);
            } else {
                throw new Error(`Formspree responded with status ${response.status}`);
            }
        } catch (error) {
            console.error('[Sidepanel] Feedback submission failed:', error);
            feedbackStatus.textContent = 'Something went wrong. Please try again in a moment.';
            feedbackStatus.classList.remove('info');
            feedbackStatus.classList.add('error');
            feedbackSubmit.disabled = false;
            feedbackSubmit.textContent = 'Send';
        }
    });

    // ==========================
    // END FOOTER UI ENHANCEMENTS
    // ==========================

const timestamp = () => new Date().toISOString();
console.log(`[Sidepanel ${timestamp()}] Script loaded`);

// Store message chunks
let messageChunks = [];
let expectedChunks = 0;

// Function to connect to background script
function connectToBackground() {
    // Connect to background script
    const port = chrome.runtime.connect({ name: 'sidepanel' });
    console.log(`[Sidepanel ${timestamp()}] Connected to background script`);

    // Listen for messages from background script through port
    port.onMessage.addListener((message) => {
        console.log(`[Sidepanel ${timestamp()}] Received message through port:`, message);
        
        if (message.action === 'summarizeText') {
            sideAIUpdateWaitingForAnswer = true;
            clearTimeout(sideAIUpdateIdleTimer);
            // Handle chunked messages
            if ('chunkIndex' in message && 'totalChunks' in message) {
                console.log(`[Sidepanel ${timestamp()}] Received chunk ${message.chunkIndex + 1} of ${message.totalChunks}`);
                
                // Store chunk
                messageChunks[message.chunkIndex] = message.prompt;
                expectedChunks = message.totalChunks;
                
                // Check if we have all chunks
                if (messageChunks.filter(chunk => chunk !== undefined).length === expectedChunks) {
                    processCompleteMessage();
                }
            } else {
                // Handle single message (backwards compatibility)
                messageChunks = [message.prompt];
                processCompleteMessage();
            }
        }

        if (message.action === 'micPermissionResult') {
            relayMicrophoneResultToIframe(message.status, message);
        }

        if (message.action === 'uploadScreenshots' && Array.isArray(message.images)) {
            const iframe = document.getElementById('chatgpt-iframe');
            if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'UPLOAD_SCREENSHOTS',
                    source: 'sidebar-extension',
                    images: message.images
                }, '*');
            }
        }

        if (message.action === 'sideaiActivePageChanged') {
            const iframe = document.getElementById('chatgpt-iframe');
            if (iframe?.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'SIDEAI_ACTIVE_PAGE_CHANGED',
                    source: 'sideai-sidepanel',
                    tab: message.tab || null
                }, '*');
            }
        }
    });

    // Handle disconnection
    port.onDisconnect.addListener(() => {
        console.log(`[Sidepanel ${timestamp()}] Disconnected from background script`);
        // Try to reconnect after a short delay
        setTimeout(connectToBackground, 1000);
    });

    return port;
}

// Function to process complete message
function processCompleteMessage() {
    console.log(`[Sidepanel ${timestamp()}] Processing complete message`);
    const completeMessage = messageChunks.join('');
    messageChunks = []; // Reset for next message
    
    try {
        console.log(`[Sidepanel ${timestamp()}] Processing summarizeText action`);
        const iframe = document.getElementById('chatgpt-iframe');
        
        if (iframe) {
            console.log(`[Sidepanel ${timestamp()}] Found iframe, sending message to ChatGPT`);
            
            // Send message to ChatGPT iframe
            const msg = {
                source: 'sidebar-extension',
                prompt: completeMessage,
                autoSend: true,
                timestamp: timestamp()
            };
            console.log(`[Sidepanel ${timestamp()}] Preparing message:`, msg);
            
            iframe.contentWindow.postMessage(msg, '*');
            console.log(`[Sidepanel ${timestamp()}] Message sent to iframe`);
        } else {
            console.error(`[Sidepanel ${timestamp()}] ChatGPT iframe not found`);
        }
    } catch (error) {
        console.error(`[Sidepanel ${timestamp()}] Error processing message:`, error);
    }
}

// Function to send text to ChatGPT iframe
function sendToChatGPT(text) {
    console.log(`[Sidepanel ${timestamp()}] Attempting to send text to ChatGPT iframe...`);
    
    // Get the iframe
    const iframe = document.getElementById('chatgpt-iframe');
    if (!iframe) {
        console.error(`[Sidepanel ${timestamp()}] ChatGPT iframe not found`);
        return;
    }

    // Wait for iframe to load
    if (!iframe.contentWindow) {
        console.log(`[Sidepanel ${timestamp()}] Iframe not ready, waiting...`);
        setTimeout(() => sendToChatGPT(text), 1000);
        return;
    }

    // Send message to iframe
    console.log(`[Sidepanel ${timestamp()}] Sending message to iframe...`);
    iframe.contentWindow.postMessage({
        action: 'summarizeText',
        prompt: text
    }, '*');
}

// Function to fetch conversations
async function fetchConversations(offset = 0, limit = 28) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getConversations',
            offset,
            limit
        });
        
        if (response.success) {
            console.log('[Sidepanel] Fetched conversations:', response.data);
            return response.data;
        } else {
            throw new Error(response.error);
        }
    } catch (error) {
        console.error('[Sidepanel] Error fetching conversations:', error);
        throw error;
    }
}

// Function to make ChatGPT API requests
async function makeGPTRequest(url, options = {}) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'fetchFromChatGPT',
            url,
            options
        });
        
        if (response.success) {
            console.log('[Sidepanel] API response:', response);
            return response;
        } else {
            console.error('[Sidepanel] API error:', response.error);
            throw new Error(response.error);
        }
    } catch (error) {
        console.error('[Sidepanel] Request failed:', error);
        throw error;
    }
}

// Example function to get conversations
async function getConversations(offset = 0, limit = 28) {
    const url = `https://chatgpt.com/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`;
    const options = {
        method: 'GET',
        headers: {
            "Authorization": "Bearer YOUR_TOKEN_HERE" // Replace with actual token
        }
    };
    
    return makeGPTRequest(url, options);
}

// Listen for responses from the ChatGPT iframe
window.addEventListener('message', (event) => {
    console.log(`[Sidepanel ${timestamp()}] Received postMessage event:`, {
        origin: event.origin,
        data: event.data?.type === 'open-login'
            ? { type: 'open-login', guest: !!event.data.guest }
            : event.data
    });

    if (event.data && event.data.type === 'CHATGPT_RESPONSE') {
        console.log(`[Sidepanel ${timestamp()}] Received response from ChatGPT:`, event.data);
        sideAIUpdateWaitingForAnswer = false;
        scheduleSideAIUpdateNotice(650);
        if (event.data.success) {
            void recordSideAIRatingPromptSuccess();
        }
        
        // Send response back to background script
        port.postMessage({
            action: 'chatgptResponse',
            success: event.data.success,
            timestamp: timestamp()
        });
        console.log(`[Sidepanel ${timestamp()}] Sent response to background`);
    }
    
    // Listen for voice mode requests from the ChatGPT iframe
    if (event.data && event.data.type === 'VOICE_MODE_REQUESTED') {
        console.log(`[Sidepanel ${timestamp()}] Voice mode requested from ChatGPT iframe`);
        handleVoiceModeActivation(event.data);
    }

    // Handle login intent signaled from iframe content script
    if (event.data && event.data.type === 'open-login') {
        const loginUrl = event.data.url || 'https://chatgpt.com/auth/login';
        const loginFrame = document.getElementById('chatgpt-iframe');
        if (event.source !== loginFrame?.contentWindow || !['https://chatgpt.com', 'https://chat.openai.com'].includes(event.origin)) return;
        try {
            const url = new URL(loginUrl);
            if (url.protocol !== 'https:' || !(url.hostname === 'auth.openai.com' ||
                (['chatgpt.com', 'chat.openai.com'].includes(url.hostname) && /^\/(?:(?:auth\/)?(?:login|signin|signup)|auth\/login_with)\/?$/.test(url.pathname)))) return;
        } catch (_) { return; }
        console.log(`[Sidepanel ${timestamp()}] Login intent detected, opening new tab.`);
        if (event.data.guest) {
            chrome.tabs.create({ url: loginUrl })
                .catch(error => console.warn('[Sidepanel] Could not open guest login tab:', error));
            sideAIShowLoginHelp('waiting');
            return;
        }
        // Ask background to open login in a new tab (preserves OAuth state)
        chrome.runtime.sendMessage({ type: 'open-login', url: loginUrl });
        sideAIShowLoginHelp('waiting');
    }
});

// Function to handle voice mode activation
function handleVoiceModeActivation(meta = {}) {
    console.log(`[Sidepanel ${timestamp()}] Voice mode activation requested`);
    
    // Request microphone permission through background script
    chrome.runtime.sendMessage({
        type: 'request-mic-access',
        source: meta.source || 'sidepanel-voice-request',
        requestId: meta.requestId || null,
        apiName: meta.apiName || null
    }, (response) => {
        console.log(`[Sidepanel ${timestamp()}] Mic access response:`, response);
        
        if (response && response.granted) {
            relayMicrophoneResultToIframe('granted', { requestIds: meta.requestId ? [meta.requestId] : [] });
        }
    });
}

// Event listener for activate voice mode button (if it exists in sidepanel)
const activateVoiceModeButton = document.querySelector('[aria-label="Activate voice mode"]');
if (activateVoiceModeButton) {
    activateVoiceModeButton.addEventListener('click', handleVoiceModeActivation);
}


// Connect immediately when the script loads
const port = connectToBackground();

initSideAIRatingPrompt();

console.log(`[Sidepanel ${timestamp()}] Sidepanel initialized`);
});

// Find belongs to the focused sidepanel, including when its outer shell has focus.
document.addEventListener('keydown', event => {
 if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
   const frame = Array.from(document.querySelectorAll('iframe')).find(f => /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(f.src));
   if (!frame) return;
   event.preventDefault(); event.stopImmediatePropagation();
   frame.contentWindow.postMessage({type:'SIDEAI_FIND_IN_CHAT'},new URL(frame.src).origin);
 }
}, true);
