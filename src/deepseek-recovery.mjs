// Retry once after an offline/online transition. Ordinary panel expansion and
// provider changes must never reload an established conversation.
export function createDeepseekRecovery({ getState, probe, reconnect, onChange = () => {}, online = true,
  schedule = setTimeout, cancel = clearTimeout }) {
  let offline = !online, timer = null, disposed = false;
  function stop() { if (timer !== null) cancel(timer); timer = null; }
  return {
    get offline() { return offline; },
    setOnline(value) {
      if (disposed || offline === !value) return;
      offline = !value; stop();
      if (!offline && getState().mounted) {
        probe();
        // Give the page a chance to recover itself and report current input.
        timer = schedule(() => {
          timer = null;
          const state = getState();
          if (!disposed && !offline && state.mounted && !state.ready && !state.protected) reconnect();
        }, 2000);
      }
      onChange();
    },
    stop,
    dispose() { disposed = true; stop(); }
  };
}
