import { CONFIG } from "../core/Config.js";

// Import only if the old snapshot still exists under the SAME extension identity.
// Chrome normally clears storage.session on reload/update. Export before upgrading.
export async function migrateLegacy(storage) {
    const saved = (await chrome.storage.session.get(CONFIG.legacyKey))[CONFIG.legacyKey];
    if (!Array.isArray(saved?.chats) || (await storage.meta()).rowCount) return;
    await storage.mutate(async tx => {
        const meta = await tx.meta();
        for (const [index, old] of saved.chats.entries()) {
            if (!old?.content) continue;
            const content = String(old.content);
            if (content.length > CONFIG.maxCaptionChars || meta.textChars + content.length > CONFIG.maxTextChars ||
                meta.rowCount >= CONFIG.maxRows) {
                throw new Error("Legacy transcript exceeds safety budget; export from the old version first");
            }
            const row = { role: String(old.role || "Unknown"), content,
                ticId: `legacy:${index}:${String(old.ticId || "row").slice(0, 256)}`,
                rawTicId: "legacy", revision: 1, isCurrentUser: Boolean(old.isCurrentUser),
                sourceTabId: null, sessionId: "legacy", seq: meta.nextSeq++,
                createdAt: saved.savedAt || Date.now(), updatedAt: Date.now() };
            await tx.putRow(row);
            meta.rowCount++; meta.textChars += content.length;
            if (!meta.speakers.includes(row.role)) meta.speakers.push(row.role);
        }
        meta.version++;
        await tx.putMeta(meta);
    });
    await chrome.storage.session.remove(CONFIG.legacyKey);
}
