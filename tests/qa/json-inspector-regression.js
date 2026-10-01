const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/playwright', `qa-json-inspector-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const BASE = 'http://127.0.0.1:3370';
const layer = [
  { 'gtm.start': 1779130942638, event: 'gtm.js', 'gtm.uniqueEventId': 3 },
  { event: 'purchase', ecommerce: { transaction_id: 'ORDER-1024', currency: 'GBP', value: 149.95, items: [{ item_id: 'SKU-01', item_name: 'Headphones', quantity: 2, categories: ['Audio', 'Wireless'] }] }, consent: true, user: null },
  { event: 'consent', 0: 'consent', 1: 'update', 2: { analytics_storage: 'granted', ad_storage: 'denied' } },
  { event: 'edge', emptyString: '', emptyArray: [], emptyObject: {}, zero: 0, disabled: false, markup: '<img src=x onerror="window.qaInjected=1">', long: 'long-value/'.repeat(150), 'key.with.dots': 'preserved' }
];
const captured = { before: [], after: layer, added: [layer[1]] };
let app, browser, context;
const errors = [];

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3370', SESSION_SECRET: 'local-json-qa' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)) break;
    if (app.exitCode !== null) throw new Error('QA app exited');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const auth = await context.request.post(`${BASE}/auth/register`, { data: { username: `json_qa_${Date.now()}`, password: 'LocalJsonQA123!', displayName: 'JSON Inspector QA' } });
  assert.equal(auth.status(), 201);
  await context.route('**/api/audit/qa-json', route => route.fulfill({ json: { status: 'completed', domain: 'http://localhost/demo' } }));
  await context.route('**/api/audit/qa-json/results', route => route.fulfill({ json: { summary: {}, pages: [{ url: 'http://localhost/demo', title: 'Checkout', dataLayer: captured }] } }));
  await context.route('**/api/interaction-runs/qa-json/results', route => route.fulfill({ json: {
    status: 'completed', summary: { totalSteps: 1, passedSteps: 1 }, config: { name: 'Checkout journey', startingUrl: 'http://localhost/demo' },
    dataLayer: layer, steps: [{ stepNumber: 1, stepName: 'Purchase', action: 'click', status: 'passed', dataLayer: captured }]
  } }));
});
after(async () => {
  await browser?.close();
  if (app && app.exitCode === null) { const stopped = new Promise(resolve => app.once('exit', resolve)); app.kill(); await stopped; }
  console.log(`Screenshots: ${OUT}`);
});
async function report(interaction = false) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().startsWith(BASE) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${BASE}/${interaction ? 'interaction-report.html?id=qa-json' : '?auditId=qa-json'}`);
  await page.locator(interaction ? '[data-view="datalayer"]' : '.view-datalayer').click();
  await page.locator('json-inspector .ji-row').first().waitFor();
  return page;
}

test('audit: inline typed values, expandable hierarchy, search, raw/copy and empty snapshots', async () => {
  const page = await report();
  try {
    const inspector = page.locator('json-inspector');
    assert.match(await inspector.innerText(), /After \/ 4 entries/);
    const row = inspector.locator('.ji-leaf').filter({ hasText: 'gtm.start:' });
    const boxes = await row.evaluate(el => [...el.children].map(n => n.getBoundingClientRect().toJSON()));
    assert(Math.abs(boxes[0].y - boxes[1].y) < 2, 'Key and value must share a line');
    await inspector.locator('summary').filter({ hasText: 'purchase' }).click();
    await inspector.locator('summary').filter({ hasText: /^ecommerce:/ }).click();
    await inspector.locator('summary').filter({ hasText: /^items:/ }).click();
    await page.screenshot({ path: path.join(OUT, '01-audit-datalayer-expanded.png') });
    await inspector.getByRole('button', { name: 'Copy JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.evaluate(() => navigator.clipboard.readText())), layer);
    await inspector.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await inspector.locator('pre').innerText()), layer);
    await page.screenshot({ path: path.join(OUT, '02-audit-datalayer-raw.png') });
    await inspector.getByRole('button', { name: 'Tree', exact: true }).click();
    await inspector.getByRole('searchbox').fill('ORDER-1024');
    assert.match(await inspector.innerText(), /1 matching/);
    assert.equal(await inspector.locator('.ji-tree > details').count(), 1);
    await inspector.locator('summary').filter({ hasText: /^ecommerce:/ }).click();
    assert.match(await inspector.locator('mark').first().innerText(), /ORDER-1024/i);
    await page.screenshot({ path: path.join(OUT, '03-audit-datalayer-search.png') });
    await inspector.getByRole('searchbox').press('Escape');
    assert(await inspector.isVisible(), 'First Escape clears an active filter');
    await inspector.getByRole('button', { name: 'Before', exact: true }).click();
    assert.match(await inspector.innerText(), /No entries/);
    await page.screenshot({ path: path.join(OUT, '04-audit-datalayer-empty.png') });
    await page.keyboard.press('Escape');
    assert(await page.locator('#modal').evaluate(node => node.classList.contains('hidden')));
  } finally { await page.close(); }
});

test('untrusted strings, long values, null, false and empty structures retain their values', async () => {
  const page = await report();
  try {
    const inspector = page.locator('json-inspector');
    await inspector.getByRole('searchbox').fill('edge');
    // Filtering by an event should retain all of its properties when the filter is cleared.
    await inspector.getByRole('searchbox').fill('');
    await inspector.locator('summary').filter({ hasText: /^\[3\]:/ }).click();
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.equal(await page.evaluate(() => window.qaInjected), undefined);
    assert.match(await inspector.locator('.ji-boolean').last().innerText(), /false/);
    const long = inspector.locator('.ji-leaf').filter({ hasText: /^long:/ });
    assert((await long.innerText()).includes('long-value/'.repeat(150)));
    await inspector.locator('summary').filter({ hasText: /^emptyArray:/ }).click();
    assert.match(await inspector.innerText(), /Empty array/);
    await inspector.getByRole('button', { name: 'Collapse all' }).click();
    assert.equal(await inspector.locator('details[open]').count(), 0);
    await inspector.getByRole('button', { name: 'Expand one level' }).click();
    assert.equal(await inspector.locator('.ji-tree > details[open]').count(), 4);
    await page.screenshot({ path: path.join(OUT, '05-values-expanded.png') });
  } finally { await page.close(); }
});

test('desktop/tablet/mobile containment and buttons remain reachable', async () => {
  const page = await report();
  try {
    for (const width of [1440, 820, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const inspector = page.locator('json-inspector');
      await inspector.getByRole('searchbox').fill('');
      const bounds = await inspector.boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(overflow <= 2, `Document overflow at ${width}: ${overflow}`);
      await inspector.getByRole('button', { name: 'Copy JSON' }).click();
      await page.screenshot({ path: path.join(OUT, `06-${width}-datalayer.png`) });
    }
  } finally { await page.close(); }
});

test('interaction step and final snapshots use the same inspector', async () => {
  const page = await report(true);
  try {
    await page.locator('json-inspector').getByRole('button', { name: 'Added', exact: true }).click();
    assert.match(await page.locator('json-inspector').innerText(), /Added \/ 1 entries/);
    await page.screenshot({ path: path.join(OUT, '07-interaction-added.png') });
    await page.keyboard.press('Escape');
    assert(await page.locator('#interactionModal').evaluate(node => node.classList.contains('hidden')));
    await page.locator('[data-view-overall="datalayer"]').click();
    await page.locator('json-inspector').getByRole('button', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('json-inspector pre').innerText()), layer);
    await page.screenshot({ path: path.join(OUT, '08-interaction-final.png') });
  } finally { await page.close(); }
});

test('large arrays are batched and a rebuilt modal does not duplicate controls', async () => {
  const page = await report();
  try {
    await page.evaluate(() => {
      const values = Array.from({ length: 2000 }, (_, i) => ({ event: `event_${i}`, index: i }));
      document.getElementById('modalBody').innerHTML = window.FreeAuditJson.render(values, { label: 'dataLayer' });
    });
    assert.equal(await page.locator('.ji-tree > details').count(), 100);
    await page.getByRole('button', { name: /Show next 100/ }).click();
    assert.equal(await page.locator('.ji-tree > details').count(), 200);
    await page.getByRole('searchbox').fill('event_1999');
    assert.match(await page.locator('.ji-tree').innerText(), /event_1999/);
    await page.evaluate(() => { const body = document.getElementById('modalBody'); body.innerHTML = body.innerHTML; });
    assert.equal(await page.locator('.ji-toolbar').count(), 1);
    await page.screenshot({ path: path.join(OUT, '09-large-snapshot.png') });
  } finally { await page.close(); }
});

test('On Page wording is visible while legacy route and type stay compatible', async () => {
  const page = await context.newPage();
  try {
    for (const url of ['/action-templates.html?type=post', '/audit-configs.html?new=1', '/?scratch=1']) {
      await page.goto(BASE + url);
      await page.locator('.app-nav-link', { hasText: 'On Page Actions' }).waitFor();
      assert(!/Post-Audit|Post Audit|On-Page/i.test(await page.locator('body').innerText()));
    }
    await page.goto(`${BASE}/action-templates.html?type=post`);
    await page.getByRole('heading', { name: 'On Page Action Templates', exact: true }).waitFor();
    await page.screenshot({ path: path.join(OUT, '10-on-page-library.png') });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('report error text is not interpreted as markup and inspector copy recovers from denial', async () => {
  const page = await report();
  try {
    await page.evaluate(() => {
      const error = renderPage({ url: 'http://localhost/demo', onPageError: '<img src=x onerror="window.qaInjected=1">' });
      const host = document.createElement('div'); host.id = 'qa-error'; host.innerHTML = error; document.body.append(host);
      Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('Denied'); }, configurable: true });
    });
    assert.equal(await page.locator('#qa-error img').count(), 0);
    assert.match(await page.locator('#qa-error').innerText(), /On Page Action Error/);
    await page.getByRole('button', { name: 'Copy JSON', exact: true }).click();
    assert.match(await page.locator('.ji-status').innerText(), /Clipboard unavailable/);
    assert.deepEqual(JSON.parse(await page.locator('.ji-raw').innerText()), layer);
  } finally { await page.close(); }
});
