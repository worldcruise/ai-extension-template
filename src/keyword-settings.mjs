import './keyword-matcher.js';

export function createKeywordSettings({ onChange = () => {}, browser = globalThis.chrome } = {}) {
  const { storageKey, palette, normalize, parseInput } = globalThis.AiAgentKeywords;
  const q = selector => document.querySelector(selector);
  const form = q('#keyword-settings-form');
  const toggle = q('#highlight-keywords');
  const save = q('#keyword-save');
  const status = q('#keyword-save-status');
  const color = q('#keyword-color');
  const list = q('#keyword-list');
  const colorPresets = [...form.querySelectorAll('[name="keyword-color-preset"]')];
  let current = normalize();
  let pending = Promise.resolve();
  let activeGroup = 'yellow';
  let lists = Object.fromEntries(palette.map(group => [group.id, '']));
  function showGroup() {
    list.value = lists[activeGroup];
    q('#keyword-list-label').textContent = `${palette.find(group => group.id === activeGroup).label} keywords`;
    for (const preset of colorPresets) preset.checked = preset.value === activeGroup;
  }
  function selectGroup(id) {
    lists[activeGroup] = list.value;
    activeGroup = id;
    showGroup();
  }
  function reflectCustomColor() {
    colorPresets.find(preset => preset.value === 'custom').nextElementSibling.style.backgroundColor = color.value;
    selectGroup('custom');
  }
  for (const preset of colorPresets) {
    preset.nextElementSibling.style.backgroundColor = palette.find(group => group.id === preset.value).color;
    preset.addEventListener('change', () => {
      if (preset.checked) selectGroup(preset.value);
    });
  }
  color.addEventListener('input', reflectCustomColor);
  color.addEventListener('change', reflectCustomColor);
  function reflect() {
    toggle.checked = current.enabled;
    q('#keyword-enabled').checked = current.enabled;
    lists = Object.fromEntries(current.groups.map(group => [group.id, group.keywords.join('\n')]));
    color.value = current.groups.find(group => group.id === 'custom').color;
    colorPresets.find(preset => preset.value === 'custom').nextElementSibling.style.backgroundColor = color.value;
    showGroup();
    q('#keyword-case-sensitive').checked = current.caseSensitive;
    q('#keyword-whole-words').checked = current.wholeWords;
  }
  async function persist(next, resetForm = true) {
    current = normalize(next);
    if (resetForm) reflect();
    else toggle.checked = q('#keyword-enabled').checked = current.enabled;
    onChange(current);
    const snapshot = structuredClone(current);
    status.textContent = 'Saving…';
    pending = pending.catch(() => {}).then(() => browser.storage.local.set({ [storageKey]: snapshot }));
    try { await pending; status.textContent = 'Keyword settings saved on this device.'; }
    catch { status.textContent = 'Could not save keyword settings. Please try again.'; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      lists[activeGroup] = list.value;
      const next = { enabled: q('#keyword-enabled').checked,
        caseSensitive: q('#keyword-case-sensitive').checked, wholeWords: q('#keyword-whole-words').checked };
      next.groups = palette.map(group => {
        try { return { id: group.id, color: group.id === 'custom' ? color.value : group.color, keywords: parseInput(lists[group.id], next.caseSensitive) }; }
        catch (error) { selectGroup(group.id); list.focus(); throw new Error(`${group.label}: ${error.message}`); }
      });
      save.disabled = true;
      await persist(next);
    } catch (error) { status.textContent = error.message; }
    finally { save.disabled = false; }
  });
  form.addEventListener('input', event => {
    if (event.target.name !== 'keyword-color-preset') status.textContent = 'Unsaved keyword changes.';
  });
  toggle.addEventListener('change', () => { void persist({ ...current, enabled: toggle.checked }, false); });
  const changed = (changes, area) => {
    if (area !== 'local' || !changes[storageKey]) return;
    const next = normalize(changes[storageKey].newValue);
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    current = next; reflect(); onChange(current);
  };
  browser.storage.onChanged.addListener(changed);
  window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(changed));
  form.inert = true; toggle.disabled = true;
  const ready = browser.storage.local.get(storageKey).then(data => {
    current = normalize(data[storageKey]);
    activeGroup = current.groups.find(group => group.keywords.length)?.id || 'yellow';
    reflect(); onChange(current);
    status.textContent = 'Keywords are used only on job web pages.';
  }).catch(() => { status.textContent = 'Could not load keyword settings. You can edit and save them again.'; })
    .finally(() => { form.inert = false; toggle.disabled = false; });
  return { ready };
}
