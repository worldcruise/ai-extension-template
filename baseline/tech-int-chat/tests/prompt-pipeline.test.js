import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ChatGPTService } from "../services/ChatGPTService.js";

function promptContext() {
    const ctx = vm.createContext({});
    vm.runInContext("window=globalThis", ctx);
    for (const file of ["gptPrompts.js", "shared/PromptBuilder.js"]) {
        vm.runInContext(fs.readFileSync(new URL("../" + file, import.meta.url), "utf8"), ctx);
    }
    return ctx;
}
const variants = [
    [1, "conversation", "conversation", "normal"], [2, "conversation", "conversation", "detail"],
    [3, "conversation", "conversation", "star"], [1, "coding", "coding", "normal"],
    [2, "coding", "coding", "detail"], [3, "coding", "coding", "star"],
    ["conversation", "coding", "conversation", "normal"], ["coding", "conversation", "coding", "normal"],
    ["5", "coding", null, null], ["followup-detail", "conversation", "followUp", "detail"],
    ["followup-technical", "coding", "followUp", "technical"], ["followup-star", "coding", "followUp", "star"]
];
for (const [state, mode, category, key] of variants) {
    test(`shared builder preserves existing ${state}/${mode} text exactly`, () => {
        const ctx = promptContext(), content = "  Alice: Why?\nBob: 🧪\n  ";
        const prefix = category ? ctx.TECH_INT_GPT_PROMPTS[category][key] : "";
        const expected = category === "followUp" ? prefix : prefix + content.trim();
        assert.equal(ctx.TechIntPromptBuilder.build(state, content, mode), expected);
    });
}
test("builder rejects empty, oversized, non-string and unknown actions before copying", () => {
    const { TechIntPromptBuilder: builder } = promptContext();
    for (const [state, content] of [[1, " "], [1, "x".repeat(200001)], [1, {}], ["unknown", "Text"]]) {
        assert.throws(() => builder.build(state, content));
    }
});

function contentFixture() {
    const f = { contexts: [], sends: [], copies: [], listeners: [], keys: [], alerts: [] };
    const ctx = promptContext();
    Object.assign(ctx, { console, Promise, AbortController, crypto: globalThis.crypto,
        TechIntClipboard: { copy(text, requestId, context) {
            f.copies.push({ text, requestId, context });
            return f.copy ? f.copy() : Promise.resolve({ ok: true, method: "content", api: "writeText" });
        } },
        __techIntChatAdapterV2: { ChatGPTAdapter: class {
            async send(text, signal, context) { signal.throwIfAborted(); f.contexts.push(context); f.sends.push(text); return { status: "Content sent" }; }
        } },
        addEventListener(name, fn) { if (name === "keydown") f.keys.push(fn); },
        alert(text) { f.alerts.push(text); },
        chrome: { runtime: { id: "fixture", onMessage: { addListener(fn) { f.listeners.push(fn); } } } }
    });
    vm.runInContext(fs.readFileSync(new URL("../chatGPT.js", import.meta.url), "utf8"), ctx);
    f.request = m => new Promise(resolve => f.listeners[0](m, { id: "fixture" }, resolve));
    f.send = (extra = {}) => f.request({ type: "to-chatgpt", payloadVersion: 1, finalText: "Exact final text\r\n🧪",
        clipboard: { ok: true, method: "panel", api: "writeText" }, requestId: "prepared_request_1", ...extra });
    f.ctx = ctx;
    return f;
}
test("prepared payload is sent verbatim without a second clipboard call or prompt rebuild", async () => {
    const f = contentFixture();
    f.ctx.TechIntPromptBuilder = { ...f.ctx.TechIntPromptBuilder, build() { throw new Error("Must not rebuild"); } };
    const result = await f.send();
    assert.equal(result.status, "Content sent"); assert.equal(result.clipboard.method, "panel");
    assert.deepEqual(f.sends, ["Exact final text\r\n🧪"]); assert.equal(f.copies.length, 0);
});
test("prepared request replay returns the same result and does not send/copy twice", async () => {
    const f = contentFixture();
    const results = await Promise.all([f.send(), f.send()]); await f.send();
    assert.ok(results.every(r => r.status === "Content sent"));
    assert.equal(f.sends.length, 1); assert.equal(f.copies.length, 0);
});
test("prepared clipboard failure still sends exactly once and preserves diagnostics", async () => {
    const f = contentFixture();
    const result = await f.send({ clipboard: { ok: false, code: "copy_command_failed", nativeCode: "clipboard_write_denied" } });
    assert.equal(result.status, "Content sent"); assert.equal(result.clipboard.nativeCode, "clipboard_write_denied");
    assert.equal(f.sends.length, 1); assert.equal(f.copies.length, 0);
});
test("unprepared/invalid incoming messages cannot silently rebuild a different prompt", async () => {
    const f = contentFixture();
    for (const extra of [{ finalText: undefined }, { payloadVersion: 0 }, { finalText: "" },
        { finalText: "x".repeat(205001) }, { requestId: "bad" }]) {
        assert.equal((await f.send(extra)).status, "Error");
    }
    assert.equal(f.sends.length, 0); assert.equal(f.copies.length, 0);
});
test("direct ChatGPT hotkey starts copying synchronously and awaits it before send", async () => {
    const f = contentFixture(); let complete;
    f.copy = () => new Promise(resolve => { complete = resolve; });
    f.keys[0]({ key: "F8", repeat: false, preventDefault() {} });
    assert.equal(f.copies.length, 1); assert.equal(f.sends.length, 0);
    assert.equal(f.copies[0].text, f.ctx.TECH_INT_GPT_PROMPTS.followUp.detail);
    complete({ ok: true, method: "content" }); await new Promise(r => setImmediate(r));
    assert.deepEqual(f.sends, [f.copies[0].text]);
});
test("cancelling while a hotkey copy is pending prevents insertion, even on late copy success", async () => {
    const f = contentFixture(); let complete;
    f.copy = () => new Promise(resolve => { complete = resolve; });
    f.keys[0]({ key: "F9", repeat: false, preventDefault() {} });
    await f.request({ type: "cancel-chatgpt", requestId: f.copies[0].requestId });
    complete({ ok: true }); await new Promise(r => setImmediate(r));
    assert.equal(f.sends.length, 0);
});
test("repeating a held function key cannot submit multiple follow-ups", async () => {
    const f = contentFixture();
    f.keys[0]({ key: "F8", repeat: true, preventDefault() {} });
    assert.equal(f.copies.length, 0); assert.equal(f.sends.length, 0);
});
test("handshake advertises v2.1.5 prepared-payload support", async () => {
    const result = await contentFixture().request({ type: "ping" });
    assert.equal(result.version, "2.1.5"); assert.equal(result.preparedPayload, true); assert.equal(result.protocol, 2);
});

