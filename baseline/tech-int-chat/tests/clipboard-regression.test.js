import test from "node:test";
import assert from "node:assert/strict";
import { RequestManager, clipboardReceipt } from "../core/RequestManager.js";

class JobStorage {
    constructor() { this.map = new Map(); }
    async putJob(j) { this.map.set(j.id, structuredClone(j)); }
    async getJob(id) { return this.map.get(id); }
    async jobs() { return [...this.map.values()]; }
    async deleteJobs(ids) { ids.forEach(id => this.map.delete(id)); }
}
async function runJob(result) {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await manager.run({ id: "receipt_test_1", createdAt: Date.now() }, new AbortController(), async () => result);
    return storage.getJob("receipt_test_1");
}

test("successful ChatGPT submission preserves a failed clipboard receipt for the panel", async () => {
    const job = await runJob({ status: "Content sent", clipboard: { ok: false, code: "copy_command_failed" } });
    assert.equal(job.status, "succeeded");
    assert.deepEqual(job.clipboard, { ok: false, code: "copy_command_failed" });
});

test("successful clipboard receipt is durable but clipboard text is never persisted", async () => {
    const job = await runJob({ status: "Content sent", clipboard: { ok: true, method: "panel", text: "secret" } });
    assert.deepEqual(job.clipboard, { ok: true, method: "panel" });
    assert.ok(!JSON.stringify(job).includes("secret"));
});

test("failed ChatGPT insertion still preserves the already completed clipboard outcome", async () => {
    const job = await runJob({ status: "Error", error: "Unsent draft", uncertain: false,
        clipboard: { ok: true, method: "offscreen" } });
    assert.equal(job.status, "failed");
    assert.deepEqual(job.clipboard, { ok: true, method: "offscreen" });
});

test("missing or malformed clipboard receipts cannot masquerade as successful copying", () => {
    for (const value of [undefined, null, {}, { ok: "true" }, { ok: false, code: "contains private data" }]) {
        assert.deepEqual(clipboardReceipt(value), { ok: false, code: "not_reported" });
    }
});


test("a pre-dispatch ChatGPT error retains the originating panel clipboard receipt", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await manager.run({ id: "receipt_test_2", createdAt: Date.now(),
        clipboard: { ok: true, method: "panel", api: "writeText" } }, new AbortController(),
        async () => { throw new Error("Refresh the ChatGPT tab"); });
    const job = await storage.getJob("receipt_test_2");
    assert.equal(job.status, "failed");
    assert.deepEqual(job.clipboard, { ok: true, method: "panel", api: "writeText" });
});

test("native failure code is retained but arbitrary response data is never persisted", () => {
    assert.deepEqual(clipboardReceipt({ ok: false, code: "copy_command_failed", nativeCode: "clipboard_write_denied",
        error: "Private text", text: "Private text" }),
        { ok: false, code: "copy_command_failed", nativeCode: "clipboard_write_denied" });
    assert.equal(clipboardReceipt({ ok: false, nativeCode: "Private text" }).nativeCode, undefined);
});
