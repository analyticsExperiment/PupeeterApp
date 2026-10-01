const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_OPEN_APP_PORT || 3320);
const TARGET_PORT = Number(process.env.QA_OPEN_TARGET_PORT || 4620);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', `qa-open-states-${RUN_ID}`);
const HEADLESS = process.env.QA_HEADED === '1' ? false : true;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const checks = [];
const issues = [];
const screenshots = [];
const created = {
  user: null,
  preTemplateId: null,
  postTemplateId: null,
  ruleSetId: null,
  flowTemplateId: null,
  auditConfigId: null,
  auditId: null,
  interactionConfigId: null,
  interactionRunId: null
};

function slug(value) {
  return String(value || 'screenshot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

function recordCheck(area, name, status, details = '') {
  checks.push({ area, name, status, details });
}

function addIssue(issue) {
  const id = issue.id || `OS-${String(issues.length + 1).padStart(3, '0')}`;
  if (issues.some((item) => item.id === id)) return;
  issues.push({
    id,
    severity: issue.severity || 'medium',
    page: issue.page || '',
    feature: issue.feature || '',
    control: issue.control || '',
    steps: issue.steps || '',
    expected: issue.expected || '',
    actual: issue.actual || '',
    screenshot: issue.screenshot || '',
    consoleOrNetwork: issue.consoleOrNetwork || '',
    rootCause: issue.rootCause || '',
    filesChanged: issue.filesChanged || '',
    fixApplied: issue.fixApplied || 'Not fixed in this run',
    retest: issue.retest || 'Pending'
  });
}

function check(area, name, condition, issue) {
  if (condition) {
    recordCheck(area, name, 'PASS');
    return true;
  }
  recordCheck(area, name, 'FAIL', issue.actual || issue.expected || '');
  addIssue(issue);
  return false;
}

async function screenshot(page, name, options = {}) {
  const requiredNames = new Set([
    'rules-vendor-picker-open',
    'rules-vendor-picker-search-adobe',
    'rules-expect-tag-picker-open',
    'mobile-rules-vendor-picker-open',
    'audit-config-template-picker-open',
    'pre-action-type-dropdown-open',
    'post-action-type-dropdown-open',
    'interaction-step-type-dropdown-open',
    'interaction-template-picker-open',
    'report-network-modal-open',
    'report-request-detail-open',
    'report-datalayer-modal-open',
    'report-rules-modal-open',
    'report-console-modal-open',
    'mobile-interaction-step-dropdown-open'
  ]);
  const prefix = requiredNames.has(name) ? '' : `${String(screenshots.length + 1).padStart(2, '0')}-`;
  const file = path.join(OUTPUT_DIR, `${prefix}${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? !/(?:open|search-adobe)$/.test(name) });
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  screenshots.push(relative);
  return relative;
}

function qaPage({ title, body, script = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.4; margin: 24px; }
    iframe { width: 420px; max-width: 100%; height: 130px; border: 1px solid #bbb; }
    #deepSection { margin-top: 820px; padding: 20px; background: #f4f4f4; }
  </style></head><body>${body}<script>${script}</script></body></html>`;
}

function startTargetServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, TARGET_URL);
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...headers });
      res.end(body);
    };
    if (url.pathname === '/favicon.ico') return send(204, 'text/plain', '');
    if (url.pathname === '/robots.txt') return send(200, 'text/plain', `User-agent: *\nAllow: /\nSitemap: ${TARGET_URL}/sitemap.xml\n`);
    if (url.pathname === '/sitemap.xml') {
      return send(200, 'application/xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${TARGET_URL}/</loc></url><url><loc>${TARGET_URL}/page-2</loc></url></urlset>`);
    }
    if (url.pathname === '/api/local-pixel') return send(200, 'application/json', JSON.stringify({ ok: true, event: url.searchParams.get('event') || '' }));
    if (url.pathname === '/collect') return send(204, 'text/plain', '');
    if (url.pathname === '/iframe') {
      return send(200, 'text/html', qaPage({
        title: 'QA Frame',
        body: '<button id="iframeButton">Frame Action</button><div id="frameResult">Frame idle</div>',
        script: `
          document.getElementById('iframeButton').addEventListener('click', () => {
            console.log('qa iframe clicked');
            document.getElementById('frameResult').textContent = 'Frame clicked';
            parent.postMessage('qa-frame-clicked','*');
          });
        `
      }));
    }
    if (url.pathname === '/page-2') {
      return send(200, 'text/html', qaPage({
        title: 'QA Target Page Two',
        body: '<h1>QA Target Page Two</h1><p id="pageTwoMarker">Second page marker</p><a href="/">Home</a>',
        script: `
          document.cookie = 'qa_page_two=1; path=/';
          window.dataLayer = window.dataLayer || [];
          window.dataLayer.push({ event: 'qa_page_two_view', pageType: 'detail' });
          console.warn('qa target warning page two');
          fetch('/api/local-pixel?event=page_two');
        `
      }));
    }
    return send(200, 'text/html', qaPage({
      title: 'QA Target Home',
      body: `
        <h1>QA Target Home</h1>
        <button id="acceptCookies">Accept Cookies</button>
        <a id="pageTwoLink" href="/page-2">Page Two</a>
        <form id="qaForm">
          <label>Name <input id="qaName" name="name" /></label>
          <label>Choice <select id="qaChoice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
          <label><input id="qaAgree" type="checkbox" /> Agree</label>
          <button id="submitForm" type="submit">Submit</button>
        </form>
        <div id="result">Waiting</div>
        <iframe id="qaFrame" src="/iframe"></iframe>
        <section id="deepSection">Deep content for scroll validation</section>
      `,
      script: `
        document.cookie = 'qa_session=abc123; path=/';
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'qa_page_view', pageType: 'home' });
        console.info('qa target home loaded');
        fetch('/api/local-pixel?event=home_fetch');
        new Image().src = 'https://www.google-analytics.com/collect?v=1&t=pageview&tid=UA-OPEN-1&cid=open';
        document.getElementById('acceptCookies').addEventListener('click', () => {
          document.cookie = 'qa_consent=yes; path=/';
          window.dataLayer.push({ event: 'qa_cookie_accept' });
          console.log('qa accept clicked');
          document.getElementById('acceptCookies').style.display = 'none';
        });
        document.getElementById('qaForm').addEventListener('submit', (event) => {
          event.preventDefault();
          window.dataLayer.push({ event: 'qa_form_submit', name: document.getElementById('qaName').value, choice: document.getElementById('qaChoice').value });
          console.info('qa form submitted');
          fetch('/api/local-pixel?event=form_submit');
          document.getElementById('result').textContent = 'Submitted ' + document.getElementById('qaName').value;
        });
        window.addEventListener('message', (event) => {
          if (event.data === 'qa-frame-clicked') window.dataLayer.push({ event: 'qa_iframe_clicked' });
        });
      `
    }));
  });
  return new Promise((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

function startAppServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `qa-open-${RUN_ID}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[app-err] ${chunk}`));
  return child;
}

