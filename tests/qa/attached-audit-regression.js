const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium, request } = require('playwright');

const root = path.resolve(__dirname, '../..');
const extension = path.join(root, 'extension/free-audit-recorder');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'free-audit-attached-'));
  const target = http.createServer((req, res) => {
    const targetOrigin = `http://127.0.0.1:${target.address().port}`;
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`User-agent: *\nSitemap: ${targetOrigin}/sitemap.xml\n`);
      return;
    }
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<?xml version="1.0"?><urlset><url><loc>${targetOrigin}/auto-sitemap</loc></url></urlset>`);
      return;
    }
    if (req.url === '/auto-home' || req.url === '/auto-linked' || req.url === '/auto-sitemap'
      || req.url === '/short-home' || req.url === '/short-linked'
      || req.url === '/late-home' || req.url === '/late-linked') {
      const nextLink = req.url === '/auto-home' ? '<a href="/auto-linked">Linked page</a>'
        : req.url === '/short-home' ? '<a href="/short-linked">Linked page</a>' : '';
      const lateLink = req.url === '/late-home'
        ? '<script>setTimeout(() => { document.body.insertAdjacentHTML("beforeend", "<a href=\\"/late-linked\\">Late link</a>"); }, 450)</script>' : '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><title>${req.url}</title>${nextLink}${lateLink}`);
      return;
    }
    const denied = req.url === '/denied';
    res.writeHead(denied ? 403 : 200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'fixture_session=test; Path=/; HttpOnly'
    });
    res.end(`<!doctype html><title>${denied ? 'Access Denied' : 'Fixture Home'}</title>
      <a href="/denied">Next</a><script>window.dataLayer=[{event:'fixtureLoaded'}];fetch('/beacon').catch(()=>{});</script>`);
  });
  let app, browser, api;
  try {
    await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
    const targetUrl = `http://127.0.0.1:${target.address().port}`;
    const baseUrl = `http://127.0.0.1:${await freePort()}`;
    app = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: new URL(baseUrl).port, SESSION_SECRET: 'attached-audit-regression',
        FREE_AUDIT_DB_PATH: path.join(tempDir, 'audits.db') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stderr = '';
    app.stderr.on('data', (chunk) => { stderr += chunk; });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await fetch(`${baseUrl}/api/health`).then((response) => response.ok).catch(() => false)) break;
      if (app.exitCode !== null) throw new Error(`App exited: ${stderr}`);
      await delay(200);
    }
    api = await request.newContext({ baseURL: baseUrl });
    const username = `attached_${Date.now()}`;
    let response = await api.post('/auth/register', { data: {
      username, password: 'LocalOnly123!', displayName: 'Attached QA'
    } });
    assert.equal(response.status(), 201, await response.text());
    response = await api.post('/api/audit-configs', { data: {
      name: 'Attached QA config', domain: targetUrl, maxPages: 2, includeSitemaps: true,
      options: { rules: [{ id: 'title-rule', name: 'Expected title',
        assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'Fixture' }] }] }
    } });
    assert.equal(response.status(), 201, await response.text());
    const configId = (await response.json()).config.id;
    response = await api.post('/api/audit-configs', { data: {
      name: 'Different site default', domain: 'https://other-site.invalid', maxPages: 5, isDefault: true
    } });
    assert.equal(response.status(), 201);
    browser = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await worker.evaluate(async (baseUrl) => {
      await chrome.storage.local.set({ baseUrl });
    }, baseUrl);
    await popup.reload();
    const [appPage] = await Promise.all([
      browser.waitForEvent('page'),
      popup.locator('#connectAccount').click()
    ]);
    await appPage.waitForURL('**/login');
    await appPage.locator('#username').fill(username);
    await appPage.locator('#password').fill('LocalOnly123!');
    await appPage.locator('#loginForm button[type="submit"]').click();
    await appPage.waitForURL(baseUrl + '/');
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Connected to Free Audit');
    const token = await worker.evaluate(async () => (await chrome.storage.local.get('pairingToken')).pairingToken);
    assert(token?.startsWith('fat_'), 'App login must pair the extension automatically');
    response = await api.get('/api/extension/tokens');
    assert.equal((await response.json()).tokens.length, 1, 'App login should issue one extension token');
    const page = await browser.newPage();
    await page.goto(targetUrl);
    await page.bringToFront();
    await popup.reload();
    await popup.waitForFunction((id) => document.querySelector('#attachedConfig').value === id, configId);
    const command = async (type, extra = {}) => popup.evaluate(async ({ type, targetUrl, extra }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl));
      return chrome.runtime.sendMessage({ type, tabId: tab.id, ...extra });
    }, { type, targetUrl, extra });
    const started = await command('ATTACHED_AUDIT_START', { baseUrl, configId });
    assert(started.ok, started.error);
    await page.waitForLoadState('load');
    await delay(500);
    await page.goto(`${targetUrl}/denied`);
    await delay(500);
    await page.goto(`${targetUrl}/third`);
    await delay(500);
    const stopped = await command('ATTACHED_AUDIT_STOP');
    assert(stopped.ok, stopped.error);
    assert.equal(stopped.finished.pageCount, 2);
    const id = stopped.finished.id;
    response = await api.get(`/api/audit/${id}/results`);
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    assert.equal(result.captureMode, 'attached-chrome');
    assert.equal(result.summary.total, 2);
    assert.equal(result.pages[0].title, 'Fixture Home');
    assert.equal(result.pages[1].finalStatusCode, 403);
    assert.equal(result.pages[1].title, 'Access Denied');
    assert.equal(result.summary.rulePasses, 1);
    assert.equal(result.summary.ruleFailures, 1);
    assert(result.pages[0].networkRequests.some((entry) => entry.url.endsWith('/beacon')));
    assert(result.pages[0].cookies.some((cookie) => cookie.name === 'fixture_session'));
    assert(!result.pages.some((item) => item.url.endsWith('/third')));
    const recorder = await popup.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((item) => item.url?.startsWith(targetUrl));
      const started = await chrome.tabs.sendMessage(tab.id, { type: 'FREE_AUDIT_START' }, { frameId: 0 });
      const stopped = await chrome.tabs.sendMessage(tab.id, { type: 'FREE_AUDIT_STOP' }, { frameId: 0 });
      return { started, stopped };
    }, targetUrl);
    assert(recorder.started.ok && recorder.stopped.ok, 'Existing journey recorder must still work');
    await popup.reload();
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Connected to Free Audit');
    await popup.waitForFunction((id) => document.querySelector('#attachedConfig').value === id, configId);
    assert.equal(await popup.locator('#attachedConfig').inputValue(), configId);
    await popup.waitForFunction((expected) => document.querySelector('#attachedReport').href === expected,
      stopped.reportUrl);
    assert.equal(await popup.locator('#attachedReport').getAttribute('href'), stopped.reportUrl);
    response = await api.post('/api/audit-configs', { data: {
      name: 'Newly created config', domain: targetUrl, maxPages: 3
    } });
    assert.equal(response.status(), 201);
    await popup.waitForFunction(() => Array.from(document.querySelectorAll('#attachedConfig option'))
      .some((option) => option.textContent.includes('Newly created config')), null, { timeout: 12000 });
    response = await api.post(`/api/audits/${id}/rerun`);
    assert.equal(response.status(), 409);
    const wrongToken = await fetch(`${baseUrl}/api/extension/attached-audits/${id}`, {
      headers: { Authorization: 'Bearer wrong' }
    });
    assert.equal(wrongToken.status, 401);
    await popup.locator('#disconnectAccount').click();
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Not paired');
    const revoked = await fetch(`${baseUrl}/api/extension/status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(revoked.status, 401);
    await popup.locator('#connectAccount').click();
    await popup.waitForFunction(() => document.querySelector('#connectionStatus').textContent === 'Connected to Free Audit');
    const waitForAudit = async (runId) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const statusResponse = await api.get(`/api/audit/${runId}/status`);
        if (statusResponse.ok() && (await statusResponse.json()).status === 'completed') {
          const resultsResponse = await api.get(`/api/audit/${runId}/results`);
          assert.equal(resultsResponse.status(), 200, await resultsResponse.text());
          return resultsResponse.json();
        }
        await delay(250);
      }
      throw new Error(`Attached automatic audit ${runId} did not complete`);
    };
    const runAutomatic = async ({ path, maxPages, includeSitemaps }) => {
      const configResponse = await api.post('/api/audit-configs', { data: {
        name: `Automatic ${path}`, domain: `${targetUrl}${path}`, maxPages, includeSitemaps
      } });
      assert.equal(configResponse.status(), 201, await configResponse.text());
      const autoConfigId = (await configResponse.json()).config.id;
      await page.goto(`${targetUrl}${path}`);
      const startResponse = await command('ATTACHED_AUDIT_START', {
        baseUrl, configId: autoConfigId, autoCrawl: true
      });
      assert(startResponse.ok, startResponse.error);
      return waitForAudit(startResponse.state.id);
    };
    const autoResult = await runAutomatic({ path: '/auto-home', maxPages: 3, includeSitemaps: true });
    assert.equal(autoResult.pages.length, 3, 'automatic mode should reach the configured page target');
    assert.deepEqual(new Set(autoResult.pages.map((item) => new URL(item.url).pathname)),
      new Set(['/auto-home', '/auto-linked', '/auto-sitemap']));
    assert.equal(autoResult.summary.pageTarget, 3);
    assert.equal(autoResult.summary.targetMet, true);
    assert.equal(autoResult.summary.crawlStopReason, 'target-reached');
    const shortResult = await runAutomatic({ path: '/short-home', maxPages: 3, includeSitemaps: false });
    assert.equal(shortResult.pages.length, 2, 'automatic mode should stop when all discoverable pages are exhausted');
    assert.equal(shortResult.summary.targetMet, false);
    assert.equal(shortResult.summary.crawlStopReason, 'no-more-discoverable-pages');
    const lateResult = await runAutomatic({ path: '/late-home', maxPages: 2, includeSitemaps: false });
    assert.equal(lateResult.pages.length, 2, 'automatic mode should discover links added after load');
    assert.equal(lateResult.summary.crawlStopReason, 'target-reached');
    const deniedResult = await runAutomatic({ path: '/denied', maxPages: 3, includeSitemaps: false });
    assert.equal(deniedResult.pages.length, 1);
    assert.equal(deniedResult.pages[0].finalStatusCode, 403);
    assert.equal(deniedResult.summary.crawlStopReason, 'site-denied-access');
    console.log(`Attached audit verified: ${id}, manual capture, automatic target and shortfall, session login/reconnect, live configs, 403, rules, cookies, network, cap, disconnect`);
  } finally {
    await browser?.close();
    await api?.dispose();
    if (app && app.exitCode === null) {
      const exited = new Promise((resolve) => app.once('exit', resolve));
      app.kill();
      await exited;
    }
    target.closeAllConnections();
    if (target.listening) await new Promise((resolve) => target.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
