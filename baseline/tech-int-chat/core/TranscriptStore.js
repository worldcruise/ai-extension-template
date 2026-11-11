import { CONFIG } from "./Config.js";

const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
const idOK = id => typeof id === "string" && /^[a-zA-Z0-9_:-]{1,256}$/.test(id);

/** Pure protocol normalization. No Chrome, DOM, storage, timers or hidden globals. */
export class TranscriptStore {
    normalizePatch(data, source) {
        if (!data || typeof data !== "object" || data.protocol !== CONFIG.protocol || !idOK(data.patchId) ||
            !Number.isSafeInteger(data.epoch) || !Array.isArray(data.groups) ||
            data.groups.length > CONFIG.maxGroupsPerPatch) {
            throw new Error("Invalid transcript patch; refresh the Meet tab after upgrading");
        }
        let totalChars = 0;
        const groups = data.groups.map(group => {
            if (!idOK(group?.rawTicId) || !Number.isSafeInteger(group.revision) ||
                group.revision < 1 || !Array.isArray(group.chunks) ||
                group.chunks.length === 0 || group.chunks.length > CONFIG.maxChunksPerCaption) {
                throw new Error("Invalid caption revision");
            }
            const key = `${source.sessionId}:${group.rawTicId}`;
            let captionChars = 0;
            const chunks = group.chunks.map((chunk, index) => {
                if (typeof chunk?.content !== "string" || chunk.content.length > CONFIG.maxCaptionChars) {
                    throw new Error("Caption is too large");
                }
                const content = clean(chunk.content);
                if (!content) throw new Error("Empty caption chunk");
                const role = clean(chunk.role || "Unknown").slice(0, 256);
                captionChars += content.length;
                return {
                    ticId: `${key}_${index}`, rawTicId: key, revision: group.revision,
                    chunkIndex: index, role, content, isCurrentUser: Boolean(chunk.isCurrentUser),
                    sourceTabId: source.tabId, sourceInstanceId: source.instanceId,
                    sessionId: source.sessionId
                };
            });
            if (captionChars > CONFIG.maxCaptionChars) throw new Error("Caption is too large");
            totalChars += captionChars;
            return { key, revision: group.revision, chunks };
        });
        if (totalChars > 1048576) throw new Error("Patch is too large");
        return { ...source, epoch: data.epoch, patchId: data.patchId, groups };
    }

    /** Called inside ONE durable transaction; stale/replayed revisions are harmless. */
    async apply(tx, patch) {
        const meta = await tx.meta();
        if (patch.epoch !== meta.epoch) {
            return { status: "STALE_EPOCH", epoch: meta.epoch, version: meta.version };
        }
        const changes = [], removals = [];
        let touched = false;
        const speakers = new Set(meta.speakers);
        for (const group of patch.groups) {
            const old = await tx.caption(group.key);
            if (old && old.revision >= group.revision) continue;
            touched = true;
            const newIds = new Set(group.chunks.map(row => row.ticId));
            for (const id of old?.ids || []) {
                if (!newIds.has(id)) {
                    const removed = await tx.removeRow(id);
                    if (removed) {
                        meta.rowCount--;
                        meta.textChars -= removed.content.length;
                        removals.push(id);
                    }
                }
            }
            for (const item of group.chunks) {
                const previous = await tx.row(item.ticId);
                const row = { ...item,
                    seq: previous?.seq ?? meta.nextSeq++,
                    createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() };
                meta.textChars += row.content.length - (previous?.content.length || 0);
                if (!previous) meta.rowCount++;
                if (meta.rowCount > CONFIG.maxRows || meta.textChars > CONFIG.maxTextChars) {
                    throw new Error("Transcript safety limit reached. Download it and use Clear before continuing.");
                }
                await tx.putRow(row);
                changes.push(row);
                speakers.add(row.role);
            }
            // This tombstone also protects removed suffixes from delayed old revisions.
            await tx.putCaption({ key: group.key, revision: group.revision,
                ids: [...newIds], sessionId: patch.sessionId, updatedAt: Date.now() });
        }
        if (touched) {
            meta.speakers = [...speakers];
            meta.version++;
            await tx.putMeta(meta);
        }
        return { status: "Patch applied", patchId: patch.patchId, epoch: meta.epoch,
            version: meta.version, changed: changes.length, changes, removals,
            speakers: meta.speakers, rowCount: meta.rowCount };
    }
}
