(() => {
  "use strict";

  const bindingName = "__jwGovernedEvaluationV4AttemptSink";
  const sink = globalThis[bindingName];
  if (typeof sink !== "function") return;

  const stateKey = "__JW_AUTOFILL_V4_TRIPWIRE__";
  if (globalThis[stateKey]?.installed) return;
  const state = {
    installed: true,
    guardVersion: "autofill-v4-guard/1",
    nodeBindingInstalled: true,
    documentStartPreload: true,
    autofillAttempts: 0,
    uinfAttempts: 0,
    uploadAttempts: 0,
    formWriteAttempts: 0,
    submitAttempts: 0,
    networkMutationAttempts: 0,
  };
  Object.defineProperty(globalThis, stateKey, { value: state, configurable: false });

  const increment = (kind) => {
    state[kind] = Math.min(Number.MAX_SAFE_INTEGER, Number(state[kind] || 0) + 1);
    try { void sink(JSON.stringify({ version: state.guardVersion, kind })); } catch (_) {}
  };
  const wrapSetter = (prototype, property) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (!descriptor?.set || descriptor.set.__jwGovernedEvaluationV4) return;
    const guarded = function governedEvaluationV4Setter(value) {
      increment(property === "files" ? "uploadAttempts" : "formWriteAttempts");
      return value;
    };
    Object.defineProperty(guarded, "__jwGovernedEvaluationV4", { value: true });
    Object.defineProperty(prototype, property, { ...descriptor, set: guarded });
  };
  [
    [HTMLInputElement.prototype, "value"],
    [HTMLInputElement.prototype, "checked"],
    [HTMLInputElement.prototype, "files"],
    [HTMLTextAreaElement.prototype, "value"],
    [HTMLSelectElement.prototype, "value"],
    [HTMLSelectElement.prototype, "selectedIndex"],
  ].forEach(([prototype, property]) => {
    try { wrapSetter(prototype, property); } catch (_) {}
  });

  try {
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function governedEvaluationV4Submit() {
      increment("submitAttempts");
      return undefined;
    };
    Object.defineProperty(HTMLFormElement.prototype.submit, "name", { value: nativeSubmit.name });
    const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
    if (nativeRequestSubmit) {
      HTMLFormElement.prototype.requestSubmit = function governedEvaluationV4RequestSubmit() {
        increment("submitAttempts");
        return undefined;
      };
      Object.defineProperty(HTMLFormElement.prototype.requestSubmit, "name", { value: nativeRequestSubmit.name });
    }
    document.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      increment("submitAttempts");
    }, true);
  } catch (_) {}

  try {
    const runtime = globalThis.chrome?.runtime;
    const nativeSendMessage = runtime?.sendMessage?.bind(runtime);
    if (nativeSendMessage) {
      runtime.sendMessage = function governedEvaluationV4SendMessage(...args) {
        const message = args.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry)) || {};
        const requestPath = String(message.path || "").replace(/^\/+/, "");
        const isUinf = requestPath === "uinf";
        const isUpload = /(?:^|\/)upload_resume(?:$|[/?])/u.test(requestPath);
        const isUserWrite = /^(?:save_apply_result|activity\/batch|bug|profile\/(?:upload_resume|delete_resume|resume_set_default|save)|save_ats_profile|save_profile_)/u.test(requestPath);
        if (isUinf || isUpload || isUserWrite) {
          increment("networkMutationAttempts");
          if (isUinf) increment("uinfAttempts");
          if (isUpload) increment("uploadAttempts");
          const callback = args.find((entry) => typeof entry === "function");
          if (callback) queueMicrotask(() => callback({ status: -1, blocked_by_runner: true }));
          return Promise.resolve({ status: -1, blocked_by_runner: true });
        }
        return nativeSendMessage(...args);
      };
    }
  } catch (_) {}

  document.addEventListener("click", (event) => {
    const target = event.target?.closest?.("button,[role='button'],input");
    if (!target) return;
    const text = String(target.textContent || target.value || target.getAttribute?.("aria-label") || "");
    const upload = target instanceof HTMLInputElement && target.type === "file";
    const autofill = /autofill|auto[ -]?fill/i.test(text);
    if (autofill) increment("autofillAttempts");
    if (upload) increment("uploadAttempts");
    if (autofill || upload) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  Object.defineProperty(globalThis, "__JW_GOVERNED_EVALUATION_V4_GUARD__", {
    value: Object.freeze({
      blockAutofill() {
        increment("autofillAttempts");
        return true;
      },
    }),
    configurable: false,
  });
})();
