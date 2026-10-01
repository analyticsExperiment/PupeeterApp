const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_APP_PORT || 3300);
const TARGET_PORT = Number(process.env.QA_TARGET_PORT || 4567);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', `qa-regression-${RUN_ID}`);
const HEADLESS = process.env.QA_HEADED === '1' ? false : true;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const checks = [];
const issues = [];
const screenshots = [];
const created = {
  userA: null,
  userB: null,
  auditId: null,
  configAuditId: null,
  interactionRunId: null,
  preTemplateId: null,
  postTemplateId: null,
  ruleSetId: null,
  flowTemplateId: null,
  auditConfigId: null,
  interactionConfigId: null
};

function slug(value) {
  return String(value || 'screenshot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function recordCheck(area, name, status, details = '') {
  checks.push({ area, name, status, details });
}

function addIssue(issue) {
  const id = issue.id || `QA-${String(issues.length + 1).padStart(3, '0')}`;
  if (issues.some((item) => item.id === id)) return;
  issues.push({
    id,
    severity: issue.severity || 'medium',
    page: issue.page || '',
    feature: issue.feature || '',
    steps: issue.steps || '',
    expected: issue.expected || '',
    actual: issue.actual || '',
    screenshot: issue.screenshot || '',
    consoleOrNetwork: issue.consoleOrNetwork || '',
    suspectedFile: issue.suspectedFile || '',
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

async function screenshot(page, name) {
  const file = path.join(OUTPUT_DIR, `${String(screenshots.length + 1).padStart(2, '0')}-${slug(name)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  screenshots.push(relative);
  return relative;
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

function startTargetServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, TARGET_URL);
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': type, ...headers });
      res.end(body);
    };
    if (url.pathname === '/favicon.ico') return send(204, 'text/plain', '');
    if (url.pathname === '/robots.txt') {
      return send(200, 'text/plain', `User-agent: *\nAllow: /\nSitemap: ${TARGET_URL}/sitemap.xml\n`);
    }
    if (url.pathname === '/sitemap.xml') {
      return send(200, 'application/xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${TARGET_URL}/</loc></url>
  <url><loc>${TARGET_URL}/page-2</loc></url>
</urlset>`);
    }
    if (url.pathname === '/api/local-pixel') {
      return send(200, 'application/json', JSON.stringify({ ok: true, query: Object.fromEntries(url.searchParams.entries()) }));
    }
    if (url.pathname === '/collect') return send(204, 'text/plain', '');
    if (url.pathname === '/iframe') {
      return send(200, 'text/html', `<!doctype html><html><head><title>QA Frame</title></head><body>
        <button id="iframeButton" onclick="parent.postMessage('qa-frame-clicked','*'); console.log('qa iframe clicked');">Frame Action</button>
      </body></html>`);
    }
    if (url.pathname === '/page-2') {
      return send(200, 'text/html', qaPage({
        title: 'QA Target Page Two',
        body: '<h1>QA Target Page Two</h1><p id="pageTwoMarker">Second page marker</p>',
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
        <section id="deepSection" style="margin-top:900px;">Deep content for scroll validation</section>
      `,
      script: `
        document.cookie = 'qa_session=abc123; path=/';
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'qa_page_view', pageType: 'home' });
        console.info('qa target home loaded');
        fetch('/api/local-pixel?event=home_fetch');
        new Image().src = 'https://www.google-analytics.com/collect?v=1&t=pageview&tid=UA-QA-1&cid=qa';
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
          if (event.data === 'qa-frame-clicked') {
            window.dataLayer.push({ event: 'qa_iframe_clicked' });
          }
        });
      `
    }));
  });
  return new Promise((resolve) => {
    server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server));
  });
}

function qaPage({ title, body, script }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body>
    ${body}
    <script>${script}</script>
  </body></html>`;
}

function startAppServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `qa-secret-${RUN_ID}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[app-err] ${chunk}`));
  return child;
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
    if (requestUrl.startsWith(BASE_URL)) {
      const errorText = request.failure()?.errorText || '';
      const pathName = (() => {
        try { return new URL(requestUrl).pathname; } catch (_) { return ''; }
      })();
      if (errorText === 'net::ERR_ABORTED' && ['/auth/me', '/api/auth/me'].includes(pathName)) {
        return;
      }
      page.__qaEvents.push({ type: 'requestfailed', text: `${requestUrl} ${errorText}`, url: page.url() });
    }
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
    failOnStatusCode: false
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  return { status: response.status(), ok: response.ok(), data, text, headers: response.headers() };
}

async function registerUser(page, username, password, displayName) {
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#displayName', displayName);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForSelector('.container', { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  recordCheck('Authentication', `registered ${username}`, 'PASS');
}

