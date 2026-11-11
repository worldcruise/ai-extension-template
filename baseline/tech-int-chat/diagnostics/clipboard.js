// Optional manual acceptance tool. No clipboard reads, network, storage, or ChatGPT actions.
const button = document.getElementById("testClipboard");
const result = document.getElementById("result");
button.addEventListener("click", () => {
    const marker = "Tech Interview Chat v2.1.5 — native clipboard test";
    const report = {
        extensionVersion: chrome.runtime.getManifest().version,
        secureContext: window.isSecureContext,
        documentFocusedAtClick: document.hasFocus(),
        visibility: document.visibilityState,
        userActivationAtClick: navigator.userActivation?.isActive ?? null,
        nativeApiAvailable: typeof navigator.clipboard?.writeText === "function",
        status: "pending"
    };
    button.disabled = true;
    result.textContent = JSON.stringify(report, null, 2);
    function finish(status, error) {
        report.status = status;
        if (error) {
            report.errorName = error.name || "Error";
            report.errorMessage = error.message || "Clipboard operation rejected";
        } else report.expectedPastedText = marker;
        result.textContent = JSON.stringify(report, null, 2);
        button.disabled = false;
    }
    try {
        // Invoke from the button event, before awaiting any permission or browser work.
        const write = navigator.clipboard.writeText(marker);
        Promise.resolve(write).then(() => finish("native_write_resolved"), error => finish("native_write_rejected", error));
    } catch (error) { finish("native_write_unavailable", error); }
});
