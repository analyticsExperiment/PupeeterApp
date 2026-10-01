const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/playwright', `qa-reliability-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const BASE = 'http://127.0.0.1:3360';
const TARGET = 'http://127.0.0.1:4660';
const EXT = path.join(ROOT, 'extension/free-audit-recorder');
let app, target, browser, context, tempDir;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const html = `<!doctype html><html><body><h1>Recorder fixture</h1>
  <form id="form"><label>Name<input id="name"></label><label>Password<input id="password" type="password"></label>
  <label><input id="agree" type="checkbox">Agree</label><button id="submit">Submit</button></form>
  <a href="/next" id="next">Next page</a><div id="result"></div>
  <script>form.addEventListener('submit',e=>{e.preventDefault();result.textContent=document.getElementById('name').value;});</script>
  </body></html>`;

before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-audit-reliability-'));
  fs.mkdirSync(OUT, { recursive: true });
  target = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  await new Promise((resolve, reject) => { target.once('error', reject); target.listen(4660, '127.0.0.1', resolve); });
  app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3360', SESSION_SECRET: 'qa-reliability-local',
    FREE_AUDIT_DB_PATH: path.join(tempDir, 'audits.db') }, stdio: ['ignore', 'ignore', 'pipe'] });
  for (let n = 0; n < 80; n++) {
    if (await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)) break;
    if (app.exitCode !== null) throw new Error('QA server exited');
    await delay(250);
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  context = await browser.newContext();
  const response = await context.request.post(`${BASE}/auth/register`, { data: { username: `reliability_${Date.now()}`, password: 'LocalQaOnly123!', displayName: 'Reliability QA' } });
  assert.equal(response.status(), 201);
});
after(async () => {
  await browser?.close();
  if (app && app.exitCode === null) { const exited = new Promise(r => app.once('exit', r)); app.kill(); await exited; }
  if (target) { target.closeAllConnections(); await new Promise(r => target.close(r)); }
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  console.log(`Evidence: ${OUT}`);
});

async function recorderPage() {
  const page = await context.newPage();
  await page.goto(TARGET);
  for (const file of ['selectorGenerator.js', 'recorder.js']) await page.addScriptTag({ path: path.join(EXT, file) });
  await page.evaluate(() => window.FreeAuditRecorder.start());
  return page;
}

test('recorder retains final input when Stop follows immediately', async () => {
  const page = await recorderPage();
  try {
    const steps = await page.evaluate(() => {
      const input = document.querySelector('#name'); input.value = 'Final value';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return window.FreeAuditRecorder.stop().steps;
    });
    assert(steps.some(s => s.action === 'type' && s.value === 'Final value'));
  } finally { await page.close(); }
});

test('recorder preserves fill before submit and avoids duplicate submissions', async () => {
  const page = await recorderPage();
  try {
    const steps = await page.evaluate(() => {
      const input = document.querySelector('#name'); input.value = 'Before submit';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#submit').click();
      return window.FreeAuditRecorder.stop().steps;
    });
    const fill = steps.findIndex(s => s.action === 'type');
    const click = steps.findIndex(s => s.action === 'click');
    assert(fill > -1 && fill < click, 'Fill must precede submit click');
    assert.equal(steps.filter(s => s.action === 'pressKey').length, 0, 'Submit must not be recorded twice');
  } finally { await page.close(); }
});

test('recorder masks secrets and represents a checkbox once', async () => {
  const page = await recorderPage();
  try {
    await page.fill('#password', 'qa-secret-value');
    await page.check('#agree');
    const steps = await page.evaluate(() => window.FreeAuditRecorder.stop().steps);
    assert(!JSON.stringify(steps).includes('qa-secret-value'));
    assert(steps.some(s => s.value === '{{PASSWORD}}'));
    assert.equal(steps.filter(s => s.selector === '#agree').length, 1);
  } finally { await page.close(); }
});

