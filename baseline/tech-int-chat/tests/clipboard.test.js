import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ClipboardService, CLIPBOARD_TARGET, CLIPBOARD_DOCUMENT } from "../services/ClipboardService.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const sender = (url = "https://chatgpt.com/c/example") => ({ id: "fixture", tab: { id: 7 }, frameId: 0, url });
const message = (text = "Prompt\n\nAlice: Hello 🧪\nBob:  two spaces\r\n", id = "clipboard_request_1") =>
    ({ type: "COPY_CHATGPT_PAYLOAD", requestId: id, text, expiresAt: Date.now() + 4500 });
function apiFixture() {
    const f = { calls: [], contexts: [] };
    f.api = {
        runtime: { id: "fixture", getURL: path => `chrome-extension://fixture/${path}`,
            async getContexts(options) { f.calls.push(["contexts", options]); return f.contexts; },
            sendMessage(m, callback) { return f.writeResponse(m, callback); } },
        offscreen: {
            async createDocument(options) { f.calls.push(["create", options]); },
            async closeDocument() { f.calls.push(["close"]); }
        }
    };
    f.writeResponse = (m, cb) => { f.calls.push(["write", m]); queueMicrotask(() => cb({ ok: true, requestId: m.requestId })); };
    return f;
}
test("offscreen fallback copies exact text with no panel bounce and cleans up", async () => {
    const f = apiFixture(), m = message();
    assert.deepEqual(await new ClipboardService(f.api).copy(m, sender()), { ok: true, method: "offscreen" });
    assert.deepEqual(f.calls.map(c => c[0]), ["contexts", "create", "write", "close"]);
    const write = f.calls.find(c => c[0] === "write")[1];
    assert.equal(write.text, m.text); assert.equal(write.target, CLIPBOARD_TARGET);
    assert.equal(f.calls[1][1].url, CLIPBOARD_DOCUMENT);
});
test("fallback authorizes panel, extension-tab panel, and top-frame ChatGPT hotkey senders", async () => {
    for (const source of [sender(), sender("https://chat.openai.com/"),
        { id: "fixture", url: "chrome-extension://fixture/index.html" },
        { id: "fixture", url: "chrome-extension://fixture/index.html?mode=panel", frameId: 0, tab: { id: 4 } }]) {
        assert.equal((await new ClipboardService(apiFixture().api).copy(message(), source)).ok, true);
    }
});
test("fallback rejects foreign, Meet, arbitrary extension and subframe senders", async () => {
    for (const source of [{ ...sender(), id: "other" }, sender("https://meet.google.com/"),
        sender("https://chatgpt.com.evil.invalid/"), { ...sender(), frameId: 1 },
        { id: "fixture", url: "chrome-extension://fixture/index.html.evil" },
        { id: "fixture", url: "chrome-extension://fixture/offscreen/clipboard.html" },
        { ...sender(), url: "bad" }, {}, null]) {
        const f = apiFixture();
        assert.equal((await new ClipboardService(f.api).copy(message(), source)).code, "invalid_sender");
        assert.equal(f.calls.length, 0);
    }
});
test("invalid text, identity and deadlines are rejected before offscreen creation", async () => {
    for (const extra of [{ text: "" }, { text: " " }, { text: 5 }, { text: "x".repeat(205001) },
        { requestId: "x" }, { requestId: {} }, { expiresAt: Infinity }, { expiresAt: Date.now() + 60000 }]) {
        const f = apiFixture();
        assert.equal((await new ClipboardService(f.api).copy({ ...message(), ...extra }, sender())).code, "invalid_request");
        assert.equal(f.calls.length, 0);
    }
    assert.equal((await new ClipboardService(apiFixture().api).copy({ ...message(), expiresAt: 0 }, sender())).code, "expired");
});
test("existing offscreen document is reused and then closed", async () => {
    const f = apiFixture(); f.contexts = [{}];
    assert.equal((await new ClipboardService(f.api).copy(message(), sender())).ok, true);
    assert.deepEqual(f.calls.map(c => c[0]), ["contexts", "write", "close"]);
});
test("offscreen writes are serialized and pending work is bounded", async () => {
    const f = apiFixture(), callbacks = [], service = new ClipboardService(f.api);
    f.writeResponse = (m, cb) => { f.calls.push(["write", m]); callbacks.push(() => cb({ ok: true, requestId: m.requestId })); };
    const tasks = Array.from({ length: 8 }, (_, i) => service.copy(message(`Text ${i}`, `queue_request_${i}`), sender()));
    assert.equal((await service.copy(message("overflow"), sender())).code, "busy");
    for (let i = 0; i < tasks.length; i++) {
        await tick(); assert.equal(callbacks.length, 1); callbacks.shift()(); await tasks[i];
    }
    assert.equal(service.pending, 0);
    assert.deepEqual(f.calls.filter(c => c[0] === "write").map(c => c[1].text), Array.from({ length: 8 }, (_, i) => `Text ${i}`));
});
test("expired queued operations never start a stale clipboard write", async () => {
    const f = apiFixture(), callbacks = []; let now = 1000;
    const service = new ClipboardService(f.api, () => now);
    f.writeResponse = (m, cb) => callbacks.push(() => cb({ ok: true, requestId: m.requestId }));
    const a = service.copy({ ...message("first"), expiresAt: 3000 }, sender());
    const b = service.copy({ ...message("expired"), expiresAt: 1500 }, sender());
    await tick(); now = 1600; callbacks.shift()(); await a;
    assert.equal((await b).code, "expired"); assert.equal(callbacks.length, 0);
});
test("expired offscreen startup is cleaned up without writing", async () => {
    const f = apiFixture(); let now = 1000;
    f.api.offscreen.createDocument = async () => { f.calls.push(["create"]); now = 2500; };
    const result = await new ClipboardService(f.api, () => now).copy({ ...message(), expiresAt: 2000 }, sender());
    assert.equal(result.code, "expired");
    assert.deepEqual(f.calls.map(c => c[0]), ["contexts", "create", "close"]);
});
test("offscreen errors and mismatched receipts cannot masquerade as copied", async () => {
    for (const kind of ["negative", "mismatch", "transport", "throw"]) {
        const f = apiFixture();
        f.writeResponse = (m, cb) => {
            if (kind === "throw") throw new Error("invalid context");
            f.api.runtime.lastError = kind === "transport" ? { message: "closed" } : undefined;
            cb({ ok: kind !== "negative", requestId: kind === "mismatch" ? "bad" : m.requestId });
            delete f.api.runtime.lastError;
        };
        assert.equal((await new ClipboardService(f.api).copy(message(), sender())).ok, false);
        assert.equal(f.calls.at(-1)[0], "close");
    }
});
test("offscreen timeout frees the queue and permission rejection does not poison next use", async () => {
    const f = apiFixture(), service = new ClipboardService(f.api, () => 1000);
    const write = f.writeResponse; f.writeResponse = () => {};
    assert.equal((await service.copy({ ...message(), expiresAt: 1005 }, sender())).code, "copy_timeout");
    assert.equal(service.pending, 0);
    f.writeResponse = write;
    const create = f.api.offscreen.createDocument;
    f.api.offscreen.createDocument = async () => { throw new Error("denied"); };
    assert.equal((await service.copy({ ...message(), expiresAt: 2000 }, sender())).code, "offscreen_unavailable");
    f.api.offscreen.createDocument = create;
    assert.equal((await service.copy({ ...message(), expiresAt: 2000 }, sender())).ok, true);
});

