(() => {
  'use strict';
  if (window.__hcxInjected) return;
  window.__hcxInjected = true;

  const post = payload => { try { window.postMessage({ __hcx: true, ...payload }, '*'); } catch { } };

  function parseDataUrl(u) {
    try {
      const url = new URL(u, location.origin);
      if (!/\/_next\/data\/[^/]+\/index\.json/.test(url.pathname)) return null;
      const m = url.pathname.match(/\/_next\/data\/([^/]+)\/index\.json/);
      const buildId = m ? m[1] : null;
      const rawState = url.searchParams.get('searchState');
      const searchStateStr = rawState != null ? rawState : '{}';
      const page = Number(url.searchParams.get('page')) || null;
      return { buildId, searchStateStr, page };
    } catch { return null; }
  }

  function emitSearch(meta, json) {
    try {
      const pp = (json && json.pageProps) || {};
      post({
        type: 'HCX_SEARCH',
        buildId: meta.buildId,
        searchStateStr: meta.searchStateStr,
        hits: pp.ssrHits || [],
        isLastPage: !!pp.ssrIsLastPage,
        page: meta.page || pp.ssrPage || 1,
        total: pp.ssrTotalCount
      });
    } catch { }
  }

  try {
    const nd = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
    const pp = nd.props && nd.props.pageProps ? nd.props.pageProps : {};
    post({
      type: 'HCX_INIT',
      buildId: nd.buildId || null,
      searchStateStr: JSON.stringify(pp.initialSearchState || {}),
      hits: pp.ssrHits || [],
      isLastPage: !!pp.ssrIsLastPage,
      page: pp.ssrPage || 1,
      total: pp.ssrTotalCount
    });
  } catch { }

  const origFetch = window.fetch;
  if (origFetch && !origFetch.__hcxWrapped) {
    const wrapped = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const meta = url ? parseDataUrl(url) : null;
      const p = origFetch.apply(this, arguments);
      if (meta) {
        p.then(res => {
          try {
            res.clone().json().then(json => emitSearch(meta, json)).catch(() => { });
          } catch { }
        }).catch(() => { });
      }
      return p;
    };
    wrapped.__hcxWrapped = true;
    try { window.fetch = wrapped; } catch { }
  }

  try {
    const XHR = window.XMLHttpRequest;
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      this.__hcxMeta = url ? parseDataUrl(url) : null;
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      if (this.__hcxMeta) {
        this.addEventListener('load', () => {
          try {
            const json = JSON.parse(this.responseText);
            emitSearch(this.__hcxMeta, json);
          } catch { }
        });
      }
      return send.apply(this, arguments);
    };
  } catch { }

  try {
    const wrap = name => {
      const orig = history[name];
      history[name] = function () {
        const r = orig.apply(this, arguments);
        post({ type: 'HCX_NAV', url: location.href });
        return r;
      };
    };
    wrap('pushState'); wrap('replaceState');
    window.addEventListener('popstate', () => post({ type: 'HCX_NAV', url: location.href }));
  } catch { }
})();
