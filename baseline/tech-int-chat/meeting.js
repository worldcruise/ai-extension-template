// Google Meet Chat Monitor
// Old working behavior kept: every opened Meet tab can feed the same transcript panel.
// Improvements: no automatic transcript clearing, safer multi-Meet capture, bounded memory,
// periodic container revalidation, retry-safe patch queue, and unchanged Google Meet selectors.
(function () {
    "use strict";

    if (window.__techIntChatOldBaseMonitor && !window.__techIntChatOldBaseMonitor.stopped) {
        console.debug("Meeting monitor already running; skip duplicate startup.");
        return;
    }


    // Keep the known-working Google Meet selectors unchanged.
    // Do not add fuzzy selector discovery/fallbacks unless the known selector fully breaks.
    const SELECTORS = {
        containers: ["div.iOzk7"],
        messages: [".nMcdL.bj4p3b"],
        speakers: [".jxFHg"],
        contents: [".ygicle.VbkSUe"]
    };

    const HEALTH_INTERVAL_MS = 10000;      // slow recovery check; ordinary capture is observer-driven
    const OBSERVER_SCAN_DELAY_MS = 60;     // observer-assisted fast scan after real DOM changes
    const PATCH_DEBOUNCE_MS = 80;
    const RETRY_PATCH_MS = 1000;
    const VISIBLE_SCAN_LIMIT = 8;
    const MAX_LOCAL_RAW_CHATS = 800;
    const MAX_PENDING_GROUPS = 800;
    const MAX_PENDING_CHARS = 2 * 1024 * 1024;
    const MAX_CAPTION_CHARS = 65536;
    const PATCH_TIMEOUT_MS = 10000;
    const MAX_GROUPS_PER_PATCH = 16;
    const rowRevisions = new WeakMap();

    const sourceInstanceId = makeSourceInstanceId();
    const rawChats = new Map();
    const rawOrder = [];
    const splitCache = new Map();
    // Latest complete revision of each raw caption, not independent mutable chunk objects.
    const pendingChanges = new Map();
    let epoch = null;
    let inFlight = null;
    let sendAttempt = 0;
    let ackTimer = null;
    let discoveryObserver = null;
    let started = false;
    let pendingChars = 0;
    let warningShown = false;
    let capturePaused = false;
    let deliveryBlocked = false;
    const speakers = new Set();

    let activeContainer = null;
    let captionObserver = null;
    let intervalId = null;
    let scanTimer = null;
    let patchTimer = null;
    let stopped = false;

    window.__techIntChatOldBaseMonitor = {
        sourceInstanceId: sourceInstanceId,
        stopped: false,
        scanNow: monitorChats,
        diagnostics: function () { return { capturePaused: capturePaused, deliveryBlocked: deliveryBlocked,
            pendingGroups: pendingChanges.size, pendingChars: pendingChars }; },
        stop: function () { stopMonitoring("manual stop"); }
    };

    function makeSourceInstanceId() {
        const randomPart = Math.random().toString(36).slice(2, 10);
        return `src_${Date.now().toString(36)}_${randomPart}`;
    }

    function cleanText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function isExtensionContextValid() {
        try {
            return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage;
        } catch (error) {
            return false;
        }
    }

    function generateLocalTicId() {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let result = "";
        for (let i = 0; i < 7; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `${sourceInstanceId}_${Date.now().toString(36)}_${result}`;
    }

    function queryAllSafe(root, selectors) {
        const results = [];
        const seen = new Set();
        selectors.forEach(function (selector) {
            try {
                const nodes = Array.from((root || document).querySelectorAll(selector));
                nodes.forEach(function (node) {
                    if (node && !seen.has(node)) {
                        seen.add(node);
                        results.push(node);
                    }
                });
            } catch (error) {
                // Ignore unexpected selector errors without changing the selector set.
            }
        });
        return results;
    }

    function queryFirstSafe(root, selectors) {
        for (const selector of selectors) {
            try {
                const found = (root || document).querySelector(selector);
                if (found) {
                    return found;
                }
            } catch (error) {
                // Ignore unexpected selector errors without changing the selector set.
            }
        }
        return null;
    }

    function isVisible(element) {
        if (!element || !document.documentElement.contains(element)) {
            return false;
        }
        const style = window.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getCandidateContainers() {
        return queryAllSafe(document, SELECTORS.containers).filter(isVisible);
    }

    function closestSafe(element, selector) {
        try {
            return element && element.closest ? element.closest(selector) : null;
        } catch (error) {
            return null;
        }
    }

    function getMessageElements(container) {
        if (!container) {
            return [];
        }

        const rows = queryAllSafe(container, SELECTORS.messages).filter(function (row) {
            return row !== container && isVisible(row) && cleanText(row.innerText || row.textContent).length > 0;
        });

        return rows.slice(-VISIBLE_SCAN_LIMIT);
    }

    function scoreContainer(container) {
        if (!isVisible(container)) {
            return -1;
        }
        const rows = getMessageElements(container);
        const textLength = cleanText(container.innerText || container.textContent).length;
        let score = rows.length * 20 + Math.min(textLength, 500) / 10;
        try {
            const label = String(container.getAttribute("aria-label") || "").toLowerCase();
            if (label.includes("caption") || label.includes("transcript")) {
                score += 80;
            }
            if (container.matches("div.iOzk7")) {
                score += 60;
            }
        } catch (error) {
            // ignore
        }
        return score;
    }

    function findActiveContainer() {
        const candidates = getCandidateContainers();
        if (candidates.length === 0) {
            return null;
        }
        candidates.sort(function (a, b) {
            return scoreContainer(b) - scoreContainer(a);
        });
        return candidates[0] || null;
    }

    function ensureCaptionObserver(revalidate) {
        if (!revalidate && activeContainer && activeContainer.isConnected && captionObserver && isVisible(activeContainer)) {
            return true;
        }
        const nextContainer = findActiveContainer();
        if (!nextContainer) {
            if (captionObserver) captionObserver.disconnect();
            captionObserver = null;
            activeContainer = null;
            return false;
        }

        // Important old-version behavior: re-find active container periodically.
        // If Meet creates a new active container, move observer to the best live one.
        if (nextContainer === activeContainer && captionObserver) {
            return true;
        }

        if (captionObserver) {
            captionObserver.disconnect();
            captionObserver = null;
        }

        activeContainer = nextContainer;
        captionObserver = new MutationObserver(function () {
            queueScan(OBSERVER_SCAN_DELAY_MS);
        });

        captionObserver.observe(activeContainer, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["class", "style", "hidden", "aria-hidden"]
        });

        return true;
    }

    function getOrCreateTicId(messageElement) {
        let ticId = messageElement.getAttribute("ticId") || messageElement.dataset.ticId;
        if (!ticId || !String(ticId).startsWith(sourceInstanceId)) {
            ticId = generateLocalTicId();
            messageElement.setAttribute("ticId", ticId);
            messageElement.dataset.ticId = ticId;
        }
        return ticId;
    }

    function readMessageElement(messageElement) {
        const speakerElement = queryFirstSafe(messageElement, SELECTORS.speakers);
        const contentElement = queryFirstSafe(messageElement, SELECTORS.contents);
        const speakerName = cleanText(speakerElement ? (speakerElement.innerText || speakerElement.textContent) : "") || "Unknown";
        let content = cleanText(contentElement ? (contentElement.innerText || contentElement.textContent) : (messageElement.innerText || messageElement.textContent));

        // If row text starts with the speaker name, strip the repeated visible label from content.
        if (speakerName !== "Unknown" && content.toLowerCase().startsWith(speakerName.toLowerCase())) {
            content = cleanText(content.slice(speakerName.length));
        }

        return { speakerName: speakerName, content: content };
    }

    function monitorChats() {
        if (stopped || capturePaused) {
            return;
        }

        try {
            if (!isExtensionContextValid()) {
                stopMonitoring("Extension context invalidated");
                return;
            }

            if (!ensureCaptionObserver()) {
                return;
            }

            const messageElements = getMessageElements(activeContainer);
            let changed = false;

            messageElements.forEach(function (messageElement) {
                if (stopped || capturePaused) return;
                try {
                    const ticId = getOrCreateTicId(messageElement);
                    const parsed = readMessageElement(messageElement);
                    const speakerName = parsed.speakerName;
                    const content = parsed.content;

                    if (!content) {
                        return;
                    }

                    if (content.length > MAX_CAPTION_CHARS) {
                        failCapture("A caption exceeded the safety limit. Download the transcript and use Clear before continuing.");
                        return;
                    }
                    speakers.add(speakerName);

                    const previous = rawChats.get(ticId);
                    if (!previous) {
                        const chat = {
                            role: speakerName,
                            content: content,
                            ticId: ticId,
                            isCurrentUser: speakerName === "You",
                            revision: (rowRevisions.get(messageElement) || 0) + 1
                        };
                        rowRevisions.set(messageElement, chat.revision);
                        rawChats.set(ticId, chat);
                        rawOrder.push(ticId);
                        processChangedRawChat(chat);
                        changed = true;
                    } else if (previous.content !== content || previous.role !== speakerName) {
                        previous.role = speakerName;
                        previous.content = content;
                        previous.isCurrentUser = speakerName === "You";
                        previous.revision += 1;
                        rowRevisions.set(messageElement, previous.revision);
                        processChangedRawChat(previous);
                        changed = true;
                    }
                } catch (messageError) {
                    console.warn("Error processing Meet caption row:", messageError && messageError.message ? messageError.message : messageError);
                }
            });

            trimLocalMemory();

            if (changed) {
                schedulePatchSend();
            }
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            if (message.includes("Extension context invalidated")) {
                stopMonitoring("Extension context invalidated");
            } else {
                console.warn("Meet monitoring warning:", message);
            }
        }
    }

    function queueScan(delayMs) {
        if (stopped || capturePaused || scanTimer) {
            return;
        }
        scanTimer = setTimeout(function () {
            scanTimer = null;
            monitorChats();
        }, delayMs || 0);
    }

    function processChangedRawChat(chat) {
        if (chat.content.length > MAX_CAPTION_CHARS) {
            failCapture("A caption exceeded the safety limit. Download the transcript and refresh Meet.");
            return;
        }
        // The original splitting algorithm below is deliberately unchanged.
        const chunks = splitChatContent(chat).map(function (chunk) { return Object.assign({}, chunk); });
        const previous = pendingChanges.get(chat.ticId);
        const chars = chunks.reduce(function (sum, chunk) { return sum + chunk.content.length; }, 0);
        const nextChars = pendingChars - (previous ? previous.chars : 0) + chars;
        if ((!previous && pendingChanges.size >= MAX_PENDING_GROUPS) || nextChars > MAX_PENDING_CHARS) {
            // Keep already captured data queued for delivery; stop reading more DOM
            // until acknowledgments make room. Never drop the unsent buffer here.
            capturePaused = true;
            if (!warningShown) {
                warningShown = true;
                console.warn("Tech Interview Chat: capture paused while buffered captions reconnect; it will resume when delivery recovers.");
            }
            return;
        }
        pendingChars = nextChars;
        pendingChanges.set(chat.ticId, { rawTicId: chat.ticId,
            revision: chat.revision, chunks: chunks, chars: chars });
        chat.queuedRevision = chat.revision;
    }

    function splitChatContent(chat) {
        const cached = splitCache.get(chat.ticId);
        if (cached && cached.originalContent === chat.content && cached.role === chat.role) {
            return cached.splitResults;
        }

        const words = cleanText(chat.content).split(" ").filter(Boolean);
        const results = [];
        let currentChunk = [];
        let chunkIndex = 0;

        function pushChunk() {
            const chunkContent = cleanText(currentChunk.join(" "));
            if (!chunkContent) {
                return;
            }
            results.push({
                role: chat.role,
                content: chunkContent,
                ticId: `${chat.ticId}_${chunkIndex}`,
                isCurrentUser: Boolean(chat.isCurrentUser)
            });
            chunkIndex += 1;
            currentChunk = [];
        }

        if (words.length < 20) {
            currentChunk = words;
            pushChunk();
        } else {
            words.forEach(function (word) {
                currentChunk.push(word);
                if (word.includes("?") || (currentChunk.length >= 20 && /[.!]$/.test(word))) {
                    pushChunk();
                }
            });
            if (currentChunk.length > 0) {
                pushChunk();
            }
        }

        splitCache.set(chat.ticId, {
            originalContent: chat.content,
            role: chat.role,
            splitResults: results
        });

        return results;
    }

    function trimLocalMemory() {
        while (rawOrder.length > MAX_LOCAL_RAW_CHATS) {
            const oldId = rawOrder.shift();
            rawChats.delete(oldId);
            splitCache.delete(oldId);
            // Never delete unacknowledged work when trimming the local DOM cache.
            // Do not send removals. Transcript should clear only by user action.
        }
    }

    function failCapture(message) {
        capturePaused = true;
        deliveryBlocked = true;
        sendAttempt++;
        if (patchTimer) clearTimeout(patchTimer);
        if (ackTimer) clearTimeout(ackTimer);
        patchTimer = null; ackTimer = null;
        // Preserve buffered work and the runtime listener until an explicit Clear
        // changes the epoch. A safety error is not permission to silently delete it.
        if (!warningShown) {
            warningShown = true;
            console.warn("Tech Interview Chat:", message);
        }
    }

    function schedulePatchSend(delayMs) {
        if (stopped || deliveryBlocked || patchTimer || inFlight) return;
        patchTimer = setTimeout(sendPatchToBackground, delayMs || PATCH_DEBOUNCE_MS);
    }

    function setEpoch(nextEpoch) {
        if (!Number.isSafeInteger(nextEpoch)) return;
        if (epoch !== null && epoch !== nextEpoch) {
            // User clear invalidates old queued/in-flight revisions, but retains the
            // local parsed baseline so unchanged visible captions do not reappear.
            pendingChanges.clear();
            pendingChars = 0;
            inFlight = null;
            sendAttempt++;
            if (ackTimer) clearTimeout(ackTimer);
            ackTimer = null;
            if (patchTimer) clearTimeout(patchTimer);
            patchTimer = null;
        }
        epoch = nextEpoch;
        if (deliveryBlocked || capturePaused) {
            capturePaused = false; deliveryBlocked = false; warningShown = false;
            queueScan(0);
        }
    }

    function resumeCaptureAfterDelivery() {
        if (!capturePaused || deliveryBlocked || pendingChanges.size >= MAX_PENDING_GROUPS ||
            pendingChars >= MAX_PENDING_CHARS / 2) return;
        capturePaused = false;
        for (const chat of rawChats.values()) {
            if (chat.queuedRevision !== chat.revision) processChangedRawChat(chat);
            if (capturePaused) break;
        }
        if (!capturePaused) { warningShown = false; queueScan(0); }
    }

    function registerSource() {
        return new Promise(function (resolve, reject) {
            let settled = false;
            const timer = setTimeout(function () {
                if (!settled) { settled = true; reject(new Error("Registration timeout")); }
            }, PATCH_TIMEOUT_MS);
            try {
                chrome.runtime.sendMessage({ type: "REGISTER_MEETING", sourceInstanceId: sourceInstanceId }, function (response) {
                    const error = chrome.runtime.lastError;
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (error || response?.status !== "ready" || response?.protocol !== 2) {
                        reject(new Error(error?.message || response?.error || "Refresh the extension and Meet tab"));
                        return;
                    }
                    setEpoch(response.epoch);
                    resolve();
                });
            } catch (error) { clearTimeout(timer); reject(error); }
        });
    }

    async function sendPatchToBackground() {
        patchTimer = null;
        if (stopped || deliveryBlocked || (!inFlight && pendingChanges.size === 0)) return;
        if (!isExtensionContextValid()) { stopMonitoring("Extension context invalidated"); return; }
        if (epoch === null) {
            try { await registerSource(); }
            catch { if (!stopped) patchTimer = setTimeout(sendPatchToBackground, RETRY_PATCH_MS); return; }
        }
        if (stopped) return;
        if (!inFlight) {
            const groups = Array.from(pendingChanges.values()).slice(0, MAX_GROUPS_PER_PATCH).map(function (group) {
                return { rawTicId: group.rawTicId, revision: group.revision, chunks: group.chunks };
            });
            if (!groups.length) return;
            inFlight = { protocol: 2, sourceInstanceId: sourceInstanceId,
                patchId: crypto.randomUUID(), epoch: epoch, groups: groups };
        }
        const sent = inFlight;
        const attempt = ++sendAttempt;
        const retry = function () {
            if (stopped || attempt !== sendAttempt || inFlight !== sent) return;
            if (ackTimer) clearTimeout(ackTimer);
            ackTimer = null;
            sendAttempt++; // late callbacks from this attempt cannot acknowledge a later send
            if (!patchTimer) patchTimer = setTimeout(sendPatchToBackground, RETRY_PATCH_MS);
        };
        ackTimer = setTimeout(retry, PATCH_TIMEOUT_MS);
        try {
            chrome.runtime.sendMessage({ type: "CHAT_PATCH", data: sent }, function (response) {
                const error = chrome.runtime.lastError;
                if (stopped || attempt !== sendAttempt || inFlight !== sent) return;
                if (error) {
                    if (String(error.message).includes("Extension context invalidated")) {
                        stopMonitoring("Extension context invalidated"); return;
                    }
                    retry(); return;
                }
                if (response?.status === "STALE_EPOCH") { setEpoch(response.epoch); return; }
                if (response?.status === "Error") {
                    if (/limit|too large|Invalid|refresh/i.test(response.error || "")) {
                        failCapture(response.error); return;
                    }
                    retry(); return;
                }
                if (response?.status !== "Patch applied" || response.patchId !== sent.patchId) { retry(); return; }
                clearTimeout(ackTimer); ackTimer = null;
                for (const group of sent.groups) {
                    const current = pendingChanges.get(group.rawTicId);
                    // Do not delete revision N+1 when the acknowledgment is for N.
                    if (current && current.revision === group.revision) {
                        pendingChars -= current.chars;
                        pendingChanges.delete(group.rawTicId);
                    }
                }
                inFlight = null;
                resumeCaptureAfterDelivery();
                if (pendingChanges.size) schedulePatchSend();
            });
        } catch { retry(); }
    }

    function stopMonitoring(reason) {
        stopped = true;
        if (window.__techIntChatOldBaseMonitor) {
            window.__techIntChatOldBaseMonitor.stopped = true;
        }
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
        if (scanTimer) {
            clearTimeout(scanTimer);
            scanTimer = null;
        }
        if (patchTimer) {
            clearTimeout(patchTimer);
            patchTimer = null;
        }
        if (captionObserver) {
            captionObserver.disconnect();
            captionObserver = null;
        }
        if (discoveryObserver) discoveryObserver.disconnect();
        discoveryObserver = null;
        if (ackTimer) clearTimeout(ackTimer);
        ackTimer = null;
        inFlight = null;
        rawChats.clear(); splitCache.clear(); pendingChanges.clear();
        rawOrder.length = 0; speakers.clear(); pendingChars = 0;
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
        console.debug("Meeting monitor stopped:", reason || "unknown");
    }

    function onRuntimeMessage(request, sender, sendResponse) {
        if (!request || !request.type) {
            return false;
        }
        if (request.type === "TRANSCRIPT_EPOCH") {
            setEpoch(request.epoch);
            sendResponse({ status: "ready" });
            return false;
        }
        if (request.type === "PING_MEETING") {
            sendResponse({ status: "ready", protocol: 2, sourceInstanceId: sourceInstanceId });
            return false;
        }
        if (request.type === "FORCE_MEETING_SCAN") {
            monitorChats();
            sendResponse({ status: "scan requested" });
            return false;
        }
        return false;
    }
    chrome.runtime.onMessage.addListener(onRuntimeMessage);

    function start() {
        if (stopped || started) return;
        started = true;
        // Discovery watches structure, not page text. Full-page selector scoring only
        // happens when the caption container changes or on the slow health check.
        discoveryObserver = new MutationObserver(function (mutations) {
            if (!activeContainer || !activeContainer.isConnected) {
                queueScan(OBSERVER_SCAN_DELAY_MS); return;
            }
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && !activeContainer.contains(node) &&
                        (node.matches(SELECTORS.containers[0]) || node.querySelector(SELECTORS.containers[0]))) {
                        ensureCaptionObserver(true);
                        queueScan(OBSERVER_SCAN_DELAY_MS);
                        return;
                    }
                }
            }
        });
        discoveryObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
        monitorChats();
        intervalId = setInterval(function () {
            if (!isExtensionContextValid()) { stopMonitoring("Extension context invalidated"); return; }
            ensureCaptionObserver(true);
            monitorChats();
        }, HEALTH_INTERVAL_MS);
        registerSource().then(function () { schedulePatchSend(); }).catch(function () { schedulePatchSend(RETRY_PATCH_MS); });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
        start();
    }

    window.addEventListener("pagehide", function (event) {
        if (!event.persisted) stopMonitoring("page unloading");
    });
    window.addEventListener("pageshow", function (event) {
        if (event.persisted && !stopped) { ensureCaptionObserver(true); monitorChats(); }
    });
})();
