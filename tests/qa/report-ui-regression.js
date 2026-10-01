const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/playwright', `qa-reports-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const BASE = 'http://127.0.0.1:3380';
const payload = { domain: 'http://localhost/shop', maxPages: 2, postAuditActions: [{ type: 'click', selector: '#consent' }], rules: [{ name: 'Purchase event', enabled: true }] };
const summary = { total: 2, pagesWithDetectedRequests: 1, detectedRequests: 1, networkRequests: 12, errors: 0, consoleMessages: 3, ruleFailures: 1 };
const audits = [
  { id: 'qa-a', configName: 'Checkout analytics', domain: 'http://localhost/shop', status: 'completed', startedAt: new Date('2026-09-09T10:00:00').getTime(), summary },
  { id: 'qa-b', configName: 'Consent checks', domain: 'http://localhost/consent', status: 'failed', startedAt: new Date('2026-09-08T10:00:00').getTime(), summary: { ...summary, ruleFailures: 0 } },
  { id: 'qa-c', configName: 'Mobile analytics', domain: 'http://localhost/mobile', status: 'running', startedAt: new Date('2026-09-07T10:00:00').getTime(), summary: {} }
].map(audit => ({ ...audit, completedAt: audit.status === 'running' ? null : audit.startedAt + 15000, payload, configSnapshot: { name: audit.configName, config: payload } }));
const network = [{ id: 1, url: 'http://localhost/collect?event=purchase', method: 'POST', status: 200, resourceType: 'fetch', requestHeaders: { 'content-type': 'application/json' }, postData: '{"event":"purchase","value":149.95}' }];
const layer = [{ event: 'purchase', ecommerce: { value: 149.95, currency: 'GBP' } }];
const pageResult = { url: 'http://localhost/shop', title: 'Checkout', linksFound: 3, networkRequests: network, dataLayer: { before: [], after: layer }, cookies: [{ name: 'consent', value: 'granted' }], console: [{ type: 'log', text: 'purchase sent' }], ruleResults: [] };
const step = (number, status = 'passed') => ({ stepNumber: number, stepName: ['Open checkout', 'Accept consent', 'Complete purchase'][number - 1], action: 'click', status, durationMs: 1100, urlBefore: pageResult.url, urlAfter: pageResult.url, networkRequests: network, dataLayer: { before: [], after: layer }, ruleResults: [] });
const interaction = { status: 'failed', startedAt: audits[0].startedAt, durationMs: 3300, summary: { totalSteps: 3, passedSteps: 3, failedRules: 1 }, config: { name: 'Checkout journey', startingUrl: pageResult.url }, steps: [step(1), step(2), { ...step(3), ruleResults: [{ name: 'Purchase value', status: 'failed', message: 'Expected value 199.95' }] }] };
let app, browser, context;
const errors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

before(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  assert.equal(await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false), false, 'QA port must be free');
  app = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: '3380', SESSION_SECRET: 'local-report-qa' }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    if (await fetch(`${BASE}/api/health`).then(r => r.ok).catch(() => false)) break;
    assert.equal(app.exitCode, null, 'QA server exited');
    await sleep(250);
  }
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const auth = await context.request.post(`${BASE}/auth/register`, { data: { username: `report_qa_${Date.now()}`, password: 'LocalReportQA123!', displayName: 'Report QA' } });
  assert.equal(auth.status(), 201);
  await context.route('**/api/audit/qa-a', route => route.fulfill({ json: audits[0] }));
  await context.route('**/api/audit/qa-a/results', route => route.fulfill({ json: { summary, requestHeaders: { userAgent: 'Chromium QA' }, pages: [pageResult] } }));
  await context.route('**/api/interaction-runs/qa-a/results', route => route.fulfill({ json: interaction }));
  await context.route('**/api/audits?limit=200', route => route.fulfill({ json: { audits } }));
  await context.route(/\/api\/audits\/qa-[abc]$/, route => route.fulfill({ json: audits.find(audit => route.request().url().endsWith(audit.id)) }));
});
after(async () => {
  await browser?.close();
  if (app && app.exitCode === null) { const stopped = new Promise(resolve => app.once('exit', resolve)); app.kill(); await stopped; }
  console.log(`Screenshots: ${OUT}`);
});
async function open(url) {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.url().startsWith(BASE) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  page.on('requestfailed', request => { if (request.url().startsWith(BASE) && !/ERR_ABORTED/.test(request.failure()?.errorText || '')) errors.push(request.failure()?.errorText); });
  await page.goto(BASE + url);
  return page;
}
async function capture(page, name) { await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false }); }
async function waitDetail(page, name) { await page.getByRole('heading', { name, exact: true }).waitFor(); }
async function contained(page, width) {
  assert((await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 2, `Page overflow at ${width}`);
}

test('audit identity, collapsed metadata and all six keyboard-operated drilldowns', async () => {
  const page = await open('/?auditId=qa-a');
  try {
    await waitDetail(page, 'Checkout analytics');
    assert.equal(await page.locator('#consoleHeading').innerText(), 'Audit Report');
    assert.equal(await page.locator('.app-nav-link.active').innerText(), 'Audit History');
    assert.equal(await page.locator('.report-metadata').getAttribute('open'), null);
    assert.match(await page.locator('.report-identity').innerText(), /Run qa-a/);
    assert.match(await page.locator('#downloadJson').getAttribute('href'), /qa-a\/json$/);
    assert.match(await page.locator('#downloadCsv').getAttribute('href'), /qa-a\/csv$/);
    await capture(page, '01-audit-report');
    for (const selector of ['.view-tools', '.view-datalayer', '.view-cookies', '.view-console', '.view-network', '.view-rules']) {
      const trigger = page.locator(selector);
      assert.equal(await trigger.evaluate(node => node.tagName), 'BUTTON');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await page.locator('#modal:not(.hidden)').waitFor();
      assert.equal(await page.locator('#modal').getAttribute('aria-modal'), 'true');
      assert(await page.locator('#modalClose').evaluate(node => node === document.activeElement));
      await page.keyboard.press('Escape');
      assert(await trigger.evaluate(node => node === document.activeElement));
    }
    await page.getByText('Request Information', { exact: true }).click();
    await page.locator('#viewRequestHeaders').click();
    await capture(page, '02-audit-request-headers');
    await page.keyboard.press('Escape');
    assert(await page.locator('#viewRequestHeaders').evaluate(node => node === document.activeElement));
  } finally { await page.close(); }
});

test('nested network details retain dialog focus and return to the original tile', async () => {
  const page = await open('/?auditId=qa-a');
  try {
    await page.locator('.view-network').click();
    await page.locator('.view-network-request').click();
    await capture(page, '03-nested-network-details');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press(i < 7 ? 'Tab' : 'Shift+Tab');
      assert(await page.locator('#modal').evaluate(node => node.contains(document.activeElement)));
    }
    await page.locator('#modalBack').click();
    assert.match(await page.locator('#modalTitle').innerText(), /Network Requests/);
    await page.keyboard.press('Escape');
    assert(await page.locator('.view-network').evaluate(node => node === document.activeElement));
  } finally { await page.close(); }
});

