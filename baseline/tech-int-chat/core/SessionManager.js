export class SessionManager {
    static source(sender, data) {
        if (!Number.isInteger(sender?.tab?.id) || (sender.frameId ?? 0) !== 0) {
            throw new Error("Caption messages must come from a top-level Meet tab");
        }
        const url = new URL(sender.url || sender.tab.url || "about:blank");
        if (url.protocol !== "https:" || url.hostname !== "meet.google.com") {
            throw new Error("Caption source is not Google Meet");
        }
        if (typeof data?.sourceInstanceId !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(data.sourceInstanceId)) {
            throw new Error("Invalid caption source identity");
        }
        return { tabId: sender.tab.id, instanceId: data.sourceInstanceId,
            sessionId: `${sender.tab.id}:${data.sourceInstanceId}` };
    }
}
