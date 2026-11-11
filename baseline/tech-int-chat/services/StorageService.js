import { CONFIG } from "../core/Config.js";

const request = req => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});
function complete(tx) {
    const promise = new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error("Storage transaction aborted"));
        tx.onerror = () => {}; // the abort event carries the error
    });
    promise.catch(() => {}); // attach before any awaited request can fail
    return promise;
}
const freshMeta = (token, epoch = 0, version = 0) => ({
    key: "transcript", schema: 2, token, epoch, version, nextSeq: 0,
    rowCount: 0, textChars: 0, speakers: []
});

/** IndexedDB pages: writes only affected 128-row chunks, plus small indexes.
 * There is no whole-transcript in-memory cache. All row/index changes are atomic.
 */
export class StorageService {
    async open(token) {
        this.token = token;
        const req = indexedDB.open("tech-int-chat-v2", 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            db.createObjectStore("chunks", { keyPath: "id" });
            db.createObjectStore("lookup", { keyPath: "id" });
            db.createObjectStore("captions", { keyPath: "key" });
            db.createObjectStore("meta", { keyPath: "key" });
            db.createObjectStore("jobs", { keyPath: "id" });
        };
        this.db = await request(req);
        this.db.onversionchange = () => this.db.close();
        const tx = this.db.transaction(["chunks", "lookup", "captions", "meta", "jobs"], "readwrite");
        const done = complete(tx);
        const old = await request(tx.objectStore("meta").get("transcript"));
        if (!old || old.token !== token) {
            for (const name of ["chunks", "lookup", "captions", "meta", "jobs"]) {
                tx.objectStore(name).clear();
            }
            tx.objectStore("meta").put(freshMeta(token));
        }
        await done;
        return this;
    }
    async meta() {
        const tx = this.db.transaction("meta", "readonly");
        return request(tx.objectStore("meta").get("transcript"));
    }
    async mutate(operation) {
        const tx = this.db.transaction(["chunks", "lookup", "captions", "meta"], "readwrite");
        const done = complete(tx);
        const chunks = new Map(), dirty = new Set();
        const getChunk = async id => {
            if (!chunks.has(id)) {
                chunks.set(id, await request(tx.objectStore("chunks").get(id)) || { id, rows: [] });
            }
            return chunks.get(id);
        };
        const api = {
            meta: () => request(tx.objectStore("meta").get("transcript")),
            putMeta: data => request(tx.objectStore("meta").put(data)),
            caption: key => request(tx.objectStore("captions").get(key)),
            putCaption: value => request(tx.objectStore("captions").put(value)),
            row: async id => {
                const index = await request(tx.objectStore("lookup").get(id));
                if (!index) return null;
                const chunk = await getChunk(index.chunkId);
                return chunk.rows[index.offset] || null;
            },
            putRow: async row => {
                const chunkId = Math.floor(row.seq / CONFIG.chunkSize);
                const offset = row.seq % CONFIG.chunkSize;
                const chunk = await getChunk(chunkId);
                chunk.rows[offset] = row;
                dirty.add(chunkId);
                await request(tx.objectStore("lookup").put({ id: row.ticId, chunkId, offset }));
            },
            removeRow: async id => {
                const index = await request(tx.objectStore("lookup").get(id));
                if (!index) return null;
                const chunk = await getChunk(index.chunkId);
                const old = chunk.rows[index.offset];
                chunk.rows[index.offset] = null;
                dirty.add(index.chunkId);
                await request(tx.objectStore("lookup").delete(id));
                return old;
            }
        };
        try {
            const result = await operation(api);
            for (const id of dirty) {
                const chunk = chunks.get(id);
                if (chunk.rows.some(Boolean)) tx.objectStore("chunks").put(chunk);
                else tx.objectStore("chunks").delete(id);
            }
            await done;
            return result;
        } catch (error) {
            try { tx.abort(); } catch { /* already completed/aborted */ }
            await done.catch(() => {});
            throw error;
        }
    }
    async page(afterSeq = -1, limit = CONFIG.pageSize) {
        limit = Math.max(1, Math.min(CONFIG.pageSize, limit));
        const tx = this.db.transaction("chunks", "readonly");
        const store = tx.objectStore("chunks");
        const rows = [];
        return new Promise((resolve, reject) => {
            const req = store.openCursor(IDBKeyRange.lowerBound(Math.floor((afterSeq + 1) / CONFIG.chunkSize)));
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return resolve(rows);
                for (const row of cursor.value.rows) {
                    if (row && row.seq > afterSeq) {
                        rows.push(row);
                        if (rows.length === limit) return resolve(rows);
                    }
                }
                cursor.continue();
            };
        });
    }
    async content(ids) {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > 10000 ||
            new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string")) {
            throw new Error("Invalid transcript selection");
        }
        return this.mutate(async tx => {
            const parts = [];
            let size = 0;
            for (const id of ids) {
                const row = await tx.row(id);
                if (!row) throw new Error("Selection changed. Please select the transcript again.");
                size += row.content.length + 1;
                if (size > CONFIG.maxPromptChars) throw new Error("Selected transcript is too large for one prompt");
                parts.push(row.content);
            }
            return parts.join(" ");
        });
    }
    async clear(expectedEpoch) {
        const tx = this.db.transaction(["chunks", "lookup", "captions", "meta"], "readwrite");
        const done = complete(tx);
        const old = await request(tx.objectStore("meta").get("transcript"));
        if (expectedEpoch !== undefined && old.epoch !== expectedEpoch) {
            await done;
            return old;
        }
        for (const name of ["chunks", "lookup", "captions"]) tx.objectStore(name).clear();
        const meta = freshMeta(this.token, old.epoch + 1, old.version + 1);
        tx.objectStore("meta").put(meta);
        await done;
        return meta;
    }
    async getJob(id) {
        return request(this.db.transaction("jobs").objectStore("jobs").get(id));
    }
    async jobs() {
        return request(this.db.transaction("jobs").objectStore("jobs").getAll());
    }
    async putJob(job) {
        const tx = this.db.transaction("jobs", "readwrite"), done = complete(tx);
        tx.objectStore("jobs").put(job);
        await done;
    }
    async deleteJobs(ids) {
        const tx = this.db.transaction("jobs", "readwrite"), done = complete(tx);
        for (const id of ids) tx.objectStore("jobs").delete(id);
        await done;
    }
}
