(() => {
  'use strict';
  if (window === window.top || globalThis.__sideAISearchLoaded) return;
  globalThis.__sideAISearchLoaded = true;
  const PRICE_URL = 'https://sideai.app/pricing?utm_source=ext_sidepanel_search&utm_medium=chrome_extension&utm_campaign=sideai_extension';
  const state = { host: null, shadow: null, matches: [], index: -1, query: '', licensed: false, previousFocus: null, observer: null, timer: null, opening: 0 };
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = el => !!(el && el.isConnected && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  async function refreshLicense() {
    try { state.licensed = Boolean((await chrome.runtime.sendMessage({ type: 'getUsageDataForAll' }))?.isLicensed); }
    catch (_) { state.licensed = false; }
    state.shadow?.querySelector('.sideai-search-upgrade')?.toggleAttribute('hidden', state.licensed);
  }
  function ensureUi() {
    if (state.host?.isConnected) return;
    const host = document.createElement('div');
    host.id = 'sideai-conversation-search-host';
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>
*{box-sizing:border-box}button,input{font:inherit}.shell{position:fixed;top:8px;left:50%;transform:translateX(-50%);width:min(300px,calc(100vw - 14px));pointer-events:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#0b1324}.bar{display:flex;align-items:center;gap:3px;height:38px;padding:4px 6px 4px 10px;border:1px solid #d8e1e5;border-radius:12px;background:rgba(255,255,255,.98);box-shadow:0 9px 25px rgba(15,23,42,.12)}.bar input{appearance:none;min-width:0;flex:1;border:0;outline:0;padding:0;margin:0;background:transparent;font-size:13px;color:#101828}.bar input::placeholder{color:#7b8491}.count{flex:0 0 29px;text-align:center;font-size:11px;color:#475467;font-variant-numeric:tabular-nums}.icon{appearance:none;display:flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;margin:0;padding:0;border:0;border-radius:7px;background:transparent;color:#182230;font-size:16px;line-height:1;cursor:pointer}.icon:hover,.icon:focus-visible{background:#f0f5f3;outline:0}.sideai-search-upgrade{flex:0 0 26px;width:26px;height:26px;overflow:hidden;color:#b96900;background:#fff8e7;border:1px solid #ffdb99}.sideai-search-upgrade[hidden]{display:none}.sideai-search-upgrade span:last-child{display:none}.sideai-search-upgrade .crown{display:flex;align-items:center;justify-content:center;width:17px;height:17px;flex:0 0 17px}.sideai-search-upgrade svg{display:block;width:17px;height:17px}.crown{color:#f59e0b;font-size:14px}.shell[hidden]{display:none!important}.results{display:none;margin-top:7px;max-height:min(310px,48vh);overflow:auto;padding:6px;border:1px solid #dce8e2;border-radius:15px;background:rgba(255,255,255,.99);box-shadow:0 18px 45px rgba(15,23,42,.16)}.results.open{display:block}.result{width:100%;display:grid;grid-template-columns:32px minmax(0,1fr);gap:9px;text-align:left;border:0;border-radius:10px;padding:8px;background:transparent;color:#172033;cursor:pointer}.result:hover,.result.active{background:#eefbf5}.result-icon,.result img{width:32px;height:32px;border-radius:8px;object-fit:cover;background:#e6f7ee;display:grid;place-items:center;color:#07966c}.result-title{display:block;font-size:12px;font-weight:750;margin-bottom:2px}.snippet{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:12px;line-height:1.35;color:#536174}.empty{padding:14px;text-align:center;font-size:13px;color:#667085}.upgrade-backdrop{position:fixed;inset:0;display:none;place-items:center;padding:18px;background:rgba(7,11,18,.72);backdrop-filter:blur(3px);pointer-events:auto}.upgrade-backdrop.open{display:grid}.upgrade-card{position:relative;width:min(420px,100%);padding:28px 24px 24px;border:1px solid #e3e9e6;border-radius:18px;background:#fff;box-shadow:0 28px 80px rgba(0,0,0,.3);text-align:center}.upgrade-close{position:absolute;right:13px;top:12px;width:32px;height:32px;border:0;border-radius:9px;background:transparent;color:#536174;font-size:24px;cursor:pointer}.badge{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 18px;border:1px solid #ffd79a;border-radius:14px;background:#fff8ea;color:#f59e0b;font-size:28px}.upgrade-card h2{margin:0 0 12px;font-size:25px;letter-spacing:-.03em}.upgrade-card p{margin:0 auto 22px;max-width:330px;color:#697386;font-size:16px;line-height:1.45}.upgrade-cta{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;padding:14px;border:2px solid #fff;border-radius:12px;outline:2px solid #b9c0c4;background:#07111f;color:#fff;font-weight:800;font-size:16px;cursor:pointer}.upgrade-cta:hover{background:#0c1d32}@media(max-width:320px){.shell{top:6px}.bar{gap:2px;padding-left:7px}.count{flex-basis:26px}.icon{flex-basis:22px;width:22px;height:22px}.results{max-height:40vh}}</style>
<div class="shell" hidden><div class="bar" role="search"><input type="search" aria-label="Search this SideAI chat" placeholder="Search this chat" autocomplete="off"><span class="count" aria-live="polite">0/0</span><button class="icon sideai-search-upgrade" type="button" aria-label="Upgrade to Premium"><span class="crown" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Zm3 15h12"/></svg></span><span>Upgrade</span></button><button class="icon prev" type="button" aria-label="Previous result">↑</button><button class="icon next" type="button" aria-label="Next result">↓</button><button class="icon close" type="button" aria-label="Close search">×</button></div><div class="results" role="listbox" aria-label="Search results"></div></div>
<div class="upgrade-backdrop" role="dialog" aria-modal="true" aria-labelledby="sideai-search-upgrade-title"><div class="upgrade-card"><button class="upgrade-close" type="button" aria-label="Close premium reminder">×</button><div class="badge" aria-hidden="true"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Zm3 15h12"/></svg></div><h2 id="sideai-search-upgrade-title">Upgrade to Premium</h2><p>Premium unlocks advanced SideAI features, including everything we add in the future.</p><button class="upgrade-cta" type="button"><span class="crown" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 6 4 4 5-7 5 7 4-4-2 12H5L3 6Zm3 15h12"/></svg></span> Upgrade to Premium</button></div></div>`;
    const finalStyle = document.createElement('style');
    finalStyle.textContent = '.bar{background:#fff}.icon:disabled{opacity:.72;cursor:default}';
    shadow.appendChild(finalStyle);
    document.documentElement.appendChild(host); state.host = host; state.shadow = shadow;
    shadow.querySelector('.upgrade-backdrop').addEventListener('keydown',event=>{
      if(event.key==='Tab') { const buttons=[...shadow.querySelectorAll('.upgrade-card button')];const i=buttons.indexOf(shadow.activeElement);event.preventDefault();buttons[(i+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus(); }
    });
    const input = shadow.querySelector('input');
    input.addEventListener('input', () => runSearch(input.value));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); selectRelative(event.shiftKey ? -1 : 1); } if (event.key === 'Escape') { event.preventDefault(); closeSearch(); } });
    shadow.querySelector('.prev').addEventListener('click', () => selectRelative(-1)); shadow.querySelector('.next').addEventListener('click', () => selectRelative(1)); shadow.querySelector('.close').addEventListener('click', closeSearch); shadow.querySelector('.sideai-search-upgrade').addEventListener('click', showUpgrade); shadow.querySelector('.upgrade-close').addEventListener('click', hideUpgrade); shadow.querySelector('.upgrade-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) hideUpgrade(); }); shadow.querySelector('.upgrade-cta').addEventListener('click', () => window.open(PRICE_URL, '_blank', 'noopener')); shadow.querySelector('.results').addEventListener('click', event => { const item = event.target.closest('[data-index]'); if (item) select(Number(item.dataset.index)); });
  }
  // Ranges highlight the original DOM without replacing React-owned message content.
  const conversationRoot = () => document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
  function collect(query) {
    const root = conversationRoot(), matches = [], groups = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el || el.closest('script,style,noscript,textarea,input,[contenteditable="true"],[hidden],[aria-hidden="true"],#sideai-conversation-search-host') || !visible(el) || !node.data) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let group;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const block = node.parentElement.closest('p,li,pre,td,th,h1,h2,h3,h4,h5,h6,blockquote,[data-message-author-role],article') || node.parentElement;
      if (!group || group.block !== block) { group = {block,text:'',nodes:[]}; groups.push(group); }
      group.nodes.push({node,start:group.text.length}); group.text += node.data;
    }
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');
    for (const group of groups) {
      let match; pattern.lastIndex=0;
      while ((match=pattern.exec(group.text)) && matches.length < 10000) {
        const start=match.index,end=start+match[0].length;
        const first=group.nodes.find(x=>start>=x.start&&start<x.start+x.node.length);
        const last=group.nodes.find(x=>end>x.start&&end<=x.start+x.node.length);
        if (!first || !last) continue;
        const range=document.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);
        matches.push(range);
      }
    }
    // Image descriptions and named links/actions are searchable even without text nodes.
    for (const el of root.querySelectorAll('img[alt],img[aria-label],a[aria-label],button[aria-label]')) {
      if (!visible(el) || el.closest('[hidden],[aria-hidden="true"]')) continue;
      const label = normalize(el.getAttribute('alt') || el.getAttribute('aria-label'));
      if (label.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && !normalize(el.innerText).toLocaleLowerCase().includes(query.toLocaleLowerCase())) matches.push(el);
    }
    return matches;
  }
  function clearHighlight() {
    CSS.highlights?.delete('sideai-find'); CSS.highlights?.delete('sideai-find-active');
    if (state.activeElement) { state.activeElement.style.removeProperty('outline'); state.activeElement.style.removeProperty('outline-offset'); state.activeElement = null; }
  }
  function render() {
    state.shadow.querySelector('.count').textContent = `${state.matches.length ? state.index+1 : 0}/${state.matches.length}`;
    state.shadow.querySelector('.results').hidden = true;
    for(const name of ['.prev','.next'])state.shadow.querySelector(name).disabled=!state.matches.length;
    clearHighlight();
    if (typeof Highlight !== 'undefined' && state.matches.length) {
      const all=new Highlight();for(const range of state.matches)if(range instanceof Range)all.add(range);
      if(all.size)CSS.highlights.set('sideai-find',all);
      const active=state.matches[state.index];
      if(active instanceof Range) CSS.highlights.set('sideai-find-active',new Highlight(active));
      else if(active instanceof Element) { active.style.setProperty('outline','3px solid #fb8c63','important');active.style.setProperty('outline-offset','3px','important');state.activeElement=active; }
    }
  }
  function runSearch(value, scroll=true) {
    state.query=value;state.matches=value ? collect(value) : [];state.index=state.matches.length ? 0 : -1;render();
    if(scroll && state.index>=0)select(0);
  }
  function select(index) {
    if(!state.matches.length)return;
    state.index=(index+state.matches.length)%state.matches.length;render();
    const range=state.matches[state.index];
    (range instanceof Range ? range.startContainer.parentElement : range)?.scrollIntoView({block:'center',behavior:'instant'});
  }
  function selectRelative(step) { if(state.matches.length)select(state.index+step); }
  function showUpgrade() { if(state.licensed)return; state.shadow.querySelector('.upgrade-backdrop').classList.add('open'); state.shadow.querySelector('.upgrade-close').focus(); }
  function hideUpgrade() { state.shadow.querySelector('.upgrade-backdrop').classList.remove('open'); state.shadow.querySelector('input').focus(); }
  function closeSearch() { ++state.opening; clearHighlight(); state.shadow.querySelector('.shell').hidden = true; state.shadow.querySelector('.upgrade-backdrop').classList.remove('open'); state.observer?.disconnect(); clearTimeout(state.timer); state.previousFocus?.focus?.(); }
  async function openSearch() {
    const opening=++state.opening;
    state.previousFocus=document.activeElement;ensureUi();state.shadow.querySelector('.shell').hidden=false;
    if(!document.getElementById('sideai-find-highlight-style')) {
      const style=document.createElement('style');style.id='sideai-find-highlight-style';
      style.textContent='::highlight(sideai-find){background:#ffe394;color:#111}::highlight(sideai-find-active){background:#fb8c63;color:#111}';document.documentElement.append(style);
    }
    await refreshLicense();if(opening!==state.opening)return;
    const input=state.shadow.querySelector('input');input.focus();input.select();runSearch(input.value,false);
    state.shadow.querySelector('.upgrade-backdrop').classList.remove('open');
    if(!state.licensed)showUpgrade();
    state.observer?.disconnect();
    state.observer=new MutationObserver(()=>{clearTimeout(state.timer);state.timer=setTimeout(()=>runSearch(input.value,false),180)});
    state.observer.observe(conversationRoot(),{subtree:true,childList:true,characterData:true});
  }
  window.addEventListener('message',event=>{
    if(event.source===window.parent && event.origin==='chrome-extension://'+chrome.runtime.id && event.data?.type==='SIDEAI_FIND_IN_CHAT')void openSearch();
  });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && String(event.key).toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); void openSearch(); } else if (event.key === 'Escape' && state.shadow?.querySelector('.upgrade-backdrop.open')) { event.preventDefault(); hideUpgrade(); } }, true);
})();