test('interaction distinguishes successful execution from failed rules and opens failed evidence', async () => {
  const page = await open('/interaction-report.html?id=qa-a');
  try {
    await page.locator('#executionOutcome').waitFor();
    assert.equal(await page.locator('#executionOutcome').innerText(), 'Passed');
    assert.equal(await page.locator('#validationOutcome').innerText(), 'Failed');
    const cards = page.locator('.step-result-card');
    assert.equal(await cards.nth(1).locator('[data-toggle-step-result]').getAttribute('aria-expanded'), 'false');
    assert.equal(await cards.nth(2).locator('[data-toggle-step-result]').getAttribute('aria-expanded'), 'true');
    await capture(page, '04-interaction-outcomes');
    await cards.nth(1).locator('[data-toggle-step-result]').click();
    await cards.nth(1).locator('[data-view="datalayer"]').click();
    await page.locator('json-inspector').waitFor();
    await capture(page, '05-interaction-datalayer');
    await page.keyboard.press('Escape');
    assert(await cards.nth(1).locator('[data-view="datalayer"]').evaluate(node => node === document.activeElement));
  } finally { await page.close(); }
});

test('incomplete, empty, skipped, failed and missing-summary evidence is never falsely successful', async () => {
  for (const [data, expectedExecution, expectedValidation] of [
    [{ steps: [], summary: { totalSteps: 3 } }, 'Incomplete', 'Not evaluated'],
    [{ steps: [], summary: {} }, 'Not run', 'Not evaluated'],
    [{ steps: [step(1, 'skipped')], summary: {} }, 'Skipped', 'Not evaluated'],
    [{ steps: [step(1, 'failed')], summary: {} }, 'Failed', 'Not evaluated'],
    [{ steps: [step(1)], summary: {}, error: 'Browser disconnected' }, 'Failed', 'Not evaluated'],
    [{ steps: [{ ...step(1), ruleResults: [{ status: 'not_applied' }] }], summary: {} }, 'Passed', 'Not applied'],
    [{ steps: [{ ...step(1), ruleResults: [{ status: 'failed' }] }], summary: {} }, 'Passed', 'Failed']
  ]) {
    const page = await context.newPage();
    try {
      await page.route('**/api/interaction-runs/qa-a/results', route => route.fulfill({ json: { ...interaction, ...data } }));
      await page.goto(`${BASE}/interaction-report.html?id=qa-a`);
      await page.locator('#executionOutcome').waitFor();
      assert.equal(await page.locator('#executionOutcome').innerText(), expectedExecution);
      assert.equal(await page.locator('#validationOutcome').innerText(), expectedValidation);
    } finally { await page.close(); }
  }
});