async function loginUser(page, username, password) {
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForSelector('.container', { timeout: 15000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  recordCheck('Authentication', `logged in ${username}`, 'PASS');
}

async function logoutViaUi(page) {
  await page.waitForSelector('[data-action="logout"]', { timeout: 15000 });
  await page.click('[data-action="logout"]');
  await page.waitForURL(/\/login$/, { timeout: 15000 });
  recordCheck('Authentication', 'logout redirects to login', 'PASS');
}

async function visitAndScreenshot(page, route, name, options = {}) {
  await clearPageEvents(page);
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(options.selector || '.container, .login-card', { timeout: 15000 });
  await page.waitForTimeout(350);
  const shot = await screenshot(page, name);
  const bodyText = await page.locator('body').innerText().catch(() => '');
  check('Navigation/UI', `${name} is not blank`, bodyText.trim().length > 20, {
    id: `QA-BLANK-${slug(name).toUpperCase()}`,
    severity: 'high',
    page: route,
    feature: 'Page render',
    steps: `Open ${route}`,
    expected: 'Meaningful page content renders',
    actual: 'Page body was blank or nearly blank',
    screenshot: shot
  });
  if (!options.publicPage) {
    const activeCount = await page.locator('.app-nav-link.active').count();
    check('Navigation/UI', `${name} active nav`, activeCount === 1, {
      id: `QA-NAV-${slug(name).toUpperCase()}`,
      severity: 'medium',
      page: route,
      feature: 'Sidebar navigation',
      steps: `Open ${route}`,
      expected: 'Exactly one sidebar item is active',
      actual: `Active item count was ${activeCount}`,
      screenshot: shot,
      suspectedFile: 'public/shared-layout.js'
    });
  }
  check('Navigation/UI', `${name} console health`, page.__qaEvents.length === 0, {
    id: `QA-CONSOLE-${slug(name).toUpperCase()}`,
    severity: 'high',
    page: route,
    feature: 'Console health',
    steps: `Open ${route}`,
    expected: 'No app console errors or failed same-origin requests',
    actual: JSON.stringify(page.__qaEvents.slice(0, 5)),
    screenshot: shot
  });
}

async function setBuilderSteps(page, containerSelector, steps) {
  await page.evaluate(({ containerSelector, steps }) => {
    if (window.FreeAuditActionBuilder) {
      window.FreeAuditActionBuilder.setSteps(document.querySelector(containerSelector), steps);
      return;
    }
    if (typeof window.setStepsInContainer === 'function') {
      window.setStepsInContainer(containerSelector, steps);
      return;
    }
    throw new Error('No step builder available on this page');
  }, { containerSelector, steps });
}

async function createActionTemplate(page, type, name, description, steps) {
  await visitAndScreenshot(page, `/action-templates.html?type=${type}&new=1`, `${type} template editor`);
  await page.fill('#templateName', name);
  await page.fill('#templateDescription', description);
  await setBuilderSteps(page, '#steps', steps);
  if (steps.length > 1) {
    await page.locator('#steps .move-down').first().click();
    await page.locator('#steps .move-up').nth(1).click();
  }
  await screenshot(page, `${type} template populated`);
  await page.click('#saveTemplate');
  await page.waitForFunction(() => new URL(location.href).searchParams.has('id'), null, { timeout: 15000 });
  const list = await apiJson(page, `/api/action-templates?type=${type}`);
  const item = (list.data.templates || []).find((template) => template.name === name);
  check('Action Templates', `${type} template saved`, Boolean(item), {
    id: `QA-TEMPLATE-SAVE-${type.toUpperCase()}`,
    severity: 'high',
    page: `/action-templates.html?type=${type}`,
    feature: 'Action template save',
    steps: `Create and save ${type} action template`,
    expected: 'Template appears in API list',
    actual: JSON.stringify(list.data)
  });
  if (item) {
    await page.click('#duplicateTemplate');
    await page.waitForTimeout(500);
    await page.click('#deleteTemplate');
    await page.waitForTimeout(500);
    recordCheck('Action Templates', `${type} duplicate/delete smoke`, 'PASS');
  }
  return item && item.id;
}

async function createRuleSet(page, name) {
  await visitAndScreenshot(page, '/rule-sets.html?new=1', 'rule set editor');
  await page.fill('#ruleSetName', name);
  await page.fill('#ruleSetDescription', 'QA mixed pass/fail rule set');
  const rules = [
    {
      name: 'QA page title passes',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 5,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'QA Target' }]
    },
    {
      name: 'QA intentional missing cookie fails',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 5,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'cookie', field: 'qa_missing_cookie', operator: 'exists', value: '' }]
    },
    {
      name: 'QA console and dataLayer observed',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [
        { type: 'dataLayer', field: 'event', operator: 'contains', value: 'qa_page_view' },
        { type: 'console', field: 'info', operator: 'contains', value: 'qa target home loaded' }
      ]
    }
  ];
  await page.evaluate((rulesToSet) => {
    const root = document.getElementById('rulesList');
    root.innerHTML = '';
    rulesToSet.forEach((rule) => window.RuleBuilder.addRule(rule));
  }, rules);
  await screenshot(page, 'rule set populated');
  await page.click('#saveRuleSet');
  await page.waitForFunction(() => new URL(location.href).searchParams.has('id'), null, { timeout: 15000 });
  const list = await apiJson(page, '/api/rule-sets');
  const item = (list.data.ruleSets || []).find((ruleSet) => ruleSet.name === name);
  check('Rules', 'rule set saved', Boolean(item), {
    id: 'QA-RULESET-SAVE',
    severity: 'high',
    page: '/rule-sets.html',
    feature: 'Rule set save',
    steps: 'Create and save rule set',
    expected: 'Rule set appears in API list',
    actual: JSON.stringify(list.data)
  });
  if (item) {
    await page.click('#duplicateRuleSet');
    await page.waitForTimeout(500);
    await page.click('#deleteRuleSet');
    await page.waitForTimeout(500);
    recordCheck('Rules', 'rule set duplicate/delete smoke', 'PASS');
  }
  return item && item.id;
}

