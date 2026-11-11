import test from "node:test";
import assert from "node:assert/strict";
import { submissionDiagnostics, submissionCode } from "../core/SubmissionDiagnostics.js";
import { RequestManager } from "../core/RequestManager.js";

const receipt = () => ({ version: "2.1.5", requestId: "test_request_01", stage: "insertion", code: "insertion_not_accepted",
    source: "panel", action: "normal", elapsedMs: 5000, expectedChars: 123, actualChars: 0,
    editorKind: "prosemirror", documentFocused: false, transientActivation: false, clicked: false });
class Storage {
    map = new Map();
    async jobs() { return [...this.map.values()]; }
    async getJob(id) { return this.map.get(id); }
    async putJob(job) { this.map.set(job.id, structuredClone(job)); }
    async deleteJobs(ids) { for (const id of ids) this.map.delete(id); }
}
async function result(manager, storage, response) {
    const job = await manager.submit({ id: "test_request_01", fingerprint: "fingerprint", tabId: 1, clipboard: { ok: true } },
        async (signal, beforeDispatch) => { await beforeDispatch(); return response; });
    for (let i = 0; i < 100; i++) {
        const saved = await storage.getJob(job.id);
        if (["succeeded", "failed", "uncertain", "cancelled"].includes(saved.status)) return saved;
        await new Promise(resolve => setTimeout(resolve, 2));
    }
    throw new Error("Job did not settle");
}
test("submission metadata is retained without arbitrary payload fields", () => {
    const raw = { ...receipt(), text: "SECRET_TRANSCRIPT", html: "SECRET_HTML", url: "SECRET_URL", nested: { prompt: "SECRET_PROMPT" } };
    assert.deepEqual(submissionDiagnostics(raw), receipt());
    assert.ok(!JSON.stringify(submissionDiagnostics(raw)).includes("SECRET"));
});
test("unrecognized code, stage, action and tag cannot smuggle content into diagnostics", () => {
    const safe = submissionDiagnostics({ code: "sensitive text", stage: "sensitive text", action: "sensitive text", editorTag: "sensitive text" });
    assert.deepEqual(safe, { version: "2.1.5", code: "adapter_error" });
    assert.equal(submissionCode("insertion_not_accepted"), "insertion_not_accepted");
});
test("wrong types and invalid IDs are removed and metric sizes are bounded", () => {
    const safe = submissionDiagnostics({ requestId: "not valid!", actualChars: -1, expectedChars: "123", clicked: "true", elapsedMs: 1000000000 });
    assert.deepEqual(safe, { version: "2.1.5", code: "adapter_error", elapsedMs: 10000000 });
    assert.equal(submissionDiagnostics(null), undefined);
});
test("a failed insertion stores its code, phase, metadata and successful clipboard receipt", async () => {
    const storage = new Storage(), manager = new RequestManager(storage);
    const saved = await result(manager, storage, { status: "Error", error: "Insertion rejected", uncertain: false,
        code: "insertion_not_accepted", diagnostics: { ...receipt(), text: "SECRET" }, clipboard: { ok: true } });
    assert.equal(saved.status, "failed"); assert.equal(saved.code, "insertion_not_accepted");
    assert.deepEqual(saved.diagnostics, receipt()); assert.equal(saved.clipboard.ok, true);
    assert.ok(!JSON.stringify(saved).includes("SECRET"));
});
test("post-click diagnostic failure is uncertain and retains its specific stage/code", async () => {
    const storage = new Storage(), manager = new RequestManager(storage);
    const diagnostic = { ...receipt(), stage: "acknowledgment", code: "submission_not_acknowledged", clicked: true };
    const saved = await result(manager, storage, { status: "Error", error: "No acknowledgment", uncertain: true,
        code: diagnostic.code, diagnostics: diagnostic });
    assert.equal(saved.status, "uncertain"); assert.equal(saved.code, diagnostic.code);
    assert.equal(saved.diagnostics.clicked, true); assert.match(saved.error, /Check ChatGPT/);
});
test("successful submission retains a sanitized diagnostic receipt, not the outgoing string", async () => {
    const storage = new Storage(), manager = new RequestManager(storage);
    const diagnostic = { ...receipt(), stage: "submission", code: "submitted", clicked: true };
    const saved = await result(manager, storage, { status: "Content sent", diagnostics: { ...diagnostic, finalText: "SECRET" } });
    assert.equal(saved.status, "succeeded"); assert.deepEqual(saved.diagnostics, diagnostic);
    assert.ok(!JSON.stringify(saved).includes("SECRET"));
});
