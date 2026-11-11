import { MessageQueue } from "./MessageQueue.js";
import { CONFIG } from "./Config.js";
import { submissionCode, submissionDiagnostics } from "./SubmissionDiagnostics.js";

/** Persist only a receipt, never arbitrary response fields or clipboard text. */
export function clipboardReceipt(value) {
    if (value?.ok === true) {
        const receipt = { ok: true };
        if (["panel", "content", "offscreen"].includes(value.method)) receipt.method = value.method;
        if (["writeText", "execCommand"].includes(value.api)) receipt.api = value.api;
        return receipt;
    }
    const receipt = { ok: false, code: /^[a-z_]{1,48}$/.test(value?.code || "") ? value.code : "not_reported" };
    if (/^[a-z_]{1,48}$/.test(value?.nativeCode || "")) receipt.nativeCode = value.nativeCode;
    return receipt;
}

export const TERMINAL = new Set(["succeeded", "failed", "uncertain", "cancelled", "alias"]);

/** Durable submission ledger. Ambiguous side effects are NEVER automatically replayed. */
export class RequestManager {
    constructor(storage, notify = () => {}) {
        this.storage = storage;
        this.notify = notify;
        this.queue = new MessageQueue();
        this.running = null;
    }
    async recover() {
        for (const job of await this.storage.jobs()) {
            if (!TERMINAL.has(job.status)) {
                await this.save({ ...job, status: job.phase === "dispatching" ? "uncertain" : "failed",
                    error: job.phase === "dispatching"
                        ? "The worker restarted during submission. Check ChatGPT before sending again."
                        : "The worker restarted before submission. You may retry.", updatedAt: Date.now() });
            }
        }
        await this.prune();
    }
    async save(job) {
        await this.storage.putJob(job);
        this.notify(job);
        return job;
    }
    async prune() {
        const all = (await this.storage.jobs()).sort((a, b) => b.createdAt - a.createdAt);
        await this.storage.deleteJobs(all.slice(CONFIG.maxJobs).filter(j => TERMINAL.has(j.status)).map(j => j.id));
    }
    submit({ id, fingerprint, tabId, clipboard }, execute) {
        return this.queue.run(async () => {
            if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) {
                throw new Error("A valid requestId is required");
            }
            const old = await this.storage.getJob(id);
            if (old) {
                if (old.fingerprint !== fingerprint) throw new Error("Request ID reused with a different prompt");
                if (old.aliasOf) {
                    return (await this.storage.getJob(old.aliasOf)) || { ...old, status: "uncertain",
                        error: "The original submission receipt expired. Check ChatGPT before resending." };
                }
                return old;
            }
            const now = Date.now();
            const same = (await this.storage.jobs()).find(job => job.fingerprint === fingerprint &&
                (!TERMINAL.has(job.status) || (job.status === "succeeded" && now - job.updatedAt < 2000)));
            if (same) {
                // Keep the alias durable too: its acknowledgment can be lost, and a
                // retry after the coalescing window must still resolve to the first job.
                await this.storage.putJob({ id, aliasOf: same.id, fingerprint, tabId,
                    status: "alias", createdAt: now, updatedAt: now });
                return same;
            }
            if (this.running) throw new Error("Another ChatGPT submission is in progress. Wait for it to finish.");
            const job = { id, fingerprint, tabId, status: "queued", phase: "preparing",
                clipboard: clipboardReceipt(clipboard), createdAt: now, updatedAt: now };
            await this.save(job);
            const controller = new AbortController();
            this.running = { id, tabId, controller };
            // This is bounded work, not an always-on timer. The ledger survives worker termination.
            this.run(job, controller, execute).catch(() => {});
            return job;
        });
    }
    async run(job, controller, execute) {
        let phase = "preparing";
        let clipboard = clipboardReceipt(job.clipboard);
        let diagnostics;
        try {
            await this.save({ ...job, status: "running", phase, updatedAt: Date.now() });
            const result = await execute(controller.signal, async () => {
                controller.signal.throwIfAborted();
                phase = "dispatching";
                // Persist BEFORE crossing the external side-effect boundary.
                await this.save({ ...job, status: "running", phase, updatedAt: Date.now() });
                controller.signal.throwIfAborted();
            });
            if (result?.clipboard) clipboard = clipboardReceipt(result.clipboard);
            diagnostics = submissionDiagnostics(result?.diagnostics);
            if (result?.status === "Error") {
                const error = new Error(result.error || "ChatGPT submission failed");
                error.uncertain = Boolean(result.uncertain);
                error.safe = !error.uncertain;
                error.code = result.code;
                throw error;
            }
            if (result?.status !== "Content sent") {
                const error = new Error("Submission acknowledgment was not recognized. Check ChatGPT before resending.");
                error.uncertain = true;
                throw error;
            }
            await this.save({ ...job, status: "succeeded", phase: "acknowledged", clipboard, ...(diagnostics ? { diagnostics } : {}), updatedAt: Date.now() });
        } catch (error) {
            diagnostics ||= submissionDiagnostics(error.diagnostics);
            const code = submissionCode(error.code);
            if (diagnostics) console.info("[tech-int-chat 2.1.5] " + JSON.stringify(diagnostics));
            const uncertain = Boolean(error.uncertain) || (phase === "dispatching" && !error.safe);
            await this.save({ ...job, status: uncertain ? "uncertain" :
                (controller.signal.aborted ? "cancelled" : "failed"), phase,
                error: uncertain ? "Submission could not be confirmed. Check ChatGPT before resending." :
                    (error.message || "Submission failed"), code, ...(diagnostics ? { diagnostics } : {}), clipboard, updatedAt: Date.now() });
        } finally {
            if (this.running?.id === job.id) this.running = null;
            await this.prune();
        }
    }
    cancelTab(tabId) {
        if (this.running?.tabId === tabId) this.running.controller.abort(new Error("ChatGPT tab closed or navigated"));
    }
}