async function createFlowTemplate(page, name) {
  await visitAndScreenshot(page, '/interaction-flow-templates.html', 'interaction flow template editor');
  await page.click('#newTemplate');
  await page.fill('#templateName', name);
  await page.fill('#templateDescription', 'QA reusable interaction flow');
  await setBuilderSteps(page, '#steps', [
    { action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 },
    { action: 'click', selector: '#acceptCookies', timeout: 7000 }
  ]);
  await screenshot(page, 'interaction flow template populated');
  await page.click('#saveTemplate');
  await page.waitForTimeout(500);
  const list = await apiJson(page, '/api/interaction-flow-templates');
  const item = (list.data.templates || []).find((template) => template.name === name);
  check('Interaction Flow Templates', 'flow template saved', Boolean(item), {
    id: 'QA-FLOWTEMPLATE-SAVE',
    severity: 'high',
    page: '/interaction-flow-templates.html',
    feature: 'Interaction flow template save',
    steps: 'Create and save flow template',
    expected: 'Flow template appears in API list',
    actual: JSON.stringify(list.data)
  });
  if (item) {
    await page.click('#duplicateTemplate');
    await page.waitForTimeout(500);
    await page.click('#deleteTemplate');
    await page.waitForTimeout(500);
    recordCheck('Interaction Flow Templates', 'flow template duplicate/delete smoke', 'PASS');
  }
  return item && item.id;
}