function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
      else setTimeout(tick, 400);
    };
    tick();
  });
}

function monitorPage(page) {
  page.__qaEvents = [];
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      page.__qaEvents.push({ type: message.type(), text: message.text(), url: page.url() });
    }
  });
  page.on('pageerror', (error) => {
    page.__qaEvents.push({ type: 'pageerror', text: error.message, url: page.url() });
  });
  page.on('requestfailed', (request) => {
    const requestUrl = request.url();
    if (!requestUrl.startsWith(BASE_URL)) return;
    const errorText = request.failure()?.errorText || '';
    let pathName = '';
    try { pathName = new URL(requestUrl).pathname; } catch (_) {}
    if (errorText === 'net::ERR_ABORTED' && ['/auth/me', '/api/auth/me'].includes(pathName)) return;
    page.__qaEvents.push({ type: 'requestfailed', text: `${requestUrl} ${errorText}`, url: page.url() });
  });
}

async function clearPageEvents(page) {
  page.__qaEvents = [];
}

async function apiJson(page, route, options = {}) {
  const response = await page.request.fetch(`${BASE_URL}${route}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    data: options.body ? JSON.stringify(options.body) : undefined,
    failOnStatusCode: false,
    timeout: options.timeout || 30000
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { status: response.status(), ok: response.ok(), data, text, headers: response.headers() };
}

async function registerUser(page) {
  const suffix = RUN_ID.slice(-7).toLowerCase();
  const username = `os${suffix}`;
  const password = `OpenState${suffix}!`;
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#displayName', 'Open State QA');
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForSelector('.container', { timeout: 15000 });
  created.user = { username, password };
  recordCheck('Authentication', 'registered and logged in', 'PASS');
}

async function waitForAudit(page, id) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const status = await apiJson(page, `/api/audit/${id}/status`);
    if (['completed', 'failed'].includes(status.data?.status)) return status.data;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for audit ${id}`);
}