// Unit boundary fixture: verifies timing, fallbacks and exact text; not OS behavior.
function writerFixture({ native, legacy = true, offscreen = true, fastTimeout = false } = {}) {
    const f = { calls: [], fields: [], native: native || (() => Promise.resolve()) };
    const active = { isConnected: true, selectionStart: 2, selectionEnd: 4, selectionDirection: "forward",
        focus() { document.activeElement = this; }, setSelectionRange(...args) { f.restored = args; } };
    const document = {
        activeElement: active,
        body: { appendChild(field) { field.isConnected = true; f.fields.push(field); } },
        createElement() {
            const field = { listeners: {}, value: "", style: {}, isConnected: false,
                setAttribute() {}, focus() { document.activeElement = this; }, select() {},
                addEventListener(name, fn) { this.listeners[name] = fn; },
                removeEventListener(name) { delete this.listeners[name]; },
                remove() { this.isConnected = false; f.fields.splice(f.fields.indexOf(this), 1); } };
            return field;
        },
        execCommand(command) {
            f.calls.push(["legacy", command]);
            if (!legacy) return false;
            document.activeElement.listeners.copy({ preventDefault() {}, clipboardData: { setData(type, text) { f.legacyText = text; } } });
            return true;
        }
    };
    const context = vm.createContext({ console, Promise, document,
        navigator: { clipboard: { writeText(text) { f.calls.push(["native", text]); return f.native(text); } } },
        chrome: { runtime: { sendMessage(m, cb) { f.calls.push(["offscreen", m]); queueMicrotask(() => cb({ ok: offscreen, code: "copy_command_failed" })); } } },
        setTimeout: (fn, ms) => setTimeout(fn, fastTimeout ? Math.min(ms, 5) : ms), clearTimeout });
    vm.runInContext('window=globalThis;getSelection=()=>({rangeCount:0,removeAllRanges(){},addRange(){}});', context);
    vm.runInContext(fs.readFileSync(new URL("../shared/ClipboardWriter.js", import.meta.url), "utf8"), context);
    f.copy = (...args) => context.TechIntClipboard.copy(...args);
    f.context = context; f.document = document; f.active = active;
    return f;
}
test("local native write is invoked synchronously before the caller's next statement", async () => {
    const f = writerFixture();
    const task = f.copy("Full prompt\n🧪", "direct_request_1");
    assert.deepEqual(f.calls, [["native", "Full prompt\n🧪"]]);
    const result = await task;
    assert.equal(result.ok, true); assert.equal(result.method, "panel"); assert.equal(result.api, "writeText");
    assert.equal(f.calls.length, 1);
});
test("native rejection tries the LOCAL legacy fallback before any runtime message", async () => {
    const f = writerFixture({ native: () => Promise.reject(Object.assign(new Error("not focused"), { name: "NotAllowedError" })) });
    const text = "  Exact\r\ntext <tag> 🧪  ";
    const result = await f.copy(text, "direct_request_2");
    assert.equal(result.ok, true); assert.equal(result.api, "execCommand");
    assert.equal(f.legacyText, text);
    assert.deepEqual(f.calls.map(c => c[0]), ["native", "legacy"]);
    assert.equal(f.fields.length, 0); assert.equal(f.document.activeElement, f.active);
    assert.deepEqual(f.restored, [2, 4, "forward"]);
});
test("native synchronous exception and unavailable API use the same safe fallback", async () => {
    for (const absent of [false, true]) {
        const f = writerFixture({ native() { throw new Error("API unavailable"); } });
        if (absent) f.context.navigator.clipboard = undefined;
        assert.equal((await f.copy("Final text", "direct_request_3")).ok, true);
        assert.equal(f.calls.at(-1)[0], "legacy");
    }
});
test("offscreen is used only after both local methods fail, with the identical payload", async () => {
    const f = writerFixture({ native: () => Promise.reject(new Error("failure")), legacy: false });
    const result = await f.copy("Final text", "direct_request_4");
    assert.equal(result.ok, true); assert.equal(result.method, "offscreen");
    assert.deepEqual(f.calls.map(c => c[0]), ["native", "legacy", "offscreen"]);
    assert.equal(f.calls[2][1].text, "Final text");
    assert.ok(f.calls[2][1].expiresAt > Date.now());
});
test("both native and fallback error codes reach the caller without private exception text", async () => {
    const f = writerFixture({ native: () => Promise.reject(Object.assign(new Error("secret payload"), { name: "NotAllowedError" })), legacy: false, offscreen: false });
    const result = await f.copy("Final text", "direct_request_5");
    assert.equal(result.ok, false); assert.equal(result.code, "copy_command_failed");
    assert.equal(result.nativeCode, "clipboard_write_denied");
    assert.ok(!JSON.stringify(result).includes("secret"));
});
test("native timeout never races a fallback and blocks another local write until settled", async () => {
    let settle;
    const f = writerFixture({ native: () => new Promise(resolve => { settle = resolve; }), fastTimeout: true });
    assert.equal((await f.copy("First", "direct_request_6")).code, "copy_timeout");
    assert.equal((await f.copy("Second", "direct_request_7")).code, "previous_copy_pending");
    assert.equal(f.calls.length, 1);
    settle(); await tick(); f.native = () => Promise.resolve();
    assert.equal((await f.copy("Third", "direct_request_8")).ok, true);
    assert.equal(f.calls.length, 2);
});
test("late native rejection never launches a stale fallback after timeout", async () => {
    let reject;
    const f = writerFixture({ native: () => new Promise((_, r) => { reject = r; }), fastTimeout: true });
    assert.equal((await f.copy("First", "direct_request_9")).code, "copy_timeout");
    reject(new Error("late")); await tick(); assert.equal(f.calls.length, 1);
});
test("invalid local text/identity never touches any clipboard method", async () => {
    const f = writerFixture();
    for (const [text, id] of [["", "request_invalid_1"], ["x".repeat(205001), "request_invalid_1"], ["Text", "bad"]]) {
        assert.equal((await f.copy(text, id)).ok, false);
    }
    assert.equal(f.calls.length, 0);
});
test("content hotkey receipt identifies content rather than falsely claiming panel use", async () => {
    const f = writerFixture();
    assert.equal((await f.copy("Follow up", "hotkey_request_1", "content")).method, "content");
});

test("worker clipboard route is independent of storage and ignores offscreen replies", async () => {
    const f = apiFixture(), listeners = [], event = () => ({ addListener() {} });
    f.api.runtime.onMessage = { addListener(fn) { listeners.push(fn); } };
    f.api.runtime.onConnect = event(); f.api.runtime.onInstalled = event(); f.api.runtime.onStartup = event();
    f.api.tabs = { onRemoved: event(), onUpdated: event() };
    globalThis.chrome = f.api;
    try {
        await import("../background.js");
        let replies = 0;
        assert.equal(listeners[0]({ target: CLIPBOARD_TARGET }, sender(), () => replies++), false);
        assert.equal(replies, 0);
        const result = await new Promise(resolve => listeners[0](message(), { id: "fixture", url: f.api.runtime.getURL("index.html") }, resolve));
        assert.equal(result.ok, true);
    } finally { delete globalThis.chrome; }
});