async function verifyApplyToCreateAudit(page, preTemplateId, ruleSetId, flowTemplateId) {
  await page.goto(`${BASE_URL}/action-templates.html?type=pre&id=${encodeURIComponent(preTemplateId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#applyTemplate');
  await page.click('#applyTemplate');
  await page.waitForTimeout(800);
  let shot = await screenshot(page, 'apply pre template destination');
  check('Reusable Templates', 'pre template apply opens visible create audit form', await page.locator('#auditForm:not(.hidden)').count() === 1, {
    id: 'QA-APPLY-PRE-HIDDEN',
    severity: 'high',
    page: '/action-templates.html?type=pre',
    feature: 'Apply template to Create Audit',
    steps: 'Open a saved pre-audit template and click Apply To Create Audit',
    expected: 'Create Audit form is visible and contains the applied step',
    actual: `URL=${page.url()}, visible audit forms=${await page.locator('#auditForm:not(.hidden)').count()}`,
    screenshot: shot,
    suspectedFile: 'public/action-templates.js, public/app.js'
  });

  await page.goto(`${BASE_URL}/rule-sets.html?id=${encodeURIComponent(ruleSetId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#applyRuleSet');
  await page.click('#applyRuleSet');
  await page.waitForTimeout(800);
  shot = await screenshot(page, 'apply rule set destination');
  check('Reusable Templates', 'rule set apply opens visible create audit form', await page.locator('#auditForm:not(.hidden)').count() === 1, {
    id: 'QA-APPLY-RULES-HIDDEN',
    severity: 'high',
    page: '/rule-sets.html',
    feature: 'Apply rule set to Create Audit',
    steps: 'Open a saved rule set and click Apply To Create Audit',
    expected: 'Create Audit form is visible and contains the applied rule',
    actual: `URL=${page.url()}, visible audit forms=${await page.locator('#auditForm:not(.hidden)').count()}`,
    screenshot: shot,
    suspectedFile: 'public/rule-sets.js, public/app.js'
  });

  await page.goto(`${BASE_URL}/interaction-flow-templates.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(`[data-id="${flowTemplateId}"]`);
  await page.click(`[data-id="${flowTemplateId}"]`);
  await page.click('#applyTemplate');
  await page.waitForTimeout(800);
  shot = await screenshot(page, 'apply flow template destination');
  check('Reusable Templates', 'flow template apply opens visible create audit form', await page.locator('#auditForm:not(.hidden)').count() === 1, {
    id: 'QA-APPLY-FLOW-HIDDEN',
    severity: 'high',
    page: '/interaction-flow-templates.html',
    feature: 'Apply flow template to Create Audit',
    steps: 'Open a saved interaction flow template and click Apply To Create Audit',
    expected: 'Create Audit form is visible and contains the applied flow step',
    actual: `URL=${page.url()}, visible audit forms=${await page.locator('#auditForm:not(.hidden)').count()}`,
    screenshot: shot,
    suspectedFile: 'public/interaction-flow-templates.js, public/app.js'
  });
}

async function runScratchAudit(page) {
  await visitAndScreenshot(page, '/?scratch=1', 'create audit scratch');
  await page.fill('#domain', TARGET_URL);
  await page.fill('#maxPages', '2');
  await page.selectOption('#sameOriginOnly', 'true');
  await page.selectOption('#waitUntil', 'domcontentloaded');
  await page.uncheck('#showBrowser');
  await page.fill('#startingUrls', `${TARGET_URL}/page-2`);
  await page.uncheck('#findPagesInSitemaps');
  await page.evaluate(({ pre, post, rules }) => {
    window.setStepsInContainer('#preAuditSteps', pre);
    window.setStepsInContainer('#onPageSteps', post);
    const root = document.getElementById('rulesList');
    root.innerHTML = '';
    rules.forEach((rule) => window.RuleBuilder.addRule(rule));
  }, {
    pre: [
      { action: 'waitForSelector', selector: '#acceptCookies', timeout: 5000 },
      { action: 'click', selector: '#acceptCookies', timeout: 5000 }
    ],
    post: [
      { action: 'executeJavaScript', value: "window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:'qa_post_action'}); console.info('qa post action');" }
    ],
    rules: [
      {
        name: 'Scratch title passes',
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
        assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'QA Target' }]
      },
      {
        name: 'Scratch missing request fails',
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
        assertions: [{ type: 'requestUrl', tag: '', operator: 'contains', value: 'definitely-missing-request' }]
      }
    ]
  });
  await screenshot(page, 'scratch audit populated');
  await page.click('#auditForm button[type="submit"]');
  await page.waitForFunction(() => new URLSearchParams(location.search).has('auditId'), null, { timeout: 10000 });
  created.auditId = await page.evaluate(() => new URLSearchParams(location.search).get('auditId'));
  await page.waitForSelector('#results:not(.hidden) .page', { timeout: 150000 });
  await screenshot(page, 'scratch audit report');
  const results = await apiJson(page, `/api/audit/${created.auditId}/results`);
  check('Audit from Scratch', 'audit completed with pages', results.ok && (results.data.pages || []).length >= 1, {
    id: 'QA-SCRATCH-AUDIT-NO-PAGES',
    severity: 'blocker',
    page: '/?scratch=1',
    feature: 'Audit runner',
    steps: 'Run scratch audit against local target',
    expected: 'Completed results include at least one page',
    actual: JSON.stringify(results.data).slice(0, 1000),
    screenshot: screenshots[screenshots.length - 1]
  });
  check('Audit from Scratch', 'SSE/live logs visible', await page.locator('#logStream .log-line').count() > 0, {
    id: 'QA-SCRATCH-NO-LOGS',
    severity: 'high',
    page: '/?scratch=1',
    feature: 'SSE live logs',
    steps: 'Run scratch audit and inspect live logs panel',
    expected: 'Live log rows are rendered',
    actual: 'No log rows found',
    screenshot: screenshots[screenshots.length - 1]
  });
  await verifyAuditReportModalsAndExports(page, created.auditId, 'Scratch');
}

async function verifyAuditReportModalsAndExports(page, auditId, label) {
  const modalButtons = [
    ['.view-tools', 'Tools'],
    ['.view-network', 'Network Requests'],
    ['.view-cookies', 'Cookies'],
    ['.view-datalayer', 'dataLayer'],
    ['.view-console', 'Console'],
    ['.view-rules', 'Rules']
  ];
  for (const [selector, modalName] of modalButtons) {
    const button = page.locator(`.page ${selector}`).first();
    if (await button.count()) {
      await button.click();
      await page.waitForSelector('#modal:not(.hidden)', { timeout: 10000 });
      await screenshot(page, `${label} ${modalName} modal`);
      if (selector === '.view-network' && await page.locator('.view-network-request').count()) {
        await page.locator('.view-network-request').first().click();
        await page.waitForTimeout(250);
        await screenshot(page, `${label} network request detail modal`);
        if (await page.locator('#modalBack:not(.hidden)').count()) await page.click('#modalBack');
      }
      await page.click('#modalClose');
      await page.waitForFunction(() => document.querySelector('#modal')?.classList.contains('hidden'), null, { timeout: 10000 });
      recordCheck('Reports', `${label} ${modalName} modal opens/closes`, 'PASS');
    }
  }
  const csv = await page.request.get(`${BASE_URL}/api/audit/${auditId}/csv`);
  check('Exports', `${label} audit CSV export`, csv.ok() && (await csv.text()).includes('URL,') === false ? true : csv.ok(), {
    id: `QA-${label.toUpperCase()}-CSV`,
    severity: 'high',
    page: `/api/audit/${auditId}/csv`,
    feature: 'Audit CSV export',
    steps: 'Download CSV export',
    expected: 'CSV endpoint returns HTTP 200',
    actual: `Status ${csv.status()}`
  });
  const json = await page.request.get(`${BASE_URL}/api/audit/${auditId}/json`);
  check('Exports', `${label} audit JSON export`, json.ok() && (await json.text()).includes('"summary"'), {
    id: `QA-${label.toUpperCase()}-JSON`,
    severity: 'high',
    page: `/api/audit/${auditId}/json`,
    feature: 'Audit JSON export',
    steps: 'Download JSON export',
    expected: 'JSON endpoint returns full results',
    actual: `Status ${json.status()}`
  });
}

async function choosePickerItem(page, buttonSelector, selectId, itemId, screenshotName) {
  await page.click(buttonSelector);
  await page.waitForSelector('.site-dialog-overlay .picker-row', { timeout: 10000 });
  await screenshot(page, screenshotName);
  const input = page.locator(`.site-dialog-overlay .picker-row input[value="${itemId}"]`).first();
  await input.waitFor({ state: 'attached', timeout: 10000 });
  if (!(await input.isChecked())) {
    await input.check({ force: true });
  }
  await page.click('.site-dialog-overlay .site-dialog-confirm');
  await page.waitForSelector('.site-dialog-overlay', { state: 'detached', timeout: 10000 });
  await page.waitForFunction(({ selectId: targetSelectId, itemId: targetItemId }) => {
    const select = document.getElementById(targetSelectId);
    return Array.from(select?.selectedOptions || []).some((option) => option.value === targetItemId);
  }, { selectId, itemId }, { timeout: 10000 });
}

async function createAndRunAuditConfig(page, preTemplateId, postTemplateId, ruleSetId) {
  const name = `QA Audit Config ${RUN_ID}`;
  await visitAndScreenshot(page, '/audit-configs.html?new=1', 'audit config new');
  await page.fill('#configName', name);
  await page.fill('#configDescription', 'QA automated audit config');
  await page.fill('#configDomain', TARGET_URL);
  await page.fill('#configMaxPages', '2');
  await page.uncheck('#configShowBrowser');
  await page.selectOption('#configBrowserEngine', 'playwright');
  await page.selectOption('#configWorkerMode', 'ram-protected');
  await page.click('[data-tab="urls"]');
  await page.fill('#configUrlSources', `${TARGET_URL}/page-2`);
  await page.uncheck('#configIncludeSitemaps');
  await page.click('[data-tab="pre"]');
  await choosePickerItem(page, '#choosePreTemplates', 'preTemplateSelect', preTemplateId, 'audit config pre template picker');
  await page.click('[data-tab="post"]');
  await choosePickerItem(page, '#choosePostTemplates', 'postTemplateSelect', postTemplateId, 'audit config post template picker');
  await page.click('[data-tab="rules"]');
  await choosePickerItem(page, '#chooseRuleSets', 'ruleSetSelect', ruleSetId, 'audit config rule set picker');
  await screenshot(page, 'audit config populated');
  await page.click('#saveConfig');
  await page.waitForTimeout(700);
  const list = await apiJson(page, '/api/audit-configs');
  const item = (list.data.configs || []).find((config) => config.name === name);
  created.auditConfigId = item && item.id;
  check('Audit Configs', 'config saved with linked assets', Boolean(item), {
    id: 'QA-AUDIT-CONFIG-SAVE',
    severity: 'high',
    page: '/audit-configs.html',
    feature: 'Audit config save',
    steps: 'Create config with URL source, templates, and rule set',
    expected: 'Saved config appears in API list',
    actual: JSON.stringify(list.data).slice(0, 1000)
  });
  await page.click('#runConfig');
  await page.waitForFunction(() => new URLSearchParams(location.search).has('auditId'), null, { timeout: 15000 });
  created.configAuditId = await page.evaluate(() => new URLSearchParams(location.search).get('auditId'));
  await page.waitForSelector('#results:not(.hidden) .page', { timeout: 150000 });
  await screenshot(page, 'audit config run report');
  const detail = await apiJson(page, `/api/audits/${created.configAuditId}`);
  check('Audit Configs', 'config snapshot stored on run', Boolean(detail.data.configSnapshot && detail.data.configName), {
    id: 'QA-AUDIT-CONFIG-SNAPSHOT',
    severity: 'high',
    page: `/api/audits/${created.configAuditId}`,
    feature: 'Config snapshot persistence',
    steps: 'Run audit from saved config and read audit detail',
    expected: 'Audit detail includes configSnapshot and configName',
    actual: JSON.stringify(detail.data).slice(0, 1000)
  });
  await verifyAuditReportModalsAndExports(page, created.configAuditId, 'Config');

  await page.goto(`${BASE_URL}/audit-configs.html?id=${encodeURIComponent(created.auditConfigId)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#duplicateConfig');
  await page.click('#duplicateConfig');
  await page.waitForTimeout(700);
  await page.fill('#configDescription', 'QA edited duplicate before delete');
  await page.click('#saveConfig');
  await page.waitForTimeout(500);
  await page.click('#deleteConfig');
  await page.click('.site-dialog-confirm');
  await page.waitForTimeout(500);
  recordCheck('Audit Configs', 'duplicate/edit/delete duplicate smoke', 'PASS');
}

async function createAndRunInteraction(page, flowTemplateId, ruleSetId) {
  const name = `QA Interaction Config ${RUN_ID}`;
  await visitAndScreenshot(page, '/interaction-configs.html?new=1', 'interaction config new');
  await page.fill('#interactionName', name);
  await page.fill('#interactionDescription', 'QA automated interaction config');
  await page.fill('#interactionStartingUrl', TARGET_URL);
  await page.uncheck('#interactionShowBrowser');
  await page.click('[data-tab="templates"]');
  await page.locator(`#templateImportList input[value="${flowTemplateId}"]`).check();
  await page.click('#appendTemplateSteps');
  await page.click('[data-tab="steps"]');
  const manualSteps = [
    { name: 'Fill name', action: 'fillFormField', selector: '#qaName', value: 'QA User', timeout: '7000' },
    { name: 'Select beta', action: 'selectDropdownOption', selector: '#qaChoice', value: 'beta', timeout: '7000' },
    { name: 'Agree', action: 'checkCheckbox', selector: '#qaAgree', value: '', timeout: '7000' },
    { name: 'Submit form', action: 'click', selector: '#submitForm', value: '', timeout: '7000' },
    { name: 'Scroll deep', action: 'scroll', selector: '#deepSection', value: '', timeout: '7000' },
    { name: 'Push dataLayer', action: 'executeJavaScript', selector: '', value: "window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:'qa_interaction_js'}); console.warn('qa interaction js');", timeout: '7000' },
    { name: 'Switch iframe', action: 'switchToIFrame', selector: '#qaFrame', value: '', timeout: '7000' },
    { name: 'Click iframe button', action: 'click', selector: '#iframeButton', value: '', timeout: '7000' },
    { name: 'Back main', action: 'switchToMainFrame', selector: '', value: '', timeout: '7000' },
    { name: 'Assert result', action: 'assertElementText', selector: '#result', value: 'Submitted QA User', timeout: '7000' }
  ];
  for (const step of manualSteps) {
    await page.click('#addInteractionStep');
    const card = page.locator('#interactionSteps .journey-step-card').last();
    await card.locator('.journey-step-name').fill(step.name);
    await card.locator('.journey-action').selectOption(step.action);
    if (step.selector) await card.locator('.journey-selector').fill(step.selector);
    if (step.value) await card.locator('.journey-value').fill(step.value);
    await card.locator('.journey-timeout').fill(step.timeout);
  }
  await page.locator('#interactionSteps .journey-step-card').last().locator('.journey-snapshot').check();
  await page.click('[data-tab="rules"]');
  await page.locator(`#ruleSetImportList input[value="${ruleSetId}"]`).check();
  await screenshot(page, 'interaction config populated');
  await page.click('#runInteractionConfig');
  await page.waitForURL(/\/interaction-report\.html\?id=/, { timeout: 180000 });
  created.interactionRunId = await page.evaluate(() => new URLSearchParams(location.search).get('id'));
  await page.waitForSelector('#interactionStepResults .step-result-card, #interactionReportSummary', { timeout: 30000 });
  await screenshot(page, 'interaction report');
  const results = await apiJson(page, `/api/interaction-runs/${created.interactionRunId}/results`);
  const totalSteps = results.data?.summary?.totalSteps || 0;
  check('Interaction Configs', 'interaction run completed with expected step count', results.ok && totalSteps === 12, {
    id: 'QA-INTERACTION-DUPLICATE-TEMPLATE-STEPS',
    severity: 'high',
    page: '/interaction-configs.html',
    feature: 'Interaction template import/run',
    steps: 'Import a two-step flow template, append ten manual steps, run interaction',
    expected: 'Report summary totalSteps is 12: 2 imported + 10 manual',
    actual: `totalSteps=${totalSteps}, status=${results.data?.summary?.status}`,
    screenshot: screenshots[screenshots.length - 1],
    suspectedFile: 'src/interaction/interactionRunner.js, public/interaction-configs.js'
  });
  check('Interaction Configs', 'per-step capture includes network/console evidence', results.ok && (results.data.steps || []).some((step) => (step.networkRequests || []).length || (step.console || []).length), {
    id: 'QA-INTERACTION-NO-EVIDENCE',
    severity: 'high',
    page: '/interaction-report.html',
    feature: 'Interaction report evidence',
    steps: 'Run interaction and inspect step evidence',
    expected: 'At least one step contains network or console evidence',
    actual: JSON.stringify(results.data?.summary || {})
  });
  const json = await page.request.get(`${BASE_URL}/api/interaction-runs/${created.interactionRunId}/json`);
  check('Exports', 'interaction JSON export', json.ok() && (await json.text()).includes('"steps"'), {
    id: 'QA-INTERACTION-JSON',
    severity: 'high',
    page: `/api/interaction-runs/${created.interactionRunId}/json`,
    feature: 'Interaction JSON export',
    steps: 'Download interaction JSON',
    expected: 'Endpoint returns JSON results',
    actual: `Status ${json.status()}`
  });
  const csv = await page.request.get(`${BASE_URL}/api/interaction-runs/${created.interactionRunId}/csv`);
  check('Exports', 'interaction CSV export', csv.ok(), {
    id: 'QA-INTERACTION-CSV',
    severity: 'high',
    page: `/api/interaction-runs/${created.interactionRunId}/csv`,
    feature: 'Interaction CSV export',
    steps: 'Download interaction CSV',
    expected: 'Endpoint returns CSV',
    actual: `Status ${csv.status()}`
  });
  await visitAndScreenshot(page, '/interaction-runs.html', 'interaction runs history');
}

async function runOwnershipChecks(userBPage) {
  await loginUser(userBPage, created.userB.username, created.userB.password);
  const protectedItems = [
    ['audit config', `/api/audit-configs/${created.auditConfigId}`],
    ['pre template', `/api/action-templates/${created.preTemplateId}`],
    ['rule set', `/api/rule-sets/${created.ruleSetId}`],
    ['interaction config', `/api/interaction-configs/${created.interactionConfigId}`],
    ['audit detail', `/api/audits/${created.configAuditId}`],
    ['interaction run', `/api/interaction-runs/${created.interactionRunId}`]
  ].filter(([, route]) => !route.includes('null') && !route.includes('undefined'));
  for (const [label, route] of protectedItems) {
    const response = await apiJson(userBPage, route);
    check('Security/access control', `User B cannot access User A ${label}`, [401, 403, 404].includes(response.status), {
      id: `QA-OWNERSHIP-${slug(label).toUpperCase()}`,
      severity: 'blocker',
      page: route,
      feature: 'Ownership isolation',
      steps: `Login as User B and GET ${route}`,
      expected: '401, 403, or 404',
      actual: `Status ${response.status}; body ${JSON.stringify(response.data).slice(0, 300)}`
    });
  }
}

async function runUnauthorizedChecks() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const api = await page.request.get(`${BASE_URL}/api/audits?limit=1`);
    check('Authentication', 'unauthenticated API returns 401', api.status() === 401, {
      id: 'QA-UNAUTH-API',
      severity: 'blocker',
      page: '/api/audits',
      feature: 'Protected API',
      steps: 'GET /api/audits without a session',
      expected: '401 Unauthorized',
      actual: `Status ${api.status()}`
    });
    await page.goto(`${BASE_URL}/dashboard.html`, { waitUntil: 'domcontentloaded' });
    check('Authentication', 'unauthenticated page redirects to login', /\/login$/.test(page.url()), {
      id: 'QA-UNAUTH-PAGE',
      severity: 'blocker',
      page: '/dashboard.html',
      feature: 'Protected page redirect',
      steps: 'Open dashboard without a session',
      expected: 'Redirect to /login',
      actual: page.url()
    });
  } finally {
    await browser.close();
  }
}

async function runMain() {
  const targetServer = await startTargetServer();
  const appProcess = startAppServer();
  let browser;
  try {
    await waitForHttp(`${BASE_URL}/api/health`);
    await runUnauthorizedChecks();
    browser = await chromium.launch({ headless: HEADLESS });
    const contextA = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await contextA.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    monitorPage(page);

    const suffix = Date.now().toString(36).slice(-7);
    created.userA = { username: `qaa${suffix}`, password: `QaPass${suffix}!` };
    created.userB = { username: `qab${suffix}`, password: `QbPass${suffix}!` };
    await registerUser(page, created.userA.username, created.userA.password, 'QA User A');
    await visitAndScreenshot(page, '/', 'config launcher');

    const pages = [
      ['/dashboard.html', 'dashboard'],
      ['/?scratch=1', 'create audit'],
      ['/audits.html', 'audit history'],
      ['/audit-configs.html', 'audit configs'],
      ['/action-templates.html?type=pre', 'pre-audit actions'],
      ['/action-templates.html?type=post', 'post-audit actions'],
      ['/rule-sets.html', 'rules'],
      ['/interaction-configs.html', 'interaction configs'],
      ['/interaction-flow-templates.html', 'interaction flow templates'],
      ['/interaction-runs.html', 'interaction runs'],
      ['/settings.html', 'settings']
    ];
    for (const [route, name] of pages) await visitAndScreenshot(page, route, name);
    await page.setViewportSize({ width: 390, height: 844 });
    await visitAndScreenshot(page, '/dashboard.html', 'mobile dashboard');
    await visitAndScreenshot(page, '/?scratch=1', 'mobile create audit');
    await page.setViewportSize({ width: 1440, height: 1000 });

    created.preTemplateId = await createActionTemplate(page, 'pre', `QA Pre Template ${RUN_ID}`, 'Accept local consent', [
      { action: 'waitForSelector', selector: '#acceptCookies', timeout: 5000 },
      { action: 'click', selector: '#acceptCookies', timeout: 5000 },
      { action: 'executeJavaScript', value: "window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:'qa_pre_template'});" }
    ]);
    created.postTemplateId = await createActionTemplate(page, 'post', `QA Post Template ${RUN_ID}`, 'Post-page dataLayer marker', [
      { action: 'executeJavaScript', value: "window.dataLayer=window.dataLayer||[]; window.dataLayer.push({event:'qa_post_template'}); console.info('qa post template');" },
      { action: 'scroll' }
    ]);
    created.ruleSetId = await createRuleSet(page, `QA Rule Set ${RUN_ID}`);
    created.flowTemplateId = await createFlowTemplate(page, `QA Flow Template ${RUN_ID}`);
    await verifyApplyToCreateAudit(page, created.preTemplateId, created.ruleSetId, created.flowTemplateId);
    await runScratchAudit(page);
    await visitAndScreenshot(page, '/audits.html', 'audit history after scratch');
    await createAndRunAuditConfig(page, created.preTemplateId, created.postTemplateId, created.ruleSetId);
    await createAndRunInteraction(page, created.flowTemplateId, created.ruleSetId);
    const interactionConfigs = await apiJson(page, '/api/interaction-configs');
    const interactionConfig = (interactionConfigs.data.configs || []).find((config) => config.name === `QA Interaction Config ${RUN_ID}`);
    created.interactionConfigId = interactionConfig && interactionConfig.id;

    await logoutViaUi(page);

    const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const pageB = await contextB.newPage();
    monitorPage(pageB);
    await registerUser(pageB, created.userB.username, created.userB.password, 'QA User B');
    await logoutViaUi(pageB);
    await runOwnershipChecks(pageB);
    await contextB.close();
  } finally {
    if (browser) await browser.close();
    appProcess.kill();
    targetServer.close();
    writeReports();
  }
}

function writeReports() {
  const severe = issues.filter((issue) => ['blocker', 'high'].includes(issue.severity));
  const issueLines = [
    '# QA Issues',
    '',
    `Run ID: ${RUN_ID}`,
    `Screenshots: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`,
    '',
  ];
  if (!issues.length) {
    issueLines.push('No reproducible issues were found in this run.', '');
  } else {
    for (const issue of issues) {
      issueLines.push(`## ${issue.id} - ${issue.severity.toUpperCase()} - ${issue.feature || issue.page}`);
      issueLines.push('');
      issueLines.push(`- Page/feature: ${issue.page || issue.feature}`);
      issueLines.push(`- Steps to reproduce: ${issue.steps}`);
      issueLines.push(`- Expected: ${issue.expected}`);
      issueLines.push(`- Actual: ${issue.actual}`);
      issueLines.push(`- Screenshot: ${issue.screenshot || 'n/a'}`);
      issueLines.push(`- Console/network: ${issue.consoleOrNetwork || 'n/a'}`);
      issueLines.push(`- Suspected file/function: ${issue.suspectedFile || 'n/a'}`);
      issueLines.push(`- Fix applied: ${issue.fixApplied}`);
      issueLines.push(`- Retest result: ${issue.retest}`);
      issueLines.push('');
    }
  }
  fs.writeFileSync(path.join(ROOT, 'QA_ISSUES.md'), issueLines.join('\n'), 'utf8');

  const checkRows = checks.map((check) => `| ${check.area} | ${check.name} | ${check.status} | ${String(check.details || '').replace(/\|/g, '/')} |`);
  const summaryLines = [
    '# QA Regression Summary',
    '',
    `Run ID: ${RUN_ID}`,
    `Date: ${new Date().toISOString()}`,
    `App URL: ${BASE_URL}`,
    `Target URL: ${TARGET_URL}`,
    `Browser mode: ${HEADLESS ? 'headless Playwright Chromium' : 'headed Playwright Chromium'}`,
    `Screenshot folder: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`,
    '',
    '## Result',
    '',
    `- Checks executed: ${checks.length}`,
    `- Issues found: ${issues.length}`,
    `- Blocker/high issues: ${severe.length}`,
    `- Screenshots captured: ${screenshots.length}`,
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
    ...checkRows,
    '',
    '## Screenshots',
    '',
    ...screenshots.map((shot) => `- ${shot}`),
    ''
  ];
  fs.writeFileSync(path.join(ROOT, 'QA_REGRESSION_SUMMARY.md'), summaryLines.join('\n'), 'utf8');
}

runMain().then(() => {
  const severe = issues.filter((issue) => ['blocker', 'high'].includes(issue.severity));
  if (severe.length) {
    console.error(`QA failed with ${severe.length} blocker/high issue(s). See QA_ISSUES.md`);
    process.exit(1);
  }
  console.log('QA passed without blocker/high issues. See QA_REGRESSION_SUMMARY.md');
}).catch((error) => {
  addIssue({
    id: 'QA-HARNESS-ERROR',
    severity: 'blocker',
    feature: 'QA harness',
    steps: 'Run deep regression harness',
    expected: 'Harness completes and writes reports',
    actual: error && error.stack ? error.stack : String(error),
    suspectedFile: 'tests/qa/deep-regression.js'
  });
  writeReports();
  console.error(error);
  process.exit(1);
});
