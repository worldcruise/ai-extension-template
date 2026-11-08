(() => {
  const api = globalThis.browser || globalThis.chrome;
  const L = globalThis.HCX_LIB;

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'HCX_PING') { sendResponse({ pong: true }); return; }
    if (msg?.type !== 'HCX_INDEED_FETCH') return;
    (async () => {
      try {
        const res = await fetch(msg.url, { credentials: 'include' });
        const html = await res.text();
        const resp = {
          ok: res.ok,
          status: res.status,
          challenge: L.looksLikeChallenge(html, res.status)
        };

        if (msg.raw) resp.text = html;
        else { resp.noResults = L.indeedNoResults(html); resp.cards = L.parseIndeedCards(html); }
        sendResponse(resp);
      } catch (e) {
        sendResponse({ error: String(e && e.message || e) });
      }
    })();
    return true;
  });
})();