function serviceFixture({ pong = { protocol: 2, version: "2.1.5", preparedPayload: true }, noTab = false } = {}) {
    const f = { messages: [], payloads: [] };
    f.api = { runtime: {}, tabs: {
        async query() { return noTab ? [] : [{ id: 42, active: true }]; },
        sendMessage(tabId, message, cb) {
            f.messages.push(message);
            cb(message.type === "ping" ? pong : { status: "Content sent", clipboard: message.clipboard });
        }
    } };
    f.requests = { async submit(job, fn) {
        f.job = job;
        f.result = await fn(new AbortController().signal, async () => { f.dispatched = true; });
        return { ...job, status: "succeeded" };
    } };
    f.service = new ChatGPTService({ content() { throw new Error("Must not re-read the live transcript"); } }, f.requests);
    f.request = { payloadVersion: 1, finalText: "Already copied\n🧪", state: 2, aiMode: "coding",
        requestId: "service_request_1", clipboard: { ok: true, method: "panel", api: "writeText" } };
    return f;
}
test("service forwards frozen text, not selected IDs or independently rebuilt prompts", async () => {
    const f = serviceFixture(); globalThis.chrome = f.api;
    try {
        await f.service.submit(f.request);
        assert.equal(f.messages.at(-1).finalText, f.request.finalText);
        assert.equal(f.messages.at(-1).payloadVersion, 1);
        assert.equal(f.messages.at(-1).content, undefined);
        assert.equal(f.messages.at(-1).clipboard.ok, true);
        assert.equal(f.job.clipboard.api, "writeText"); assert.equal(f.dispatched, true);
        assert.ok(!JSON.stringify(f.job).includes("Already copied"));
    } finally { delete globalThis.chrome; }
});
test("stale ChatGPT controller is rejected before any external send", async () => {
    const f = serviceFixture({ pong: { protocol: 2, version: "2.1.1", clipboardBeforeSend: true } });
    globalThis.chrome = f.api;
    try {
        await assert.rejects(() => f.service.submit(f.request), /Refresh the ChatGPT tab/);
        assert.equal(f.dispatched, undefined); assert.equal(f.messages.length, 1);
    } finally { delete globalThis.chrome; }
});
test("legacy panel protocol and oversized final payloads are rejected", async () => {
    const f = serviceFixture();
    await assert.rejects(() => f.service.submit({ state: 1, data: { selectedIds: ["x"] } }), /Reload the extension panel/);
    await assert.rejects(() => f.service.submit({ ...f.request, finalText: "x".repeat(205001) }), /too large/);
});

test("diagnostics distinguish panel selection from a ChatGPT-page follow-up without rebuilding text", async () => {
    const f = contentFixture();
    await f.send({ state: 2 });
    assert.equal(f.contexts[0].source, "panel");
    assert.equal(f.contexts[0].action, 2);
    assert.equal(f.contexts[0].requestId, "prepared_request_1");
    f.keys[0]({ key: "F8", repeat: false, preventDefault() {} });
    await new Promise(r => setImmediate(r));
    assert.equal(f.contexts[1].source, "hotkey");
    assert.equal(f.contexts[1].action, "followup-detail");
});
