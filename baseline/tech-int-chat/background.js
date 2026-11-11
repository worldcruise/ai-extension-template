// MV3 entry point: listeners register synchronously; all durable state lives in services.
import { CONFIG } from "./core/Config.js";
import { logger } from "./core/Logger.js";
import { SessionManager } from "./core/SessionManager.js";
import { RequestManager } from "./core/RequestManager.js";
import { StorageService } from "./services/StorageService.js";
import { TranscriptService } from "./services/TranscriptService.js";
import { ChatGPTService } from "./services/ChatGPTService.js";
import { ClipboardService, CLIPBOARD_TARGET } from "./services/ClipboardService.js";
import { migrateLegacy } from "./storage/migration.js";

const storage = new StorageService();
const transcripts = new TranscriptService(storage);
const requests = new RequestManager(storage, job => transcripts.broadcast({ type: "JOB_UPDATE", job }));
const chatGPT = new ChatGPTService(storage, requests);
const clipboard = new ClipboardService();
let aiMode = "conversation";
let initialization;
function ready() {
    if (!initialization) {
        initialization = (async () => {
            await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
            const state = await chrome.storage.session.get([CONFIG.sessionKey, "techIntChat.aiMode"]);
            let token = state[CONFIG.sessionKey];
            if (!token) {
                token = crypto.randomUUID();
                await chrome.storage.session.set({ [CONFIG.sessionKey]: token });
            }
            aiMode = state["techIntChat.aiMode"] === "coding" ? "coding" : "conversation";
            await storage.open(token);
            await migrateLegacy(storage);
            await requests.recover();
        })().catch(error => { initialization = null; throw error; });
    }
    return initialization;
}
const isOwnSender = sender => sender?.id === chrome.runtime.id;
function isPanel(sender) {
    return isOwnSender(sender) && typeof sender.url === "string" &&
        sender.url.startsWith(chrome.runtime.getURL("index.html"));
}
function requirePanel(sender) {
    if (!isPanel(sender)) throw new Error("This operation requires the extension panel");
}
async function handle(message, sender) {
    if (!isOwnSender(sender) || !message || typeof message.type !== "string") throw new Error("Invalid message sender");
    switch (message.type) {
        case "REGISTER_MEETING":
            SessionManager.source(sender, message);
            return { status: "ready", protocol: CONFIG.protocol,
                epoch: (await storage.meta()).epoch };
        case "CHAT_PATCH": return transcripts.patch(message.data, sender);
        case "CLEAR_TRANSCRIPT": {
            requirePanel(sender);
            if (!Number.isInteger(message.epoch)) throw new Error("Reload the panel before clearing");
            const meta = await transcripts.clear(message.epoch);
            const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
            await Promise.all(tabs.map(tab => chrome.tabs.sendMessage(tab.id,
                { type: "TRANSCRIPT_EPOCH", epoch: meta.epoch }).catch(() => {})));
            return { status: "Transcript cleared", epoch: meta.epoch, version: meta.version, cleared: meta.cleared };
        }
        case "RESET_TRANSCRIPT": return { status: "Ignored automatic reset" };
        case "SEND_CHAT_GPT":
        case "FOLLOW_UP_CHAT_GPT":
            requirePanel(sender);
            return chatGPT.submit({ ...message, aiMode: message.aiMode || aiMode });
        case "GET_CHATGPT_JOB":
            requirePanel(sender);
            return { job: await storage.getJob(message.jobId) };
        case "GET_TRANSCRIPT_META":
            requirePanel(sender); return storage.meta();
        case "GET_TRANSCRIPT_PAGE":
            requirePanel(sender);
            if (!Number.isSafeInteger(message.afterSeq) || message.afterSeq < -1) throw new Error("Invalid page cursor");
            return transcripts.queue.run(async () => ({ ...(await storage.meta()),
                chats: await storage.page(message.afterSeq) }));
        case "set-ai-mode":
        case "SET_AI_MODE":
            requirePanel(sender);
            aiMode = message.mode === "coding" ? "coding" : "conversation";
            await chrome.storage.session.set({ "techIntChat.aiMode": aiMode });
            return { status: "AI mode updated", mode: aiMode };
        default: throw new Error("Unknown message type");
    }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Offscreen messages have their own recipient. Do not race its copy response
    // with this worker's default "Unknown message type" response.
    if (message?.target === CLIPBOARD_TARGET) return false;
    if (message?.type === "COPY_CHATGPT_PAYLOAD") {
        // Copying must not wait for transcript database initialization/recovery.
        clipboard.copy(message, sender).then(sendResponse, () => {
            sendResponse({ ok: false, code: "clipboard_unavailable" });
        });
        return true;
    }
    ready().then(() => handle(message, sender)).then(sendResponse, error => {
        try { sendResponse({ status: "Error", error: error.message || "Operation failed" }); } catch { /* caller closed */ }
    });
    return true;
});
chrome.runtime.onConnect.addListener(port => {
    if (port.name !== "tech-int-popup" || !isPanel(port.sender)) { port.disconnect(); return; }
    let closed = false;
    port.onDisconnect.addListener(() => { closed = true; transcripts.remove(port); });
    port.onMessage.addListener(message => {
        if (message?.type !== "SUBSCRIBE_TRANSCRIPT") return;
        ready().then(() => {
            if (!closed) return transcripts.subscribe(port, message);
        }).catch(error => transcripts.post(port, { type: "ERROR", error: error.message }));
    });
});
async function configure() {
    await ready();
    try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); }
    catch { logger.warn("side_panel_setup_failed"); }
    const tabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
    await Promise.all(tabs.map(async tab => {
        try {
            const pong = await chrome.tabs.sendMessage(tab.id, { type: "PING_MEETING" });
            if (pong?.protocol === CONFIG.protocol) return;
            // Old listeners cannot safely be replaced in the same document. Refresh that tab.
            logger.warn("refresh_existing_meet_tab_after_upgrade");
        } catch {
            try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["meeting.js"] }); }
            catch { logger.warn("meet_tab_injection_failed"); }
        }
    }));
}
chrome.runtime.onInstalled.addListener(() => { configure().catch(() => logger.warn("installation_setup_failed")); });
chrome.runtime.onStartup.addListener(() => { configure().catch(() => logger.warn("startup_setup_failed")); });
chrome.tabs.onRemoved.addListener(tabId => requests.cancelTab(tabId));