test('history search, status, inclusive dates, failed rules, reset and empty results', async () => {
  const page = await open('/audits.html');
  try {
    await waitDetail(page, audits[0].configName);
    assert.match(await page.locator('#historyCount').innerText(), /3 of 3 recent audits \(latest 200\)/);
    await capture(page, '06-history');
    await page.locator('#historySearch').fill('CONSENT');
    await waitDetail(page, audits[1].configName);
    assert.equal(await page.locator('#auditRows tr[data-id]').count(), 1);
    await page.locator('#historySearch').fill('');
    await page.locator('#historyStatus').selectOption('running');
    await waitDetail(page, audits[2].configName);
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.locator('#historyFrom').fill('2026-09-08');
    await page.locator('#historyTo').fill('2026-09-08');
    await waitDetail(page, audits[1].configName);
    assert.equal(await page.locator('#auditRows tr[data-id]').count(), 1);
    await page.locator('#historyFrom').fill('2026-09-09');
    assert.match(await page.locator('#historyCount').innerText(), /From date must be/);
    assert.equal(await page.locator('#auditRows tr[data-id]').count(), 0);
    await capture(page, '07-history-invalid-range');
    await page.getByRole('button', { name: 'Reset filters' }).click();
    await page.locator('#historyFailed').check();
    await waitDetail(page, audits[0].configName);
    assert.equal(await page.locator('#auditRows tr[data-id]').count(), 1);
    await page.locator('#historySearch').fill('no-matching-domain');
    assert.match(await page.locator('#auditRows').innerText(), /No audits match/);
    assert.match(await page.locator('#auditDetail').innerText(), /No audits match/);
  } finally { await page.close(); }
});

test('history configuration and saved snapshot preserve structured values', async () => {
  const page = await open('/audits.html');
  try {
    await waitDetail(page, audits[0].configName);
    await page.getByText('Audit Configuration', { exact: true }).click();
    const inspector = page.locator('#auditDetail json-inspector').first();
    await inspector.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await inspector.locator('pre').innerText()), payload);
    await page.getByText('Saved Config Snapshot', { exact: true }).click();
    await page.locator('#auditDetail json-inspector').nth(1).getByRole('button', { name: 'JSON', exact: true }).click();
    assert.deepEqual(JSON.parse(await page.locator('#auditDetail json-inspector').nth(1).locator('pre').innerText()), audits[0].configSnapshot);
    await page.locator('#auditDetail').scrollIntoViewIfNeeded();
    await capture(page, '08-history-configuration');
  } finally { await page.close(); }
});

test('a slow previous detail response cannot overwrite the newly selected run', async () => {
  const page = await context.newPage();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requested;
  const ready = new Promise(resolve => { requested = resolve; });
  try {
    await page.route('**/api/audits/qa-a', async route => { requested(); await gate; await route.fulfill({ json: audits[0] }); });
    await page.goto(`${BASE}/audits.html`);
    await ready;
    await capture(page, '09-history-loading');
    await page.locator('tr[data-id="qa-b"] .audit-details').click();
    await waitDetail(page, audits[1].configName);
    const response = page.waitForResponse('**/api/audits/qa-a');
    release();
    await response;
    await sleep(100);
    assert.equal(await page.locator('#auditDetail h2').innerText(), audits[1].configName);
    assert.equal(await page.locator('#auditRows tr.selected').getAttribute('data-id'), 'qa-b');
  } finally { release(); await page.close(); }
});

test('long text and responsive report/history layouts stay contained with no unexpected browser errors', async () => {
  for (const url of ['/?auditId=qa-a', '/interaction-report.html?id=qa-a', '/audits.html']) {
    const page = await open(url);
    try {
      await page.locator(url === '/audits.html' ? '.history-detail-heading' : url.startsWith('/?') ? '.report-identity' : '#executionOutcome').waitFor();
      for (const width of [1440, 820, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await contained(page, width);
        if (url === '/audits.html') {
          const geometry = await page.locator('#historyStatus').evaluate(node => {
            const style = getComputedStyle(node);
            const canvas = document.createElement('canvas').getContext('2d');
            canvas.font = `${style.fontSize} ${style.fontFamily}`;
            const text = canvas.measureText(node.selectedOptions[0].textContent);
            return { height: node.clientHeight, padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom), text: text.fontBoundingBoxAscent + text.fontBoundingBoxDescent };
          });
          assert(geometry.height - geometry.padding >= geometry.text, `Status value must fit vertically: ${JSON.stringify(geometry)} at ${width}`);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await capture(page, `10-${url === '/audits.html' ? 'history' : url.startsWith('/?') ? 'audit' : 'interaction'}-${width}`);
      }
      if (url.startsWith('/?')) {
        await page.evaluate(() => renderResults({ summary: {}, pages: [{ url: 'http://localhost/' + 'long'.repeat(150), title: '<img src=x onerror="window.qaInjected=1">', error: '<script>bad()</script>' }] }, 'qa-a'));
        assert.equal(await page.locator('#results img').count(), 0);
        assert.equal(await page.evaluate(() => window.qaInjected), undefined);
        await capture(page, '11-audit-long-text');
        await contained(page, 390);
      }
    } finally { await page.close(); }
  }
  assert.deepEqual(errors, []);
});