test('cancelling Settings token creation saves no record', async () => {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/settings.html`);
    await page.waitForFunction(() => document.querySelector('#extensionTokenRows').textContent.includes('No extension'));
    const before = await (await context.request.get(`${BASE}/api/extension/tokens`)).json();
    page.once('dialog', d => d.dismiss());
    await page.click('#createExtensionToken');
    await delay(300);
    const after = await (await context.request.get(`${BASE}/api/extension/tokens`)).json();
    assert.equal(after.tokens.length, before.tokens.length);
  } finally { await page.close(); }
});

test('failed interaction status explains failed step while server is live', async () => {
  const saved = await context.request.post(`${BASE}/api/interaction-configs`, { data: {
    name: 'QA failed selector', startingUrl: TARGET, showBrowser: false,
    steps: [{ action: 'click', selector: '#missing', timeout: 200 }]
  } });
  assert.equal(saved.status(), 201);
  const config = (await saved.json()).config;
  const run = await (await context.request.post(`${BASE}/api/interaction-configs/${config.id}/run`, { data: {} })).json();
  let status;
  for (let n = 0; n < 100; n++) {
    status = await (await context.request.get(`${BASE}/api/interaction-runs/${run.id}/status`)).json();
    if (status.status === 'failed') break;
    await delay(250);
  }
  assert.equal(status.status, 'failed');
  assert(status.error && /step|selector/i.test(status.error));
});

test('Settings pairing token creation and revoke recover from an API error', async () => {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/settings.html`);
    await page.waitForFunction(() => document.querySelector('#extensionTokenRows').textContent.includes('No extension'));
    page.once('dialog', d => d.accept('QA token lifecycle'));
    await page.click('#createExtensionToken');
    await page.locator('.revoke-extension-token').waitFor();
    const token = await page.locator('#newExtensionToken code').innerText();
    assert((await context.request.get(`${BASE}/api/extension/status`, { headers: { Authorization: `Bearer ${token}` } })).ok());
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    assert.equal(await page.locator('.revoke-extension-token').evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    assert.equal(await page.locator('#extensionTokenRows .pill').first().evaluate(el => getComputedStyle(el).whiteSpace), 'nowrap');
    await page.screenshot({ path: path.join(OUT, 'mobile-settings-token.png'), fullPage: true, mask: [page.locator('#newExtensionToken code')] });
    await page.route('**/api/extension/tokens/*', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"QA temporary failure"}' }));
    const messages = [];
    const handleDialog = async d => { messages.push(d.message()); await d.accept(); };
    page.on('dialog', handleDialog);
    await page.click('.revoke-extension-token');
    await page.waitForFunction(() => !document.querySelector('.revoke-extension-token').disabled);
    assert(messages.includes('QA temporary failure'));
    await page.unroute('**/api/extension/tokens/*');
    await page.click('.revoke-extension-token');
    await page.waitForFunction(() => !document.querySelector('.revoke-extension-token'));
    assert(await page.locator('#newExtensionToken').isHidden());
    assert.equal((await context.request.get(`${BASE}/api/extension/status`, { headers: { Authorization: `Bearer ${token}` } })).status(), 401);
    page.off('dialog', handleDialog);
  } finally { await page.close(); }
});

test('Create Audit exposes the scratch form through a visible launcher link', async () => {
  const page = await context.newPage();
  try {
    await page.goto(BASE);
    await page.getByRole('link', { name: 'Start From Scratch', exact: true }).click();
    await page.waitForURL('**/?scratch=1');
    await page.locator('#auditForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#configPicker').inputValue(), '');
    await page.fill('#domain', TARGET);
    assert.equal(await page.locator('#domain').inputValue(), TARGET);
    await page.screenshot({ path: path.join(OUT, 'scratch-audit-entry.png'), fullPage: true });
  } finally { await page.close(); }
});