async function waitForInteraction(page, id) {
  const started = Date.now();
  while (Date.now() - started < 180000) {
    const status = await apiJson(page, `/api/interaction-runs/${id}/status`);
    if (['completed', 'failed'].includes(status.data?.status)) return status.data;
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for interaction ${id}`);
}

async function seedData(page) {
  const suffix = RUN_ID.slice(-7);
  const pre = await apiJson(page, '/api/action-templates', {
    method: 'POST',
    body: { type: 'pre', name: `Open Pre ${suffix}`, description: 'Open-state pre template', steps: [{ action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 }] }
  });
  created.preTemplateId = pre.data.template.id;

  const post = await apiJson(page, '/api/action-templates', {
    method: 'POST',
    body: { type: 'post', name: `Open Post ${suffix}`, description: 'Open-state post template', steps: [{ action: 'executeJavaScript', value: 'window.__openStatePost = true;' }] }
  });
  created.postTemplateId = post.data.template.id;

  const rulePayload = {
    name: `Open Rules ${suffix}`,
    description: 'Rules for open-state reports',
    rules: [{
      name: 'Adobe analytics request should be visible',
      whenMode: 'all',
      expectMode: 'any',
      evaluationLimit: 2,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [
        { type: 'tagPresence', tag: 'Adobe Analytics', operator: 'exists', value: '1' },
        { type: 'requestUrl', tag: 'Any detected tag', operator: 'contains', value: 'google-analytics' }
      ]
    }]
  };
  const rule = await apiJson(page, '/api/rule-sets', { method: 'POST', body: rulePayload });
  created.ruleSetId = rule.data.ruleSet.id;

  const flow = await apiJson(page, '/api/interaction-flow-templates', {
    method: 'POST',
    body: { name: `Open Flow ${suffix}`, description: 'Open-state flow', steps: [{ name: 'Accept cookies', action: 'click', selector: '#acceptCookies', timeout: 7000 }] }
  });
  created.flowTemplateId = flow.data.template.id;

  const config = await apiJson(page, '/api/audit-configs', {
    method: 'POST',
    body: {
      name: `Open Config ${suffix}`,
      description: 'Open-state audit config',
      domain: TARGET_URL,
      maxPages: 1,
      includeSitemaps: false,
      sameOrigin: true,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      options: { browserEngine: 'playwright', workerMode: 'ram-protected', simultaneousWorkers: 1 },
      preAuditActionTemplateIds: [created.preTemplateId],
      postAuditActionTemplateIds: [created.postTemplateId],
      ruleSetIds: [created.ruleSetId]
    }
  });
  created.auditConfigId = config.data.config.id;

  const audit = await apiJson(page, `/api/audit-configs/${created.auditConfigId}/run`, { method: 'POST', body: {} });
  created.auditId = audit.data.id;
  await waitForAudit(page, created.auditId);

  const interaction = await apiJson(page, '/api/interaction-configs', {
    method: 'POST',
    body: {
      name: `Open Interaction ${suffix}`,
      description: 'Open-state interaction config',
      startingUrl: TARGET_URL,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      generalSettings: { browserEngine: 'playwright', stopOnStepFailure: false, defaultTimeoutMs: 10000, navigationTimeoutMs: 15000 },
      flowTemplateIds: [created.flowTemplateId],
      ruleSetIds: [created.ruleSetId],
      steps: [
        { name: 'Open home', action: 'openUrl', value: TARGET_URL, timeout: 7000 },
        { name: 'Fill name', action: 'fillFormField', selector: '#qaName', value: 'Open State', timeout: 7000 },
        { name: 'Submit form', action: 'click', selector: '#submitForm', timeout: 7000 }
      ]
    }
  });
  created.interactionConfigId = interaction.data.config.id;
  const run = await apiJson(page, `/api/interaction-configs/${created.interactionConfigId}/run`, { method: 'POST', body: {} });
  created.interactionRunId = run.data.id;
  await waitForInteraction(page, created.interactionRunId);
}

async function pageHealth(page, route, label) {
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.container', { timeout: 15000 });
  await page.waitForTimeout(250);
  // A full-page capture can remove the scrollbar and crop the reflowed dashboard.
  const shot = await screenshot(page, label, label === 'mobile-dashboard' ? { fullPage: false } : {});
  const metrics = await page.evaluate(() => ({
    text: document.body.innerText.trim(),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    internalOverflow: Math.max(0, ...Array.from(document.querySelectorAll('.section, .rule-card, .journey-step-card, .config-center, .config-right, .manager-editor-panel')).map((el) => el.scrollWidth - el.clientWidth)),
    buttons: Array.from(document.querySelectorAll('button, a.button-style, a.pill')).filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length,
    activeNav: Boolean(document.querySelector('.side-nav a.active, .sidebar a.active, nav a.active'))
  }));
  check('Open-state pages', `${label} is meaningful`, metrics.text.length > 20, {
    id: `OS-PAGE-BLANK-${slug(label)}`,
    severity: 'high',
    page: route,
    feature: 'Page render',
    screenshot: shot,
    expected: 'Visible app content',
    actual: `Text length ${metrics.text.length}`
  });
  check('Open-state pages', `${label} has reachable primary controls`, metrics.buttons > 0, {
    id: `OS-PAGE-CONTROLS-${slug(label)}`,
    page: route,
    feature: 'Primary controls',
    screenshot: shot,
    expected: 'At least one visible control',
    actual: `Visible controls ${metrics.buttons}`
  });
  check('Open-state pages', `${label} has active navigation`, metrics.activeNav, {
    id: `OS-PAGE-NAV-${slug(label)}`,
    page: route,
    feature: 'Active sidebar state',
    screenshot: shot,
    expected: 'Active nav item',
    actual: 'No active nav item detected'
  });
  check('Open-state pages', `${label} has no unintended horizontal overflow`, metrics.scrollWidth <= metrics.clientWidth + 8, {
    id: `OS-PAGE-OVERFLOW-${slug(label)}`,
    severity: 'medium',
    page: route,
    feature: 'Responsive layout',
    screenshot: shot,
    expected: `scrollWidth <= ${metrics.clientWidth + 8}`,
    actual: `scrollWidth ${metrics.scrollWidth}`
  });
  check('Open-state pages', `${label} has no internal panel overflow`, metrics.internalOverflow <= 8, {
    id: `OS-PAGE-INTERNAL-OVERFLOW-${slug(label)}`,
    severity: 'medium',
    page: route,
    feature: 'Responsive layout',
    screenshot: shot,
    expected: 'No controls extend beyond their owning panel',
    actual: `Largest internal overflow ${metrics.internalOverflow}`
  });
  check('Open-state pages', `${label} console/network health`, page.__qaEvents.length === 0, {
    id: `OS-PAGE-CONSOLE-${slug(label)}`,
    page: route,
    feature: 'Console/network health',
    screenshot: shot,
    consoleOrNetwork: JSON.stringify(page.__qaEvents.slice(0, 5)),
    expected: 'No relevant console errors or failed same-origin requests',
    actual: JSON.stringify(page.__qaEvents.slice(0, 5))
  });
  if (route === '/dashboard.html') {
    const detail = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const cards = [...document.querySelectorAll('#dashboardMetrics > .card')];
      const statuses = [...document.querySelectorAll('#recentAudits .status-pill')];
      const wrap = document.querySelector('.dashboard-table-wrap');
      const rect = wrap?.getBoundingClientRect();
      return {
        cardsContained: cards.length === 4 && cards.every(el => el.getBoundingClientRect().right <= width - 8),
        statusesReadable: statuses.length > 0 && statuses.every(el => getComputedStyle(el).whiteSpace === 'nowrap'),
        tableContained: Boolean(wrap && rect.left >= 0 && rect.right <= width && getComputedStyle(wrap).overflowX === 'auto')
      };
    });
    for (const [name, passed] of Object.entries(detail)) {
      check('Dashboard responsive detail', `${label} ${name}`, passed, {
        id: `OS-DASHBOARD-${slug(label)}-${name}`, page: route, feature: 'Dashboard table and metrics',
        severity: 'medium', screenshot: shot,
        expected: 'Complete metric cards, unbroken statuses and a contained scrollable table',
        actual: JSON.stringify(detail)
      });
    }
  }
}

async function verifyPopoverGeometry(page, popoverSelector, triggerSelector, label, screenshotPath) {
  const detail = await page.evaluate(({ popoverSelector, triggerSelector }) => {
    const popover = document.querySelector(popoverSelector);
    const trigger = document.querySelector(triggerSelector);
    const pop = popover?.getBoundingClientRect();
    const trig = trigger?.getBoundingClientRect();
    return {
      visible: Boolean(popover && pop && pop.width > 0 && pop.height > 0),
      pop: pop ? { top: pop.top, left: pop.left, width: pop.width, height: pop.height, bottom: pop.bottom, right: pop.right } : null,
      trig: trig ? { top: trig.top, left: trig.left, width: trig.width, height: trig.height, bottom: trig.bottom, right: trig.right } : null,
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  }, { popoverSelector, triggerSelector });
  const nearTrigger = detail.visible && detail.trig && Math.abs(detail.pop.top - detail.trig.bottom) < 140;
  const cappedHeight = detail.visible && detail.pop.height <= Math.min(390, detail.viewportHeight - 24);
  const withinViewport = detail.visible && detail.pop.left >= 8 && detail.pop.right <= detail.viewportWidth - 8 && detail.pop.bottom <= detail.viewportHeight + 4;
  const sensibleWidth = detail.visible && detail.pop.width >= Math.min(240, detail.trig?.width || 240) && detail.pop.width <= detail.viewportWidth;
  check('Open-state controls', `${label} popover is visible and anchored`, detail.visible && nearTrigger && cappedHeight && withinViewport && sensibleWidth && detail.overflow <= 8, {
    id: `OS-POPOVER-${slug(label)}`,
    severity: 'medium',
    page: page.url(),
    feature: 'Open control geometry',
    control: label,
    screenshot: screenshotPath,
    expected: 'Visible, capped, near trigger, within viewport, no horizontal overflow',
    actual: JSON.stringify(detail)
  });
}

async function expectClosed(page, selector, label) {
  const visible = await page.locator(selector).isVisible().catch(() => false);
  check('Open-state controls', `${label} closes`, !visible, {
    id: `OS-CLOSE-${slug(label)}`,
    severity: 'medium',
    page: page.url(),
    feature: 'Open control close behavior',
    control: label,
    expected: 'Popover closes',
    actual: 'Popover remained visible'
  });
}

async function exerciseRulesPickers(page, viewportName = 'desktop') {
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}/rule-sets.html?new=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#rulesList .rule-card', { timeout: 15000 });
  await page.fill('.rule-name', `Open state rule ${viewportName}`);

  await page.selectOption('.rule-condition-subject', 'tagVendor');
  await page.waitForSelector('.rule-condition-row .catalog-combobox-input', { timeout: 5000 });
  await page.click('.rule-condition-row .catalog-combobox-input');
  await page.waitForSelector('.catalog-combobox-popover[data-open="true"]', { timeout: 5000 });
  const vendorShotName = viewportName === 'mobile' ? 'mobile-rules-vendor-picker-open' : 'rules-vendor-picker-open';
  const vendorShot = await screenshot(page, vendorShotName);
  await verifyPopoverGeometry(page, '.catalog-combobox-popover[data-open="true"]', '.rule-condition-row .catalog-combobox-input', `${viewportName} rules vendor picker`, vendorShot);

  await page.fill('.catalog-combobox-popover[data-open="true"] .catalog-combobox-search', 'adobe');
  await page.waitForSelector('.catalog-combobox-option >> text=Adobe Analytics', { timeout: 5000 });
  if (viewportName !== 'mobile') await screenshot(page, 'rules-vendor-picker-search-adobe');
  const adobeCount = await page.locator('.catalog-combobox-popover[data-open="true"] .catalog-combobox-option').count();
  check('Rules picker', `${viewportName} vendor search filters options`, adobeCount > 0 && adobeCount < 80, {
    id: `OS-RULES-VENDOR-SEARCH-${viewportName}`,
    page: '/rule-sets.html?new=1',
    feature: 'Vendor picker search',
    control: 'When Tag Vendor picker',
    screenshot: vendorShot,
    expected: 'Filtered Adobe options visible',
    actual: `${adobeCount} options`
  });
  await page.click('.catalog-combobox-option:has-text("Adobe Analytics")');
  await expectClosed(page, '.catalog-combobox-popover[data-open="true"]', `${viewportName} vendor picker after select`);
  const vendorValue = await page.locator('.rule-condition-row .catalog-combobox-input').inputValue();
  check('Rules picker', `${viewportName} selected vendor updates field`, vendorValue === 'Adobe Analytics', {
    id: `OS-RULES-VENDOR-VALUE-${viewportName}`,
    page: '/rule-sets.html?new=1',
    feature: 'Vendor picker selection',
    control: 'When Tag Vendor picker',
    expected: 'Adobe Analytics',
    actual: vendorValue
  });

  await page.click('.rule-assertion-row .catalog-combobox-input');
  await page.waitForSelector('.catalog-combobox-popover[data-open="true"]', { timeout: 5000 });
  if (viewportName !== 'mobile') {
    const expectShot = await screenshot(page, 'rules-expect-tag-picker-open');
    await verifyPopoverGeometry(page, '.catalog-combobox-popover[data-open="true"]', '.rule-assertion-row .catalog-combobox-input', 'rules expectation tag picker', expectShot);
  }
  await page.keyboard.press('Escape');
  await expectClosed(page, '.catalog-combobox-popover[data-open="true"]', `${viewportName} expectation picker Escape`);
  await page.click('.rule-assertion-row .catalog-combobox-input');
  await page.waitForSelector('.catalog-combobox-popover[data-open="true"]', { timeout: 5000 });
  await page.mouse.click(8, 8);
  await expectClosed(page, '.catalog-combobox-popover[data-open="true"]', `${viewportName} expectation picker outside click`);

  if (viewportName !== 'mobile') {
    await page.click('.rule-assertion-row .catalog-combobox-input');
    await page.fill('.catalog-combobox-popover[data-open="true"] .catalog-combobox-search', 'launch');
    await page.click('.catalog-combobox-option:has-text("Adobe Launch")');
    await page.fill('#ruleSetName', `Open State Picker ${RUN_ID}`);
    await page.click('#saveRuleSet');
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#rulesList .rule-card', { timeout: 15000 });
    const persisted = await page.evaluate(() => ({
      condition: document.querySelector('.rule-condition-row .catalog-combobox-input')?.value,
      assertion: document.querySelector('.rule-assertion-row .catalog-combobox-input')?.value
    }));
    check('Rules picker', 'selected vendor/tag values persist after save and reload', persisted.condition === 'Adobe Analytics' && persisted.assertion === 'Adobe Launch', {
      id: 'OS-RULES-PERSISTENCE',
      page: '/rule-sets.html',
      feature: 'Rules picker persistence',
      control: 'Vendor/tag comboboxes',
      expected: 'Adobe Analytics and Adobe Launch after reload',
      actual: JSON.stringify(persisted)
    });
  }
}

async function openAuditConfigPickers(page) {
  await page.goto(`${BASE_URL}/audit-configs.html?new=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#configName', { timeout: 15000 });
  await page.click('[data-tab="pre"]');
  await page.click('#choosePreTemplates');
  await page.waitForSelector('.site-dialog-overlay .site-dialog', { timeout: 5000 });
  const shot = await screenshot(page, 'audit-config-template-picker-open');
  const metrics = await page.evaluate(() => {
    const dialog = document.querySelector('.site-dialog-overlay .site-dialog')?.getBoundingClientRect();
    return { dialog: dialog ? { width: dialog.width, height: dialog.height, top: dialog.top, bottom: dialog.bottom } : null, viewportHeight: innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check('Open-state controls', 'audit config template picker is readable', metrics.dialog && metrics.dialog.height < metrics.viewportHeight && metrics.overflow <= 8, {
    id: 'OS-AUDIT-CONFIG-PICKER',
    severity: 'medium',
    page: '/audit-configs.html?new=1',
    feature: 'Template picker dialog',
    control: 'Choose Common Templates',
    screenshot: shot,
    expected: 'Dialog visible within viewport with no overflow',
    actual: JSON.stringify(metrics)
  });
  await page.keyboard.press('Escape');
  await expectClosed(page, '.site-dialog-overlay .site-dialog', 'audit config template picker Escape');
}

async function exerciseNativeSelect(page, select, screenshotName) {
  await page.bringToFront();
  const original = await select.inputValue();
  const evidence = { page: page.url(), feature: 'Native select interaction', control: screenshotName, severity: 'medium' };
  await select.click();
  check('Native dropdowns', `${screenshotName} actually opens`, await select.evaluate(el => el.matches(':open')), {
    ...evidence, id: `OS-NATIVE-OPEN-${screenshotName}`, expected: 'Select matches :open after click', actual: 'Native menu open-state probe'
  });
  await screenshot(page, screenshotName);
  await page.keyboard.press('Escape');
  check('Native dropdowns', `${screenshotName} Escape dismisses`, !(await select.evaluate(el => el.matches(':open'))), {
    ...evidence, id: `OS-NATIVE-ESCAPE-${screenshotName}`, expected: 'Menu closed after Escape', actual: 'Native menu close-state probe'
  });
  await select.click();
  await page.mouse.click(8, 8);
  check('Native dropdowns', `${screenshotName} outside click dismisses`, !(await select.evaluate(el => el.matches(':open'))), {
    ...evidence, id: `OS-NATIVE-OUTSIDE-${screenshotName}`, expected: 'Menu closed after outside click', actual: 'Native menu close-state probe'
  });
  await select.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  const last = await select.locator('option').last().getAttribute('value');
  check('Native dropdowns', `${screenshotName} keyboard selection updates`, await select.inputValue() === last, {
    ...evidence, id: `OS-NATIVE-SELECT-${screenshotName}`, expected: `Selected ${last}`, actual: await select.inputValue()
  });
  await page.keyboard.press('Escape');
  await select.selectOption(original);
}

async function openActionDropdown(page, route, screenshotName, label) {
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#steps .step .action', { timeout: 15000 });
  const optionCount = await page.locator('#steps .step .action option').count();
  await exerciseNativeSelect(page, page.locator('#steps .step .action').first(), screenshotName);
  check('Open-state controls', `${label} action dropdown has full action catalog`, optionCount >= 20, {
    id: `OS-ACTION-DROPDOWN-${slug(label)}`,
    page: route,
    feature: 'Action type dropdown',
    control: label,
    expected: '20+ supported action options',
    actual: `${optionCount} options`
  });
}

async function openInteractionControls(page, mobile = false) {
  await page.goto(`${BASE_URL}/interaction-configs.html?id=${encodeURIComponent(created.interactionConfigId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#interactionName', { timeout: 15000 });
  await page.click('[data-tab="steps"]');
  await page.waitForSelector('.journey-action', { timeout: 15000 });
  await exerciseNativeSelect(page, page.locator('.journey-action').first(), mobile ? 'mobile-interaction-step-dropdown-open' : 'interaction-step-type-dropdown-open');
  const actions = await page.locator('.journey-action').first().locator('option').count();
  check('Open-state controls', `${mobile ? 'mobile ' : ''}interaction step action catalog is reachable`, actions >= 20, {
    id: `OS-INTERACTION-ACTION-${mobile ? 'mobile' : 'desktop'}`,
    page: '/interaction-configs.html',
    feature: 'Interaction step action dropdown',
    control: 'Journey action',
    expected: '20+ supported action options',
    actual: `${actions} options`
  });
  if (!mobile) {
    await page.click('[data-tab="templates"]');
    await page.waitForSelector('#templateImportList', { timeout: 5000 });
    const shot = await screenshot(page, 'interaction-template-picker-open');
    const rows = await page.locator('#templateImportList .picker-row').count();
    check('Open-state controls', 'interaction template picker list is readable', rows >= 1, {
      id: 'OS-INTERACTION-TEMPLATE-PICKER',
      page: '/interaction-configs.html',
      feature: 'Interaction template picker',
      control: 'Template import list',
      screenshot: shot,
      expected: 'At least one seeded template row',
      actual: `${rows} rows`
    });
  }
}

async function openReportModals(page) {
  await page.goto(`${BASE_URL}/?auditId=${encodeURIComponent(created.auditId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.page', { timeout: 30000 });

  await page.click('.view-network');
  await page.waitForSelector('#modal:not(.hidden) #modalBody', { timeout: 10000 });
  await screenshot(page, 'report-network-modal-open');
  const requestButton = page.locator('#modalBody .view-network-request, #modalBody [data-request-id], #modalBody .request-detail, #modalBody tr[data-request-id]').first();
  if (await requestButton.count()) {
    await requestButton.click();
    await page.waitForTimeout(300);
    await screenshot(page, 'report-request-detail-open');
    check('Report modals', 'request detail modal opens', await page.locator('#modalTitle').textContent().then((text) => /request/i.test(text)), {
      id: 'OS-REPORT-REQUEST-DETAIL',
      page: `/?auditId=${created.auditId}`,
      feature: 'Network request details',
      control: 'Request detail',
      expected: 'Request detail title/body visible',
      actual: await page.locator('#modalTitle').textContent()
    });
  } else {
    addIssue({
      id: 'OS-REPORT-REQUEST-DETAIL-MISSING',
      severity: 'medium',
      page: `/?auditId=${created.auditId}`,
      feature: 'Network request details',
      control: 'Request detail',
      expected: 'At least one request detail opener',
      actual: 'No request detail opener was found',
      screenshot: screenshots[screenshots.length - 1]
    });
  }
  await page.click('#modalClose');

  await page.click('.view-datalayer');
  await page.waitForSelector('#modal:not(.hidden)', { timeout: 10000 });
  await screenshot(page, 'report-datalayer-modal-open');
  await page.click('#modalClose');

  await page.click('.view-rules');
  await page.waitForSelector('#modal:not(.hidden)', { timeout: 10000 });
  await screenshot(page, 'report-rules-modal-open');
  await page.click('#modalClose');

  await page.locator('.view-console').first().click();
  await page.waitForSelector('#modal:not(.hidden) .console-content', { timeout: 10000 });
  const consoleShot = await screenshot(page, 'report-console-modal-open');
  const contrast = await page.evaluate(() => {
    const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3)
      .map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const background = luminance(getComputedStyle(document.querySelector('.console-messages')).backgroundColor);
    return [...document.querySelectorAll('#modal .console-content')].map(el => {
      const foreground = luminance(getComputedStyle(el).color);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
  });
  check('Report modals', 'console messages meet 4.5:1 text contrast', contrast.length > 0 && contrast.every(ratio => ratio >= 4.5), {
    id: 'OS-CONSOLE-CONTRAST', severity: 'medium', page: `/?auditId=${created.auditId}`,
    feature: 'Console readability', control: 'Console modal', screenshot: consoleShot,
    expected: 'Every console message has at least 4.5:1 contrast with its opaque background',
    actual: JSON.stringify(contrast)
  });
  await page.click('#modalClose');

  const modalOk = await page.evaluate(() => {
    const modal = document.querySelector('#modal');
    return modal && modal.classList.contains('hidden') && document.documentElement.scrollWidth <= document.documentElement.clientWidth + 8;
  });
  check('Report modals', 'audit report modal open/close states are clean', modalOk, {
    id: 'OS-REPORT-MODAL-CLOSE',
    page: `/?auditId=${created.auditId}`,
    feature: 'Audit report modals',
    expected: 'No modal left open and no horizontal overflow',
    actual: 'Modal remained open or overflow detected'
  });
}

async function openInteractionReportDetails(page) {
  await page.goto(`${BASE_URL}/interaction-report.html?id=${encodeURIComponent(created.interactionRunId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.step-result-card, .timeline-list', { timeout: 30000 });
  await screenshot(page, 'interaction-report-default');
  const buttons = await page.locator('[data-view="requests"], [data-view-overall="requests"]').count();
  check('Interaction report', 'interaction report has drilldown buttons', buttons > 0, {
    id: 'OS-INTERACTION-REPORT-DRILLDOWN',
    page: `/interaction-report.html?id=${created.interactionRunId}`,
    feature: 'Interaction report details',
    expected: 'At least one detail button',
    actual: `${buttons} buttons`
  });
  if (buttons > 0) {
    await page.locator('[data-view="requests"], [data-view-overall="requests"]').first().click();
    await page.waitForSelector('#interactionModal:not(.hidden)', { timeout: 10000 });
    await screenshot(page, 'interaction-report-requests-modal-open');
    await page.click('#interactionModalClose');
  }
}

async function runResponsivePass(page) {
  const viewports = [
    ['desktop', { width: 1440, height: 950 }],
    ['tablet', { width: 820, height: 980 }],
    ['mobile', { width: 390, height: 844 }]
  ];
  const routes = [
    ['/dashboard.html', 'dashboard'],
    ['/?scratch=1', 'create-audit'],
    ['/audits.html', 'audit-history'],
    ['/audit-configs.html', 'audit-configs'],
    ['/action-templates.html?type=pre', 'pre-audit-actions'],
    ['/action-templates.html?type=post', 'post-audit-actions'],
    ['/rule-sets.html', 'rules'],
    ['/interaction-configs.html', 'interaction-configs'],
    ['/interaction-flow-templates.html', 'interaction-flow-templates'],
    ['/interaction-runs.html', 'interaction-runs'],
    ['/settings.html', 'settings'],
    [`/?auditId=${encodeURIComponent(created.auditId)}`, 'audit-report'],
    [`/interaction-report.html?id=${encodeURIComponent(created.interactionRunId)}`, 'interaction-report']
  ];
  for (const [name, viewport] of viewports) {
    await page.setViewportSize(viewport);
    for (const [route, label] of routes) {
      await pageHealth(page, route, `${name}-${label}`);
    }
  }
}

function writeReports(error) {
  const issuesPath = path.join(ROOT, 'QA_OPEN_STATE_ISSUES.md');
  const summaryPath = path.join(ROOT, 'QA_OPEN_STATE_SUMMARY.md');
  const issueLines = [
    '# Open-State Visual QA Issues',
    '',
    `Run ID: ${RUN_ID}`,
    `Screenshots: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`,
    ''
  ];
  if (!issues.length) {
    issueLines.push('No reproducible open-state issues were found in this run.');
  } else {
    for (const issue of issues) {
      issueLines.push(`## ${issue.id} - ${issue.severity}`);
      issueLines.push('');
      issueLines.push(`- Page/feature: ${issue.page} ${issue.feature}`.trim());
      issueLines.push(`- Control/state: ${issue.control || 'n/a'}`);
      issueLines.push(`- Screenshot: ${issue.screenshot || 'n/a'}`);
      issueLines.push(`- Steps to reproduce: ${issue.steps || 'n/a'}`);
      issueLines.push(`- Expected: ${issue.expected || 'n/a'}`);
      issueLines.push(`- Actual: ${issue.actual || 'n/a'}`);
      issueLines.push(`- Console/network evidence: ${issue.consoleOrNetwork || 'n/a'}`);
      issueLines.push(`- Root cause: ${issue.rootCause || 'TBD'}`);
      issueLines.push(`- Files changed: ${issue.filesChanged || 'TBD'}`);
      issueLines.push(`- Fix applied: ${issue.fixApplied || 'Pending'}`);
      issueLines.push(`- Retest result: ${issue.retest || 'Pending'}`);
      issueLines.push('');
    }
  }
  fs.writeFileSync(issuesPath, issueLines.join('\n'));

  const failed = checks.filter((check) => check.status !== 'PASS');
  const summaryLines = [
    '# Open-State Visual QA Summary',
    '',
    `Run ID: ${RUN_ID}`,
    `Date: ${new Date().toISOString()}`,
    `Browser mode: ${HEADLESS ? 'headless Playwright Chromium' : 'headed Playwright Chromium'}`,
    `App URL: ${BASE_URL}`,
    `Target URL: ${TARGET_URL}`,
    `Screenshot folder: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`,
    '',
    '## Result',
    '',
    `- Checks executed: ${checks.length}`,
    `- Issues found: ${issues.length}`,
    `- Blocker/high/medium issues: ${issues.filter((issue) => ['blocker', 'high', 'medium'].includes(issue.severity)).length}`,
    `- Screenshots captured: ${screenshots.length}`,
    error ? `- Harness error: ${error.message}` : '- Harness error: none',
    '',
    '## Created QA Data',
    '',
    '```json',
    JSON.stringify(created, null, 2),
    '```',
    '',
    '## Checks',
    '',
    '| Area | Check | Status | Details |',
    '| --- | --- | --- | --- |',
    ...checks.map((check) => `| ${check.area} | ${check.name} | ${check.status} | ${String(check.details || '').replace(/\|/g, '\\|')} |`),
    '',
    '## Screenshots',
    '',
    ...screenshots.map((item) => `- ${item}`)
  ];
  fs.writeFileSync(summaryPath, summaryLines.join('\n'));
}

async function runMain() {
  let targetServer;
  let appProcess;
  let browser;
  let page;
  let harnessError = null;
  try {
    targetServer = await startTargetServer();
    appProcess = startAppServer();
    await waitForHttp(`${BASE_URL}/login`);
    browser = await chromium.launch({ headless: HEADLESS, slowMo: HEADLESS ? 0 : 60 });
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
    page = await context.newPage();
    monitorPage(page);
    await registerUser(page);
    await seedData(page);
    await runResponsivePass(page);

    await page.setViewportSize({ width: 1440, height: 950 });
    await exerciseRulesPickers(page, 'desktop');
    await openAuditConfigPickers(page);
    await openActionDropdown(page, `/action-templates.html?type=pre&id=${encodeURIComponent(created.preTemplateId)}`, 'pre-action-type-dropdown-open', 'pre action');
    await openActionDropdown(page, `/action-templates.html?type=post&id=${encodeURIComponent(created.postTemplateId)}`, 'post-action-type-dropdown-open', 'post action');
    await openInteractionControls(page, false);
    await openReportModals(page);
    await openInteractionReportDetails(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await exerciseRulesPickers(page, 'mobile');
    await openInteractionControls(page, true);
  } catch (err) {
    harnessError = err;
    addIssue({
      id: 'OS-HARNESS-ERROR',
      severity: 'blocker',
      feature: 'Open-state QA harness',
      steps: 'Run npm run qa:open-states',
      expected: 'Harness completes and writes reports',
      actual: err.stack || err.message,
      consoleOrNetwork: page && page.__qaEvents ? JSON.stringify(page.__qaEvents.slice(0, 10)) : ''
    });
  } finally {
    writeReports(harnessError);
    if (browser) await browser.close().catch(() => {});
    if (appProcess) appProcess.kill();
    if (targetServer) await new Promise((resolve) => targetServer.close(resolve));
  }

  if (harnessError || issues.some((issue) => ['blocker', 'high', 'medium'].includes(issue.severity))) {
    console.error(`Open-state QA found ${issues.length} issue(s). See QA_OPEN_STATE_ISSUES.md`);
    process.exit(1);
  }
  console.log('Open-state QA passed without reproducible blocker/high/medium issues. See QA_OPEN_STATE_SUMMARY.md');
}

runMain();
