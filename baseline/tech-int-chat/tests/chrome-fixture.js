// TEST ONLY: browser fixture for the Chrome messaging boundary. Never loaded by manifest.
(() => {
    const listeners = { message: [], connect: [], installed: [], startup: [], removed: [], updated: [] };
    const event = list => ({ addListener: fn => list.push(fn), removeListener: fn => {
        const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
    }});
    const base = location.origin + "/";
    const id = "fixture-extension-id";
    const session = JSON.parse(localStorage.getItem("tic-fixture-session") || "{}");
    window.fixture = { stage: "background", logs: [], dialogs: [], delayPatchAck: 0,
        tabMessages: [], submitted: 0, clipboardWrites: [], listeners };
    function invoke(handler, message, sender) {
        return new Promise((resolve, reject) => {
            try {
                const returned = handler(structuredClone(message), sender, value => resolve(structuredClone(value)));
                if (returned === false) resolve(undefined);
            } catch (error) { reject(error); }
        });
    }
    function sender(message) {
        if (message.type === "COPY_CHATGPT_PAYLOAD") return { id, url: "https://chatgpt.com/", frameId: 0, tab: { id: 41 } };
        return ["REGISTER_MEETING", "CHAT_PATCH"].includes(message.type)
            ? { id, url: "https://meet.google.com/abc-defg-hij", frameId: 0, tab: { id: 11 } }
            : { id, url: base + "index.html" };
    }
    window.chrome = {
        runtime: { id, getURL: path => base + path,
            async getContexts() { return []; },
            onMessage: { addListener: fn => listeners.message.push({ fn, stage: fixture.stage }),
                removeListener: fn => { const i = listeners.message.findIndex(item => item.fn === fn); if (i >= 0) listeners.message.splice(i, 1); } },
            onConnect: event(listeners.connect), onInstalled: event(listeners.installed), onStartup: event(listeners.startup),
            sendMessage(message, callback) {
                // Test-only OS clipboard stand-in; runtime routing still uses the real service.
                if (message.target === "tech-int-chat-clipboard") {
                    fixture.clipboardWrites.push(message.text);
                    const result = { ok: true, requestId: message.requestId };
                    if (callback) { queueMicrotask(() => callback(result)); return; }
                    return Promise.resolve(result);
                }
                fixture.logs.push(structuredClone(message));
                const promise = window.backgroundReady.then(async () => {
                    const handler = listeners.message.find(item => item.stage === "background");
                    const result = await invoke(handler.fn, message, sender(message));
                    if (message.type === "CHAT_PATCH" && fixture.delayPatchAck) {
                        await new Promise(r => setTimeout(r, fixture.delayPatchAck));
                    }
                    return result;
                });
                if (callback) { promise.then(callback, error => {
                    chrome.runtime.lastError = { message: error.message };
                    callback(); delete chrome.runtime.lastError;
                }); return; }
                return promise;
            },
            connect({ name }) {
                const toClient = [], toServer = [], clientClose = [], serverClose = [];
                let closed = false;
                const client = { name, onMessage: event(toClient), onDisconnect: event(clientClose),
                    postMessage: message => backgroundReady.then(() => {
                        if (!closed) toServer.forEach(fn => fn(structuredClone(message)));
                    }), disconnect: () => {
                        if (closed) return; closed = true;
                        serverClose.forEach(fn => fn()); clientClose.forEach(fn => fn());
                    } };
                const server = { name, sender: { id, url: base + "index.html" },
                    onMessage: event(toServer), onDisconnect: event(serverClose),
                    postMessage: message => { if (closed) throw new Error("Port closed");
                        toClient.forEach(fn => fn(structuredClone(message))); }, disconnect: client.disconnect };
                backgroundReady.then(() => listeners.connect.forEach(fn => fn(server)));
                return client;
            }
        },
        storage: { session: {
            async setAccessLevel() {},
            async get(keys) { const list = typeof keys === "string" ? [keys] : keys;
                return Object.fromEntries(list.filter(k => k in session).map(k => [k, structuredClone(session[k])])); },
            async set(data) { Object.assign(session, structuredClone(data)); localStorage.setItem("tic-fixture-session", JSON.stringify(session)); },
            async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key];
                localStorage.setItem("tic-fixture-session", JSON.stringify(session)); }
        } },
        tabs: { onRemoved: event(listeners.removed), onUpdated: event(listeners.updated),
            async query(query) {
                const urls = JSON.stringify(query.url);
                return urls.includes("chatgpt") ? [{ id: 41, active: true, url: "https://chatgpt.com/" }] :
                    [{ id: 11, url: "https://meet.google.com/abc-defg-hij" }];
            },
            sendMessage(tabId, message, callback) {
                fixture.tabMessages.push(structuredClone(message));
                const stage = tabId === 11 ? "meeting" : "gpt";
                const handler = listeners.message.find(item => item.stage === stage);
                const promise = handler ? invoke(handler.fn, message, { id }) : Promise.reject(new Error("No receiving end"));
                if (callback) { promise.then(callback, error => {
                    chrome.runtime.lastError = { message: error.message };
                    callback(); delete chrome.runtime.lastError;
                }); return; }
                return promise;
            }
        },
        offscreen: { async createDocument() {}, async closeDocument() {} },
        sidePanel: { async setPanelBehavior() {} },
        scripting: { async executeScript() { throw new Error("Fixture intentionally requires scripts to be loaded explicitly"); } }
    };
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText(text) { fixture.clipboardWrites.push(text); return Promise.resolve(); }
    } });
    window.alert = text => fixture.dialogs.push(String(text));
    window.confirm = () => true;
    window.backgroundReady = import(base + "background.js");
})();