test('compact navigation opens, navigates and closes at mobile and tablet widths', async () => {
  const page = await context.newPage();
  try {
    for (const width of [390, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/dashboard.html`);
      const toggle = page.getByRole('button', { name: 'Toggle navigation' });
      await toggle.waitFor();
      assert((await page.locator('.app-sidebar').boundingBox()).height < 80);
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await page.getByRole('navigation').getByRole('link', { name: 'Interaction Runs', exact: true }).click();
      await page.waitForURL('**/interaction-runs.html');
      await toggle.click();
      assert.equal(await page.locator('.app-nav-link[aria-current="page"]').innerText(), 'Interaction Runs');
      await page.screenshot({ path: path.join(OUT, `${width}-navigation-open.png`), fullPage: true });
      await page.keyboard.press('Escape');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      await page.locator('h1').click();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.screenshot({ path: path.join(OUT, `${width}-navigation-closed.png`), fullPage: true });
    }
  } finally { await page.close(); }
});

test('Dashboard long config names leave Run and Edit readable and reachable', async () => {
  const saved = await context.request.post(`${BASE}/api/audit-configs`, { data: {
    name: `QA Long ${'x'.repeat(350)} <script>alert(1)</script>`, domain: TARGET, maxPages: 1
  } });
  assert.equal(saved.status(), 201);
  const page = await context.newPage();
  try {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/dashboard.html`);
      const card = page.locator('#configShortcuts .config-card').filter({ hasText: 'QA Long' });
      await card.waitFor();
      const controls = card.locator('button, a');
      await controls.first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${width}-long-config-buttons.png`), fullPage: false });
      const sizes = await controls.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent.trim(), width: rect.width, height: rect.height };
      }));
      assert.equal(sizes.length, 2);
      assert(sizes.every((size) => size.width >= 38 && size.height <= 44), JSON.stringify({ width, sizes }));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await card.getByRole('link', { name: 'Edit', exact: true }).click();
      await page.waitForURL('**/audit-configs.html?id=*');
    }
  } finally { await page.close(); }
});

test('installed extension survives navigation, popup reopen and isolates tabs', async () => {
  const extContext = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: process.env.QA_HEADED !== '1',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  try {
    const worker = extContext.serviceWorkers()[0] || await extContext.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const page = await extContext.newPage();
    await page.goto(TARGET);
    const command = async (type, url = TARGET) => {
      for (let n = 0; n < 30; n++) {
        const result = await worker.evaluate(async ({ type, url }) => {
          const tabs = await chrome.tabs.query({});
          const tab = tabs.find(t => t.url?.startsWith(url));
          try { return await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 }); }
          catch (_) { return null; }
        }, { type, url });
        if (result?.ok) return result.state;
        await delay(100);
      }
      throw new Error(`Extension command failed: ${type}`);
    };
    await command('FREE_AUDIT_START');
    await page.fill('#name', 'Across navigation');
    await page.click('#next');
    await page.waitForURL('**/next');
    await page.fill('#password', 'never-store-this');
    let state = await command('FREE_AUDIT_STOP');
    assert(state.steps.some(s => s.action === 'type' && s.value === 'Across navigation'));
    assert(state.steps.some(s => s.action === 'openUrl' && s.value.endsWith('/next')));
    assert(state.steps.some(s => s.value === '{{PASSWORD}}'));
    assert(!JSON.stringify(state).includes('never-store-this'));
    const other = await extContext.newPage();
    await other.goto('http://localhost:4660');
    assert.equal((await command('FREE_AUDIT_GET', 'http://localhost:4660')).steps.length, 0);
    await other.close();
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const token = await (await context.request.post(`${BASE}/api/extension/tokens`, { data: { label: 'Installed recorder QA' } })).json();
    await worker.evaluate(async ({ baseUrl, pairingToken, target }) => {
      await chrome.storage.local.set({ baseUrl, pairingToken, saveName: 'Installed extension journey' });
      const tabs = await chrome.tabs.query({});
      await chrome.tabs.update(tabs.find(t => t.url?.startsWith(target)).id, { active: true });
    }, { baseUrl: BASE, pairingToken: token.token, target: TARGET });
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Connected to Free Audit');
    await popup.waitForFunction(() => !document.querySelector('#saveConfig').disabled);
    assert.equal(await popup.locator('#stepPreview li').count(), state.steps.length);
    assert(!(await popup.locator('#stepPreview li').first().innerText()).startsWith('1.'), 'Ordered list must not number steps twice');
    await popup.locator('body').screenshot({ path: path.join(OUT, 'installed-extension-popup.png') });
    // Clicking a background popup page would make it the active tab; dispatch keeps the recorder target active.
    await popup.locator('#saveConfig').dispatchEvent('click');
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Interaction config saved');
    const saved = await (await context.request.get(`${BASE}/api/interaction-configs`)).json();
    const config = saved.configs.find(c => c.name === 'Installed extension journey');
    assert(config);
    const detail = await (await context.request.get(`${BASE}/api/interaction-configs/${config.id}`)).json();
    assert.equal(detail.config.startingUrl, `${TARGET}/`);
    assert.equal(detail.config.steps.length, state.steps.length);
    assert(!JSON.stringify(detail).includes('never-store-this'));
    await popup.close();
    assert.equal((await command('FREE_AUDIT_GET')).steps.length, state.steps.length);
    await command('FREE_AUDIT_START');
    await command('FREE_AUDIT_PAUSE');
    await page.reload();
    state = await command('FREE_AUDIT_GET');
    assert(state.paused && state.recording, 'Paused state must survive reload');
    await command('FREE_AUDIT_RESUME');
    await page.fill('#name', 'Resumed');
    assert((await command('FREE_AUDIT_STOP')).steps.some(s => s.value === 'Resumed'));
  } finally { await extContext.close(); }
});
