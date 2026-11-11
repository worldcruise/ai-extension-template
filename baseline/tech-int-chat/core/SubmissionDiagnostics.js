// Narrow allowlist: a content script must never persist arbitrary objects/prompt text
// in a job's diagnostic field. All text values here are fixed protocol enumerations.
const codes = new Set(["received", "editor_ready", "paste_attempted", "native_setter_attempted",
    "native_insert_attempted", "insertion_verified", "send_ready", "send_clicked", "submitted", "acknowledged",
    "submission_busy", "invalid_prompt", "readiness_timeout", "cancelled", "page_changed", "prompt_changed",
    "existing_draft", "generation_in_progress", "editor_not_found", "editor_replaced",
    "insertion_not_accepted", "send_button_not_ready", "submission_not_acknowledged", "adapter_error"]);
const stages = new Set(["editor_lookup", "insertion", "send_button", "submission", "acknowledgment", "complete"]);
export function submissionCode(value) { return codes.has(value) ? value : "adapter_error"; }
export function submissionDiagnostics(value) {
    if (!value || typeof value !== "object") return undefined;
    const out = { version: "2.1.5", code: submissionCode(value.code) };
    if (/^[a-zA-Z0-9_-]{8,128}$/.test(value.requestId || "")) out.requestId = value.requestId;
    if (["normal", "detail", "star", "analysis", "followup_detail", "followup_technical", "followup_star", "prepared"].includes(value.action)) out.action = value.action;
    if (stages.has(value.stage)) out.stage = value.stage;
    if (["panel", "hotkey"].includes(value.source)) out.source = value.source;
    if (["visible", "hidden", "prerender"].includes(value.visibility)) out.visibility = value.visibility;
    if (["NONE", "DIV", "P", "TEXTAREA", "INPUT", "SPAN", "SECTION"].includes(value.editorTag)) out.editorTag = value.editorTag;
    if (["none", "native_setter", "paste_event", "native_insert"].includes(value.insertionMethod)) out.insertionMethod = value.insertionMethod;
    if (["none", "native", "prosemirror", "lexical", "contenteditable"].includes(value.editorKind)) out.editorKind = value.editorKind;
    for (const key of ["knownEditorCandidates", "elapsedMs", "expectedChars", "actualChars", "inputEvents", "trustedInputs", "replacements"]) {
        if (Number.isSafeInteger(value[key]) && value[key] >= 0) out[key] = Math.min(value[key], 10000000);
    }
    for (const key of ["documentFocused", "transientActivation", "editorFound", "activeInEditor", "textMatches", "sendFound", "sendEnabled",
        "generationActive", "pasteHandled", "nativeReturned", "clicked"]) {
        if (typeof value[key] === "boolean") out[key] = value[key];
    }
    return out;
}
