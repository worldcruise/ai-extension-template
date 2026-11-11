// Popup / Side Panel controller
// Stable old-baseline workflow: one shared transcript panel, no source labels, user-only clear.
document.addEventListener("DOMContentLoaded", function () {
    "use strict";


    const MESSAGE_TIMEOUT_MS = 10000;

    let chats = [];
    let speakers = [];
    let speakerColors = Object.create(null);
    let chatElements = new Map();
    const chatIndex = new Map();
    let epoch = null;
    let lastVersion = -1;
    let loadingSnapshot = false;
    let reconnectTimer = null;
    let handshakeTimer = null;
    let reconnectDelay = 1000;
    let disposed = false;
    let sending = false;
    const selectedHighlights = new Set();
    let startSelection = null;
    let endSelection = null;
    let lastSendKey = null;
    let port = null;

    const chatHeaderElement = document.getElementById("chatHeader");
    const chatListElement = document.getElementById("chatList");
    const conversationAccountElement = document.getElementById("conversationAccount");
    const normalAccountElement = document.getElementById("normalAccount");
    const downloadButton = document.getElementById("download");
    const trainButton = document.getElementById("train");
    const clearButton = document.getElementById("clearTranscript");
    const statusText = document.getElementById("statusText");

    try {
        initializeDefaults();
        initializeLayout();
        bindActions();
        connectBackgroundPort();
        setStatus("Ready");
    } catch (error) {
        console.warn("Popup initialization warning:", error);
        setStatus("Popup error: " + (error.message || error));
    }

    function initializeDefaults() {
        if (conversationAccountElement) {
            conversationAccountElement.checked = true;
        }
        if (normalAccountElement) {
            normalAccountElement.checked = true;
        }
    }

    function initializeLayout() {
        if (chatHeaderElement) {
            chatHeaderElement.style.display = "flex";
        }
        if (chatListElement) {
            chatListElement.style.display = "flex";
        }
    }

    function setStatus(message) {
        if (statusText) {
            statusText.textContent = message;
        }
    }

    function isExtensionContextValid() {
        return Boolean(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage);
    }

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function sendRuntimeMessage(message, options) {
        const timeoutMs = options && options.timeoutMs ? options.timeoutMs : MESSAGE_TIMEOUT_MS;
        const retries = options && Number.isInteger(options.retries) ? options.retries : 0;

        return new Promise(function (resolve, reject) {
            if (!isExtensionContextValid()) {
                reject(new Error("Extension context is unavailable"));
                return;
            }

            let settled = false;
            const timeoutId = setTimeout(function () {
                if (!settled) {
                    settled = true;
                    reject(new Error("Timed out waiting for " + message.type));
                }
            }, timeoutMs);

            try {
                chrome.runtime.sendMessage(message, function (response) {
                    const runtimeError = chrome.runtime.lastError;
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeoutId);

                    if (runtimeError) {
                        reject(new Error(runtimeError.message || "Chrome runtime error"));
                        return;
                    }
                    if (response && response.status === "Error") {
                        reject(new Error(response.error || "Background returned error"));
                        return;
                    }
                    resolve(response || {});
                });
            } catch (error) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(error);
                }
            }
        }).catch(function (error) {
            if (retries > 0) {
                return delay(300).then(function () {
                    return sendRuntimeMessage(message, { timeoutMs: timeoutMs, retries: retries - 1 });
                });
            }
            throw error;
        });
    }

    function queueReconnect() {
        if (disposed || reconnectTimer || !isExtensionContextValid()) return;
        reconnectTimer = setTimeout(function () {
            reconnectTimer = null;
            connectBackgroundPort();
        }, reconnectDelay);
        reconnectDelay = Math.min(10000, reconnectDelay * 2);
    }

    function connectBackgroundPort() {
        if (disposed || port || !isExtensionContextValid()) return;
        try {
            const connected = chrome.runtime.connect({ name: "tech-int-popup" });
            port = connected;
            connected.onMessage.addListener(function (message) {
                if (connected !== port) return;
                clearTimeout(handshakeTimer);
                handshakeTimer = null;
                reconnectDelay = 1000;
                handleBackgroundPortMessage(message || {});
            });
            connected.onDisconnect.addListener(function () {
                const error = chrome.runtime.lastError;
                if (connected !== port) return;
                port = null;
                clearTimeout(handshakeTimer);
                handshakeTimer = null;
                if (loadingSnapshot) lastVersion = -1;
                setStatus("Reconnecting transcript...");
                queueReconnect();
            });
            connected.postMessage({ type: "SUBSCRIBE_TRANSCRIPT", epoch: epoch,
                version: loadingSnapshot ? -1 : lastVersion });
            handshakeTimer = setTimeout(function () {
                if (connected === port) {
                    port = null;
                    connected.disconnect();
                    queueReconnect();
                }
            }, 15000);
        } catch (error) {
            port = null;
            queueReconnect();
        }
    }

    function handleBackgroundPortMessage(message) {
        try {
            if (message.type === "SNAPSHOT_START") {
                loadingSnapshot = true;
                lastVersion = -1;
                epoch = message.epoch;
                chats = [];
                chatIndex.clear();
                speakers = [];
                speakerColors = Object.create(null);
                clearChatDom();
                return;
            }
            if (message.type === "SNAPSHOT_PAGE") {
                applyPatchUpdate(message.chats || [], message.speakers || [], []);
                return;
            }
            if (message.type === "SNAPSHOT_END" || message.type === "SYNC_READY") {
                loadingSnapshot = false;
                epoch = message.epoch;
                lastVersion = message.version;
                updateSelectionDisplay();
                setStatus("Transcript rows: " + chats.length);
                return;
            }
            if (message.type === "CHAT_PATCH_UPDATE") {
                if (message.epoch !== epoch) {
                    port?.postMessage({ type: "SUBSCRIBE_TRANSCRIPT", version: -1 });
                    return;
                }
                if (message.version <= lastVersion) return;
                applyPatchUpdate(message.changes || [], message.speakers || [], message.removals || []);
                lastVersion = message.version;
                setStatus("Transcript rows: " + chats.length);
                return;
            }
            if (message.type === "TRANSCRIPT_CLEARED") {
                epoch = message.epoch; lastVersion = message.version;
                loadingSnapshot = false;
                chats = []; speakers = [];
                chatIndex.clear();
                speakerColors = Object.create(null);
                startSelection = null; endSelection = null; lastSendKey = null;
                clearChatDom();
                setStatus("Transcript cleared");
            }
            if (message.type === "ERROR") {
                setStatus("Transcript storage error: " + message.error);
                console.warn("Tech Interview Chat:", message.error);
            }
        } catch (error) {
            setStatus("Popup update error: " + error.message);
            lastVersion = -1;
            if (port) port.postMessage({ type: "SUBSCRIBE_TRANSCRIPT", version: -1 });
        }
    }

    function rebuildChatIndex() {
        chatIndex.clear();
        chats.forEach(function (chat, index) { chatIndex.set(chat.ticId, index); });
    }

    function applyPatchUpdate(changes, nextSpeakers, removals) {
        const shouldStickToBottom = isNearBottom();
        if (Array.isArray(nextSpeakers)) {
            speakers = nextSpeakers;
            updateSpeakerColors(speakers);
        }
        if (removals.length) {
            const removed = new Set(removals);
            chats = chats.filter(function (chat) { return !removed.has(chat.ticId); });
            removals.forEach(function (id) {
                chatElements.get(id)?.remove();
                chatElements.delete(id);
            });
            rebuildChatIndex();
        }
        const fragment = document.createDocumentFragment();
        for (const change of changes) {
            if (!change || !change.ticId) continue;
            const index = chatIndex.get(change.ticId);
            if (index !== undefined && (chats[index].revision || 0) > (change.revision || 0)) continue;
            if (index === undefined) {
                chatIndex.set(change.ticId, chats.length);
                chats.push(change);
            } else chats[index] = change;
            let element = chatElements.get(change.ticId);
            if (!element) {
                element = createChatElement(change);
                chatElements.set(change.ticId, element);
                fragment.appendChild(element);
            } else updateChatElement(element, change);
        }
        if (chatListElement) {
            chatListElement.appendChild(fragment);
            if (shouldStickToBottom) chatListElement.scrollTop = chatListElement.scrollHeight;
        }
        if (!loadingSnapshot) updateSelectionDisplay();
    }

    function updateSpeakerColors(speakerList) {
        speakerList.forEach(function (speaker, index) {
            if (speaker && speakerColors[speaker] === undefined) {
                speakerColors[speaker] = index % 10;
            }
        });
    }

    function clearChatDom() {
        if (chatListElement) {
            chatListElement.textContent = "";
        }
        chatElements.clear();
        selectedHighlights.clear();
    }

    function createChatElement(chat) {
        const chatElement = document.createElement("div");
        chatElement.classList.add("chatMessage");
        chatElement.setAttribute("ticId", chat.ticId);
        chatElement.dataset.ticId = chat.ticId;

        const speakerNameElement = document.createElement("div");
        speakerNameElement.classList.add("speakerName");
        chatElement.appendChild(speakerNameElement);

        const chatBubbleElement = document.createElement("div");
        chatBubbleElement.classList.add("chatBubble");
        chatElement.appendChild(chatBubbleElement);

        updateChatElement(chatElement, chat);
        return chatElement;
    }

    function updateChatElement(chatElement, chat) {
        chatElement.dataset.ticId = chat.ticId;
        chatElement.setAttribute("ticId", chat.ticId);
        chatElement.classList.toggle("currentUser", Boolean(chat.isCurrentUser));
        chatElement.classList.toggle("otherUser", !chat.isCurrentUser);

        for (let i = 0; i < 10; i++) {
            chatElement.classList.remove("speaker-" + i);
        }

        if (!chat.isCurrentUser) {
            const color = speakerColors[chat.role];
            if (color !== undefined) {
                chatElement.classList.add("speaker-" + color);
            }
        }

        const speakerNameElement = chatElement.querySelector(".speakerName");
        if (speakerNameElement && speakerNameElement.textContent !== (chat.role || "Unknown")) {
            speakerNameElement.textContent = chat.role || "Unknown";
        }

        const chatBubbleElement = chatElement.querySelector(".chatBubble");
        if (chatBubbleElement && chatBubbleElement.textContent !== (chat.content || "")) {
            chatBubbleElement.textContent = chat.content || "";
        }
    }

    function isNearBottom() {
        if (!chatListElement) {
            return false;
        }
        return chatListElement.scrollHeight - chatListElement.scrollTop <= chatListElement.clientHeight + 45;
    }

    function updateSelectionDisplay() {
        selectedHighlights.forEach(function (id) {
            const element = chatElements.get(id);
            element?.classList.remove("selectedChatStart", "selectedChatEnd");
        });
        selectedHighlights.clear();

        const start = resolveSelection(startSelection);
        const end = resolveSelection(endSelection);

        if (start && chatElements.has(start.ticId)) {
            chatElements.get(start.ticId).classList.add("selectedChatStart");
            startSelection = start;
            selectedHighlights.add(start.ticId);
        } else startSelection = null;
        if (end && chatElements.has(end.ticId)) {
            chatElements.get(end.ticId).classList.add("selectedChatEnd");
            endSelection = end;
            selectedHighlights.add(end.ticId);
        } else endSelection = null;
    }

    function resolveSelection(selection) {
        if (!selection) {
            return null;
        }

        const exactIndex = getChatIndexByTicId(selection.ticId);
        if (exactIndex >= 0) {
            return { ticId: selection.ticId, fallbackIndex: exactIndex };
        }

        return null;
    }

    function getChatIndexByTicId(ticId) {
        return chatIndex.has(ticId) ? chatIndex.get(ticId) : -1;
    }

    function getClickedChatElement(event) {
        if (!event || !event.target) {
            return null;
        }
        return event.target.closest(".chatMessage");
    }

    function selectStartFromElement(element) {
        const ticId = element && element.dataset ? element.dataset.ticId : null;
        const index = getChatIndexByTicId(ticId);
        if (index < 0) {
            setStatus("Could not select lower bound; transcript row changed. Try one row above live caption.");
            return;
        }
        startSelection = { ticId: ticId, fallbackIndex: index };
        endSelection = null;
        lastSendKey = null;
        updateSelectionDisplay();
        setStatus("Lower bound selected");
    }

    function selectEndFromElement(element, event) {
        if (!startSelection) {
            setStatus("Select lower bound first with left-click");
            return;
        }

        const ticId = element && element.dataset ? element.dataset.ticId : null;
        const index = getChatIndexByTicId(ticId);
        if (index < 0) {
            setStatus("Could not select upper bound; transcript row changed. Try again.");
            return;
        }

        endSelection = { ticId: ticId, fallbackIndex: index };
        updateSelectionDisplay();
        processSelectedChats(event);
    }

    function getCheckedValue(name, fallbackValue) {
        const checked = document.querySelector(`input[name="${name}"]:checked`);
        return checked ? checked.value : fallbackValue;
    }

    function getPromptTypeForEvent(event) {
        // Swapped shortcut behavior from prior stable build:
        // Shift + right-click = STAR, Ctrl/Cmd + right-click = Detail.
        if (event && event.shiftKey) {
            return "3";
        }
        if (event && (event.ctrlKey || event.metaKey)) {
            return "2";
        }
        return getCheckedValue("accountType", "1");
    }

    async function processSelectedChats(event) {
        if (sending || loadingSnapshot) return;
        try {
            const start = resolveSelection(startSelection);
            const end = resolveSelection(endSelection);
            if (!start || !end) {
                setStatus("Selection changed before send. Please select again.");
                return;
            }

            const startIndex = getChatIndexByTicId(start.ticId);
            const endIndex = getChatIndexByTicId(end.ticId);
            if (startIndex < 0 || endIndex < 0) {
                setStatus("Selected transcript is no longer available");
                return;
            }

            const lowerIndex = Math.min(startIndex, endIndex);
            const upperIndex = Math.max(startIndex, endIndex);
            const promptType = getPromptTypeForEvent(event);
            const aiMode = getCheckedValue("aiMode", "conversation");
            const selectedRows = chats.slice(lowerIndex, upperIndex + 1);
            const sendKey = JSON.stringify([selectedRows.map(row => [row.ticId, row.revision]), promptType, aiMode]);

            if (sendKey === lastSendKey) {
                return;
            }
            lastSendKey = sendKey;

            setStatus("Sending selected transcript...");
            const response = await sendChatGPT({
                type: "SEND_CHAT_GPT",
                state: promptType,
                aiMode: aiMode,
                data: {
                    content: selectedRows.map(function (row) { return row.content; }).join(" ")
                }
            });

            setStatus(response.status || "Sent to ChatGPT");
        } catch (error) {
            lastSendKey = null;
            console.warn("Send selected transcript warning:", error);
            setStatus("Send failed: " + (error.message || error));
            console.warn("Tech Interview Chat:", error.message);
        }
    }

    async function sendChatGPT(message) {
        if (sending) throw new Error("A submission is already in progress");
        sending = true;
        message.requestId = crypto.randomUUID();
        let copied;
        try {
            const content = typeof message.data === "string" ? message.data : (message.data?.content || "");
            const finalText = TechIntPromptBuilder.build(message.state, content, message.aiMode);
            // This call starts in the original click/key handler, before any runtime message.
            // Freeze ONE final string: later captions or mode changes cannot change what is sent.
            copied = await TechIntClipboard.copy(finalText, message.requestId, "panel");
            if (disposed) throw new Error("Panel closed before submission");
            message = { type: message.type, state: message.state, aiMode: message.aiMode,
                requestId: message.requestId, payloadVersion: 1, finalText, clipboard: copied };
            // A transport retry reuses the SAME ID; background returns the existing job.
            const accepted = await sendRuntimeMessage(message, { timeoutMs: MESSAGE_TIMEOUT_MS, retries: 1 });
            if (!accepted.jobId) throw new Error(accepted.error || "No submission job was acknowledged");
            let job = accepted.job;
            const deadline = Date.now() + 45000;
            let pause = 250;
            while (!disposed) {
                if (job?.status === "succeeded") {
                    const clipboard = copied;
                    if (clipboard?.ok === true) return {
                        status: "Copied to clipboard and sent to ChatGPT", clipboard: clipboard
                    };
                    const code = /^[a-z_]{1,48}$/.test(clipboard?.code || "") ? clipboard.code : "not_reported";
                    const diagnostic = clipboard?.nativeCode ? code + "; native=" + clipboard.nativeCode : code;
                    console.warn("Tech Interview Chat: sent to ChatGPT, but clipboard copy failed (" + diagnostic + ").");
                    return { status: "Sent to ChatGPT; clipboard copy failed (" + code + ")",
                        clipboard: { ok: false, code: code } };
                }
                if (["failed", "cancelled", "uncertain"].includes(job?.status)) {
                    // Background already allowlists diagnostics. Never log the outgoing text.
                    if (job.diagnostics) console.info("[tech-int-chat 2.1.5] " + JSON.stringify(job.diagnostics));
                    const code = /^[a-z_]{1,48}$/.test(job.code || "") ? " [" + job.code + "]" : "";
                    throw new Error((job.error || "Submission failed") + code);
                }
                if (Date.now() >= deadline) throw new Error("Submission status is unknown. Check ChatGPT before resending.");
                await delay(pause);
                pause = Math.min(1000, pause * 1.4);
                const response = await sendRuntimeMessage({ type: "GET_CHATGPT_JOB", jobId: accepted.jobId },
                    { timeoutMs: MESSAGE_TIMEOUT_MS, retries: 1 });
                job = response.job;
                if (!job) throw new Error("Submission history is unavailable. Check ChatGPT before resending.");
            }
            throw new Error("Panel closed");
        } catch (error) {
            // A missing/stale ChatGPT tab no longer prevents the already completed copy.
            const note = copied?.ok === true ? " The outgoing text was copied to the clipboard." :
                (copied ? " Clipboard copy also failed (" + copied.code + ")." : "");
            throw new Error((error.message || "Submission failed") + note);
        } finally { sending = false; }
    }

    function buildTranscriptFromChats(sourceChats) {
        let output = "";
        let lastRole = null;

        sourceChats.forEach(function (chat) {
            if (!chat || !chat.content) {
                return;
            }
            const role = chat.isCurrentUser ? "INTERVIEWEE" : "INTERVIEWER";
            const text = String(chat.content).trim();
            if (!text) {
                return;
            }

            if (role !== lastRole) {
                if (lastRole !== null) {
                    output += "\n";
                }
                output += role + ":\n";
            }
            output += text + "\n";
            lastRole = role;
        });

        return output.trim();
    }

    function downloadTranscript() {
        const output = buildTranscriptFromChats(chats);
        const blob = new Blob([output], { type: "text/plain" });
        const link = document.createElement("a");
        const date = new Date();
        const timestamp = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
            String(date.getHours()).padStart(2, "0"),
            String(date.getMinutes()).padStart(2, "0"),
            String(date.getSeconds()).padStart(2, "0")
        ].join("_");

        link.download = `log_${timestamp}.txt`;
        link.href = URL.createObjectURL(blob);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        const objectUrl = link.href;
        setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
    }

    async function clearTranscript() {
        const confirmed = window.confirm("Clear all transcript in the extension panel? This cannot be undone.");
        if (!confirmed) {
            return;
        }

        try {
            if (loadingSnapshot || !Number.isInteger(epoch)) throw new Error("Wait for the transcript to load before clearing");
            const result = await sendRuntimeMessage({ type: "CLEAR_TRANSCRIPT", epoch: epoch }, { timeoutMs: MESSAGE_TIMEOUT_MS, retries: 0 });
            // The live stream may already contain newer post-clear captions.
            if (!result.cleared || result.version < lastVersion) return;
            epoch = result.epoch; lastVersion = result.version;
            chats = [];
            chatIndex.clear();
            speakers = [];
            speakerColors = Object.create(null);
            startSelection = null;
            endSelection = null;
            lastSendKey = null;
            clearChatDom();
            setStatus("Transcript cleared");
        } catch (error) {
            console.warn("Clear transcript warning:", error);
            setStatus("Clear failed: " + (error.message || error));
            console.warn("Tech Interview Chat:", error.message);
        }
    }

    async function sendTrainPrompt() {
        if (sending || loadingSnapshot) return;
        try {
            let output = buildTranscriptFromChats(chats);
            output += "\n\nAbove content is the full transcript of interview. Is this passed or failed to interviewer? Analyze it and give me the most essential mistakes in this interview. If it is passed, give me advice for next step. At the end, make a good short email to send to interviewer.";
            setStatus("Sending full transcript analysis...");
            const response = await sendChatGPT({
                type: "SEND_CHAT_GPT",
                state: 5,
                aiMode: getCheckedValue("aiMode", "conversation"),
                data: output
            });
            setStatus(response.status || "Full transcript sent");
        } catch (error) {
            console.warn("Train prompt warning:", error);
            setStatus("Analysis send failed: " + (error.message || error));
            console.warn("Tech Interview Chat:", error.message);
        }
    }

    async function sendFollowUp(state) {
        if (sending) return;
        try {
            setStatus("Sending follow-up prompt...");
            const response = await sendChatGPT({
                type: "SEND_CHAT_GPT",
                state: state,
                aiMode: getCheckedValue("aiMode", "conversation"),
                data: { content: "" }
            });
            setStatus(response.status || "Follow-up sent");
        } catch (error) {
            console.warn("Follow-up prompt warning:", error);
            setStatus("Follow-up failed: " + (error.message || error));
            console.warn("Tech Interview Chat:", error.message);
        }
    }

    function bindActions() {
        if (downloadButton) {
            downloadButton.addEventListener("click", downloadTranscript);
        }
        if (clearButton) {
            clearButton.addEventListener("click", clearTranscript);
        }
        if (trainButton) {
            trainButton.addEventListener("click", sendTrainPrompt);
        }

        if (chatListElement) {
            chatListElement.addEventListener("click", function (event) {
                const element = getClickedChatElement(event);
                if (element) {
                    selectStartFromElement(element);
                }
            });

            chatListElement.addEventListener("contextmenu", function (event) {
                const element = getClickedChatElement(event);
                if (element) {
                    event.preventDefault();
                    selectEndFromElement(element, event);
                }
            });
        }

        const aiModeInputs = document.querySelectorAll('input[name="aiMode"]');
        aiModeInputs.forEach(function (input) {
            input.addEventListener("change", function () {
                sendRuntimeMessage({ type: "set-ai-mode", mode: this.value }, { timeoutMs: 2000, retries: 0 }).catch(function (error) {
                    console.warn("AI mode update warning:", error && error.message ? error.message : error);
                });
            });
        });

        window.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                startSelection = null;
                endSelection = null;
                lastSendKey = null;
                updateSelectionDisplay();
                setStatus("Selection cleared");
                return;
            }

            if (event.key === "F8" || event.key === "F9" || event.key === "F10") {
                event.preventDefault();
                if (event.repeat) return;
                const stateMap = { F8: "followup-detail", F9: "followup-technical", F10: "followup-star" };
                sendFollowUp(stateMap[event.key]);
            }
        }, true);

        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) {
                connectBackgroundPort();
            }
        });

        window.addEventListener("pagehide", function () {
            disposed = true;
            clearTimeout(reconnectTimer); clearTimeout(handshakeTimer);
            if (port) { const closing = port; port = null; closing.disconnect(); }
        });
    }
});

window.addEventListener("error", function (event) {
    console.warn("Popup global error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", function (event) {
    console.warn("Popup unhandled rejection:", event.reason);
});
