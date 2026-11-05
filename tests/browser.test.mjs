// Optional browser verification: install playwright, or use CODEX_PRIMARY_RUNTIME_NODE_MODULES.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  if (!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) throw new Error('Install playwright to run browser verification.');
  ({ chromium } = createRequire(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'loader.cjs'))('playwright'));
}
const base = fileURLToPath(new URL('../', import.meta.url));
const qa = resolve(base, '../qa');
await mkdir(qa, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1040 } });
const page = await context.newPage();
const errors = [];
const requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push(request.url()));

try {
  await page.goto(new URL('../preview.html', import.meta.url).href);
  await page.getByRole('button', { name: 'Preview sign in' }).waitFor();
  assert.equal(await page.locator('[data-el="go"]').isDisabled(), true);
  assert.match(await page.getByRole('status').innerText(), /Preview only.*No live connection/);
  await page.screenshot({ path: resolve(qa, 'agent-desktop-signed-out.png') });
  await page.getByRole('button', { name: 'Preview sign in' }).click();
  await page.locator('[data-el="account"]:visible').waitFor();
  assert.equal(await page.locator('[data-el="account"]').innerText(), 'Preview account');
  assert.equal(await page.locator('[data-el="effort"]').inputValue(), 'medium');
  await page.locator('[data-el="effort"]').selectOption('high');
  await page.getByRole('button', { name: 'Go', exact: false }).click();
  await page.locator('[data-el="result"]:visible').waitFor();
  assert.match(await page.locator('[data-el="result"]').innerText(), /SAMPLE RESULT.*UI PREVIEW/);
  assert.match(await page.locator('[data-el="result"]').innerText(), /Thinking effort: high/);
  await page.screenshot({ path: resolve(qa, 'agent-desktop-result.png') });

  // Sample provider output is rendered as literal text, never executable markup.
  await page.locator('[data-el="input"]').fill('<img src=x onerror="window.injected=true">');
  assert.equal(await page.locator('[data-el="result"]').isHidden(), true);
  await page.locator('[data-el="input"]').press('Control+Enter');
  await page.locator('[data-el="result"]:visible').waitFor();
  assert.match(await page.locator('[data-el="result"]').innerText(), /<img src=x/);
  assert.equal(await page.locator('[data-el="result"] img').count(), 0);
  assert.equal(await page.evaluate(() => window.injected), undefined);

  await page.locator('[data-el="model"]').selectOption('sample-standard');
  assert.equal(await page.locator('[data-el="effort"]').isDisabled(), true);
  await page.getByRole('button', { name: 'Go', exact: false }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await page.locator('[data-el="result"]').isHidden(), true);
  assert.match(await page.getByRole('status').innerText(), /canceled/);

  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Template name').fill('Job summary agent');
  await page.locator('[data-el="settings-prompt"]').selectOption('fixed');
  await page.locator('[data-el="settings-input"]').selectOption('hidden');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  assert.equal(await page.locator('[data-el="prompt"]').getAttribute('readonly'), '');
  assert.equal(await page.locator('[data-el="input-panel"]').isHidden(), true);
  assert.equal(await page.locator('[data-el="title"]').innerText(), 'Job summary agent');

  // Restore both editable sections before responsive layout checks.
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await page.locator('[data-el="settings-prompt"]').selectOption('editable');
  await page.locator('[data-el="settings-input"]').selectOption('editable');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await page.locator('[data-el="input"]').fill('Sample job description.');
  await page.getByRole('button', { name: 'Go', exact: false }).click();
  await page.locator('[data-el="result"]:visible').waitFor();

  const layouts = [];
  for (const width of [1440, 1024, 768, 620, 390, 320]) {
    await page.setViewportSize({ width, height: 1040 });
    const layout = await page.evaluate(() => {
      const root = document.querySelector('.at-agent');
      const status = document.querySelector('[data-el="status"]');
      const tabs = document.querySelector('.agent-tabs');
      return {
        width: innerWidth,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        statusImmediatelyAfterTabs: tabs.nextElementSibling === status,
        statusRows: root.querySelectorAll('[role="status"], [role="alert"]').length,
        modelWidth: root.querySelector('[data-el="model"]').getBoundingClientRect().width,
      };
    });
    assert.equal(layout.noHorizontalOverflow, true, `Overflow at ${width}px`);
    assert.equal(layout.statusImmediatelyAfterTabs, true);
    assert.equal(layout.statusRows, 1);
    layouts.push(layout);
  }
  await page.setViewportSize({ width: 390, height: 1120 });
  await page.screenshot({ path: resolve(qa, 'agent-mobile.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1040 });
  await page.screenshot({ path: resolve(qa, 'agent-dark.png') });
  assert.equal(await page.locator('.status-light').evaluate(node => getComputedStyle(node).animationName), 'none');
  await page.getByRole('tab', { name: 'Agent', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Settings', exact: true }).getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');
  assert.equal(await page.getByRole('tab', { name: 'Agent', exact: true }).getAttribute('aria-selected'), 'true');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Preview sign in' }).waitFor();
  assert.equal(await page.locator('[data-el="result"]').isHidden(), true);
  assert.equal(await page.locator('[data-el="go"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  assert.equal(requests.some(url => /^https?:/.test(url)), false);
  assert.deepEqual(errors, []);
  const report = { passed: true, browser: await browser.version(), layouts,
    noExternalRequests: true, runtimeErrors: errors,
    features: ['preview sign-in/out', 'model/effort', 'Go', 'keyboard run', 'cancel', 'stale clearing',
      'literal output rendering', 'fixed/hidden fields', 'single status surface', 'keyboard tabs', 'dark appearance', 'reduced motion'] };
  await writeFile(resolve(qa, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
