import test from "node:test";
import assert from "node:assert/strict";
import { TranscriptStore } from "../core/TranscriptStore.js";
import { SessionManager } from "../core/SessionManager.js";
import { MessageQueue } from "../core/MessageQueue.js";
import { RequestManager } from "../core/RequestManager.js";

class MemoryTx {
    constructor() { this.data = { epoch: 0, version: 0, rowCount: 0, textChars: 0, nextSeq: 0, speakers: [] };
        this.rows = new Map(); this.captions = new Map(); }
    async meta() { return structuredClone(this.data); }
    async putMeta(data) { this.data = structuredClone(data); }
    async row(id) { return this.rows.get(id); }
    async putRow(row) { this.rows.set(row.ticId, row); }
    async removeRow(id) { const row = this.rows.get(id); this.rows.delete(id); return row; }
    async caption(key) { return this.captions.get(key); }
    async putCaption(value) { this.captions.set(value.key, value); }
}
const source = { tabId: 1, instanceId: "src_a", sessionId: "1:src_a" };
const store = new TranscriptStore();
function patch(revision, texts = ["hello"], overrides = {}, src = source) {
    return store.normalizePatch({ protocol: 2, epoch: 0, patchId: `patch_${revision}`,
        groups: [{ rawTicId: "row_a", revision, chunks: texts.map(content => ({ role: "Alice", content })) }],
        ...overrides }, src);
}
test("normalizes sender-scoped row identity, not a claimed tab ID", () => {
    const normalized = patch(1);
    assert.equal(normalized.groups[0].chunks[0].ticId, "1:src_a:row_a_0");
    assert.equal(normalized.groups[0].chunks[0].sourceTabId, 1);
});
test("new revisions replace rows; stale/out-of-order revisions cannot roll them back", async () => {
    const tx = new MemoryTx();
    await store.apply(tx, patch(3, ["latest"]));
    const result = await store.apply(tx, patch(1, ["older"]));
    assert.equal(result.changed, 0); assert.equal([...tx.rows.values()][0].content, "latest");
    assert.equal(tx.data.version, 1);
});
test("retrying a whole patch is idempotent", async () => {
    const tx = new MemoryTx(); const p = patch(1);
    await store.apply(tx, p); await store.apply(tx, p);
    assert.equal(tx.rows.size, 1); assert.equal(tx.data.rowCount, 1); assert.equal(tx.data.version, 1);
});
test("caption resegmentation removes obsolete suffixes and rejects old suffix replay", async () => {
    const tx = new MemoryTx();
    await store.apply(tx, patch(1, ["first", "second", "third"]));
    const result = await store.apply(tx, patch(2, ["merged sentence"]));
    assert.equal(result.removals.length, 2);
    await store.apply(tx, patch(1, ["first", "second", "third"]));
    assert.equal(tx.rows.size, 1); assert.equal(tx.data.rowCount, 1);
    assert.equal(tx.data.textChars, "merged sentence".length);
});
test("role-only revisions propagate", async () => {
    const tx = new MemoryTx(); await store.apply(tx, patch(1));
    const p = patch(2); p.groups[0].chunks[0].role = "Bob";
    assert.equal((await store.apply(tx, p)).changes[0].role, "Bob");
});
test("clear generation rejects in-flight pre-clear captions", async () => {
    const tx = new MemoryTx(); tx.data.epoch = 2;
    assert.equal((await store.apply(tx, patch(1))).status, "STALE_EPOCH");
    assert.equal(tx.rows.size, 0);
});
test("two source documents with the same raw ID do not overwrite each other", async () => {
    const tx = new MemoryTx();
    await store.apply(tx, patch(1));
    await store.apply(tx, patch(1, ["other"], {}, { tabId: 2, instanceId: "src_a", sessionId: "2:src_a" }));
    assert.equal(tx.rows.size, 2);
});
test("malformed, oversized, missing-protocol and negative-revision patches fail", () => {
    assert.throws(() => patch(-1), /revision/);
    assert.throws(() => patch(1, ["x".repeat(65537)]), /large/);
    assert.throws(() => patch(1, ["hi"], { protocol: 1 }), /Invalid/);
    assert.throws(() => patch(1, [""]), /Empty/);
});
test("tab identity is derived from trusted sender metadata", () => {
    const sender = { tab: { id: 7 }, frameId: 0, url: "https://meet.google.com/abc" };
    assert.equal(SessionManager.source(sender, { sourceInstanceId: "src_x", tabId: 999 }).tabId, 7);
    assert.throws(() => SessionManager.source({ ...sender, url: "https://evil.example" }, { sourceInstanceId: "src_x" }));
    assert.throws(() => SessionManager.source({ ...sender, frameId: 1 }, { sourceInstanceId: "src_x" }));
});
test("serialized operations keep order and recover after a rejection", async () => {
    const queue = new MessageQueue(), calls = [];
    const first = queue.run(async () => { await new Promise(r => setTimeout(r, 5)); calls.push(1); throw new Error("failure"); });
    const second = queue.run(() => calls.push(2));
    await assert.rejects(first); await second;
    assert.deepEqual(calls, [1, 2]);
});
class JobStorage {
    constructor() { this.map = new Map(); }
    async jobs() { return [...this.map.values()].map(j => structuredClone(j)); }
    async getJob(id) { return structuredClone(this.map.get(id)); }
    async putJob(job) { this.map.set(job.id, structuredClone(job)); }
    async deleteJobs(ids) { ids.forEach(id => this.map.delete(id)); }
}
const tick = () => new Promise(r => setTimeout(r, 5));
async function terminal(storage, id) {
    for (let i = 0; i < 100; i++) {
        const job = await storage.getJob(id);
        if (["succeeded", "failed", "uncertain", "cancelled"].includes(job?.status)) { await tick(); return job; }
        await tick();
    }
    throw new Error("job timeout");
}
test("duplicate request ID returns the same running AND completed result", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    let count = 0, finish;
    const execute = async (signal, before) => { count++; await before(); await new Promise(r => { finish = r; }); return { status: "Content sent" }; };
    const req = { id: "request_abc", fingerprint: "hash", tabId: 1 };
    await manager.submit(req, execute); await tick(); await manager.submit(req, execute);
    finish(); await terminal(storage, req.id); await manager.submit(req, execute);
    assert.equal(count, 1);
});
test("different click IDs with the same in-flight payload are coalesced", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    let finish;
    const execute = async () => { await new Promise(r => { finish = r; }); return { status: "Content sent" }; };
    await manager.submit({ id: "request_one", fingerprint: "same", tabId: 1 }, execute);
    await tick();
    const second = await manager.submit({ id: "request_two", fingerprint: "same", tabId: 1 }, execute);
    assert.equal(second.id, "request_one"); finish(); await terminal(storage, "request_one");
});
test("reusing a request ID for different content is rejected", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await manager.submit({ id: "request_one", fingerprint: "a", tabId: 1 }, async () => ({ status: "Content sent" }));
    await terminal(storage, "request_one");
    await assert.rejects(manager.submit({ id: "request_one", fingerprint: "b", tabId: 1 }, () => {}), /different prompt/);
});
test("transport failure after dispatch is uncertain, never auto-replayed", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    let calls = 0;
    const execute = async (signal, before) => { calls++; await before(); throw new Error("channel closed"); };
    const req = { id: "request_test", fingerprint: "h", tabId: 1 };
    await manager.submit(req, execute);
    assert.equal((await terminal(storage, req.id)).status, "uncertain");
    await manager.submit(req, execute); assert.equal(calls, 1);
});
test("explicit pre-click failure from adapter is safe and actionable", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await manager.submit({ id: "request_test", fingerprint: "h", tabId: 1 }, async (signal, before) => {
        await before(); return { status: "Error", error: "Unsent draft", uncertain: false };
    });
    assert.equal((await terminal(storage, "request_test")).status, "failed");
});
test("worker recovery distinguishes pre-dispatch from ambiguous dispatch", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await storage.putJob({ id: "before", status: "running", phase: "preparing" });
    await storage.putJob({ id: "after", status: "running", phase: "dispatching" });
    await manager.recover();
    assert.equal((await storage.getJob("before")).status, "failed");
    assert.equal((await storage.getJob("after")).status, "uncertain");
});
test("synchronous handler exceptions are recorded and release the busy lock", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    await manager.submit({ id: "request_fail", fingerprint: "h", tabId: 1 }, () => { throw new Error("sync"); });
    assert.equal((await terminal(storage, "request_fail")).status, "failed");
    assert.equal(manager.running, null);
});
test("coalesced request aliases survive a lost acknowledgment beyond the double-click window", async () => {
    const storage = new JobStorage(), manager = new RequestManager(storage);
    let finish, count = 0;
    const execute = async () => { count++; await new Promise(r => { finish = r; }); return { status: "Content sent" }; };
    await manager.submit({ id: "request_first", fingerprint: "same", tabId: 1 }, execute);
    await tick();
    const alias = { id: "request_alias", fingerprint: "same", tabId: 1 };
    assert.equal((await manager.submit(alias, execute)).id, "request_first");
    finish(); await terminal(storage, "request_first");
    const completed = await storage.getJob("request_first");
    completed.updatedAt -= 10000;
    await storage.putJob(completed);
    assert.equal((await manager.submit(alias, execute)).id, "request_first");
    assert.equal(count, 1);
});
test("empty caption groups cannot create unbounded tombstone-only records", () => {
    assert.throws(() => patch(1, []), /revision/);
});
