import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(read("manifest.json"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, "2.1.5");
assert.equal(JSON.parse(read("package.json")).version, manifest.version);
assert.equal(manifest.background.type, "module");
assert.deepEqual(manifest.permissions, ["tabs", "sidePanel", "scripting", "storage", "clipboardWrite", "offscreen"]);
assert.deepEqual(manifest.host_permissions, ["https://meet.google.com/*", "https://chatgpt.com/*", "https://chat.openai.com/*"]);
const required = [manifest.background.service_worker, manifest.action.default_popup,
    manifest.side_panel.default_path, ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(script => script.js),
    "offscreen/clipboard.html", "offscreen/clipboard.js", "diagnostics/clipboard.html", "diagnostics/clipboard.js"];
for (const file of required) assert.ok(fs.existsSync(path.join(root, file)), `Missing manifest asset: ${file}`);
for (const html of ["index.html", "offscreen/clipboard.html", "diagnostics/clipboard.html"]) {
    for (const match of read(html).toString().matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)) {
        assert.ok(fs.existsSync(path.resolve(root, path.dirname(html), match[1])), `Missing HTML script: ${match[1]}`);
    }
}
const scriptsInPanel = [...read("index.html").toString().matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)].map(m => m[1]);
assert.deepEqual(scriptsInPanel.slice(-4), ["./gptPrompts.js", "./shared/PromptBuilder.js", "./shared/ClipboardWriter.js", "./popup.js"]);
const baseline = JSON.parse(read("docs/preservation.json"));
for (const [file, expected] of Object.entries(baseline.files)) {
    const bytes = file === "index.html" ? Buffer.from(read(file).toString().replace(
        /^    <script src="\.\/(?:gptPrompts\.js|shared\/PromptBuilder\.js|shared\/ClipboardWriter\.js)"><\/script>\r?\n/gm, "")) : read(file);
    assert.equal(hash(bytes), expected, `Preserved visual markup, prompts or icons changed: ${file}`);
}
const meeting = read("meeting.js").toString().replace(/\r\n/g, "\n");
const selectorBlock = meeting.match(/    const SELECTORS = \{[\s\S]*?\n    \};/)[0];
assert.equal(hash(selectorBlock), baseline.selector_block, "Meet selector block changed");
for (const [name, expected] of Object.entries(baseline.meet_functions)) {
    const start = meeting.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `Missing preserved function ${name}`);
    const end = meeting.indexOf("\n    function ", start + 1);
    const block = meeting.slice(start, end < 0 ? undefined : end).trim();
    assert.equal(hash(block), expected, `Meet extraction function changed: ${name}`);
}
function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
        if (["node_modules", ".git", "__pycache__"].includes(item.name)) return [];
        const full = path.join(directory, item.name);
        return item.isDirectory() ? walk(full) : [full];
    });
}
const scripts = walk(root).filter(file => /\.(js|mjs)$/.test(file));
for (const file of scripts) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
        assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), `Unresolved import in ${file}: ${match[1]}`);
    }
}
assert.ok(!meeting.includes("CAPTURE_INTERVAL_MS"));
assert.ok(!read("popup.js").toString().includes("setInterval(requestChatSnapshot"));

const runtimeFiles = ["background.js", "meeting.js", "popup.js", "chatGPT.js",
    "adapters/ChatGPTAdapter.js", "services/ChatGPTService.js", "shared/ClipboardWriter.js"];
for (const file of runtimeFiles) {
    assert.ok(!/\b(?:window\.)?alert\s*\(/.test(read(file).toString()), `Blocking alert remains in runtime file: ${file}`);
}
const adapter = read("adapters/ChatGPTAdapter.js").toString();
assert.ok(adapter.includes(`button[type="submit"]`), "Form-local submit fallback is missing");
assert.ok(adapter.includes("const form = editor?.closest(\"form\") || null"), "Submit fallback is not scoped to the composer form");
assert.ok(!adapter.includes("submission_not_acknowledged"), "Adapter still blocks on fragile post-submit acknowledgment DOM");
assert.ok(adapter.includes("Broad contenteditable selectors are a last resort and must belong to a form"), "Composer selection is not constrained against auxiliary editors");
assert.ok(adapter.includes("\\u200B-\\u200D"), "Zero-width composer placeholders are not normalized away");
const background = read("background.js").toString();
assert.ok(!background.includes("chrome.tabs.onUpdated.addListener"), "Normal ChatGPT navigation still cancels a running submission");
const contentController = read("chatGPT.js").toString();
assert.ok(!contentController.includes('window.addEventListener("pagehide"'), "Page unload still aborts a submission after Send");
const diagnosticProtocol = read("core/SubmissionDiagnostics.js").toString();
assert.ok(diagnosticProtocol.includes('"submitted"') && diagnosticProtocol.includes('"submission"'), "v2.1.5 submit receipt is not accepted by the diagnostic allowlist");
console.log(`PASS: MV3 manifest, ${required.length} manifest references, ${scripts.length} JavaScript syntax checks, local imports, unchanged permissions, original visual markup/CSS/prompts/icons, selector block and 11 extraction functions, no runtime alert(), form-local ChatGPT submit fallback, navigation-safe submit completion, scoped composer discovery, and zero-width placeholder normalization.`);
