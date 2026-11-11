import { TranscriptStore } from "../core/TranscriptStore.js";
import { SessionManager } from "../core/SessionManager.js";
import { MessageQueue } from "../core/MessageQueue.js";

export class TranscriptService {
    constructor(storage) {
        this.storage = storage;
        this.store = new TranscriptStore();
        this.queue = new MessageQueue();
        this.subscribers = new Map();
    }
    remove(port) { this.subscribers.delete(port); }
    post(port, message) {
        try { port.postMessage(message); return true; }
        catch { this.remove(port); return false; }
    }
    broadcast(message) {
        for (const [port, ready] of this.subscribers) if (ready) this.post(port, message);
    }
    subscribe(port, known = {}) {
        return this.queue.run(async () => {
            this.subscribers.set(port, false);
            const meta = await this.storage.meta();
            if (known.epoch === meta.epoch && known.version === meta.version) {
                if (this.post(port, { type: "SYNC_READY", ...meta })) this.subscribers.set(port, true);
                return;
            }
            if (!this.post(port, { type: "SNAPSHOT_START", epoch: meta.epoch, version: meta.version })) return;
            let after = -1;
            while (this.subscribers.has(port)) {
                const rows = await this.storage.page(after);
                if (!rows.length) break;
                if (!this.post(port, { type: "SNAPSHOT_PAGE", chats: rows, speakers: meta.speakers })) return;
                after = rows[rows.length - 1].seq;
            }
            if (this.subscribers.has(port) && this.post(port, { type: "SNAPSHOT_END",
                epoch: meta.epoch, version: meta.version, rowCount: meta.rowCount, speakers: meta.speakers })) {
                this.subscribers.set(port, true);
            }
        });
    }
    patch(data, sender) {
        const source = SessionManager.source(sender, data);
        const patch = this.store.normalizePatch(data, source);
        return this.queue.run(async () => {
            const result = await this.storage.mutate(tx => this.store.apply(tx, patch));
            if (result.status === "Patch applied" && (result.changes.length || result.removals.length)) {
                this.broadcast({ type: "CHAT_PATCH_UPDATE", ...result });
            }
            return { status: result.status, epoch: result.epoch, version: result.version,
                patchId: result.patchId, changed: result.changed };
        });
    }
    clear(epoch) {
        return this.queue.run(async () => {
            const current = await this.storage.meta();
            if (current.epoch !== epoch) return { ...current, cleared: false };
            const meta = await this.storage.clear(epoch);
            this.broadcast({ type: "TRANSCRIPT_CLEARED", epoch: meta.epoch, version: meta.version });
            return { ...meta, cleared: true };
        });
    }
}
