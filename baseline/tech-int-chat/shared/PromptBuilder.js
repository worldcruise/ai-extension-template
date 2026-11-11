// Shared, synchronous prompt construction. Loaded before the panel and ChatGPT controller.
// The panel freezes the displayed selection once; the receiver never rebuilds that string.
(function () {
    "use strict";
    if (globalThis.TechIntPromptBuilder) return;
    const MAX_CONTENT = 200000;
    const MAX_PAYLOAD = 205000;
    const normalizeMode = mode => mode === "coding" ? "coding" : "conversation";
    function build(state, content, aiMode = "conversation") {
        const config = globalThis.TECH_INT_GPT_PROMPTS;
        if (!config?.conversation || !config?.coding || !config?.followUp) {
            throw new Error("Prompt definitions are unavailable. Reload the extension panel and ChatGPT tab.");
        }
        const key = String(state);
        if (!["1", "2", "3", "5", "conversation", "coding", "followup-detail", "followup-technical", "followup-star"].includes(key)) {
            throw new Error("Unknown prompt action");
        }
        if (typeof content !== "string" || content.length > MAX_CONTENT) {
            throw new Error("Prompt is empty or exceeds the 200,000-character safety limit");
        }
        const clean = content.trim();
        if (!key.startsWith("followup-") && !clean) throw new Error("Prompt is empty");
        const mode = key === "conversation" || key === "coding" ? key : normalizeMode(aiMode);
        const prompts = config[mode];
        let text;
        switch (key) {
            case "conversation": case "coding": case "1": text = prompts.normal + clean; break;
            case "2": text = prompts.detail + clean; break;
            case "3": text = prompts.star + clean; break;
            case "5": text = clean; break;
            default: text = config.followUp[key.slice("followup-".length)];
        }
        if (typeof text !== "string" || !text.trim() || text.length > MAX_PAYLOAD) {
            throw new Error("Final prompt is empty or too large");
        }
        return text;
    }
    globalThis.TechIntPromptBuilder = Object.freeze({ build, normalizeMode, MAX_PAYLOAD });
})();
