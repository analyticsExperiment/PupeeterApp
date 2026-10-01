const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_PHASE2_APP_PORT || 3310);
const TARGET_PORT = Number(process.env.QA_PHASE2_TARGET_PORT || 4590);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const OUTPUT_DIR = path.join(ROOT, 'output', 'playwright', `qa-phase2-${RUN_ID}`);
const SAFE_EXTERNAL_URL = process.env.QA_PHASE2_EXTERNAL_URL || 'https://example.com';

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const checks = [];
const issues = [];
const screenshots = [];
const created = {
  userA: null,
  userB: null,
  preTemplateId: null,
  postTemplateId: null,
  ruleSetId: null,
  flowTemplateId: null,
  auditConfigId: null,
  interactionConfigId: null,
  auditRunIds: [],
  interactionRunIds: []
};

function slug(value) {
  return String(value || 'artifact').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

function recordCheck(area, name, status, details = '') {
  checks.push({ area, name, status, details });
}

function addIssue(issue) {
  const id = issue.id || `P2-${String(issues.length + 1).padStart(3, '0')}`;
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

function qaPage({ title, body, script = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.4; margin: 24px; }
    form, section { margin-top: 18px; }
    iframe { width: 420px; max-width: 100%; height: 130px; border: 1px solid #bbb; }
    #deepSection { margin-top: 850px; padding: 20px; background: #f4f4f4; }
  </style></head><body>
    ${body}
    <script>${script}</script>
  </body></html>`;
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
  <url><loc>${TARGET_URL}/console-warning</loc></url>
</urlset>`);
    }
    if (url.pathname === '/api/local-pixel') {
      return send(200, 'application/json', JSON.stringify({ ok: true, event: url.searchParams.get('event') || '' }));
    }
    if (url.pathname === '/collect') return send(204, 'text/plain', '');
    if (url.pathname === '/slow') {
      setTimeout(() => send(200, 'text/html', qaPage({ title: 'QA Slow Target', body: '<h1>Slow but valid</h1>' })), 1800);
      return;
    }
    if (url.pathname === '/iframe') {
      return send(200, 'text/html', qaPage({
        title: 'QA IFrame',
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
    if (url.pathname === '/console-warning') {
      return send(200, 'text/html', qaPage({
        title: 'QA Console Warning',
        body: '<h1>QA Console Warning</h1>',
        script: `
          console.warn('qa intentional warning');
          fetch('/api/local-pixel?event=warning_page');
          fetch('/missing-resource-for-negative-test').catch(() => {});
        `
      }));
    }
    return send(200, 'text/html', qaPage({
      title: 'QA Target Home',
      body: `
        <h1>QA Target Home</h1>
        <button id="acceptCookies">Accept Cookies</button>
        <a id="pageTwoLink" href="/page-2">Page Two</a>
        <a id="slowLink" href="/slow">Slow Page</a>
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
        new Image().src = 'https://www.google-analytics.com/collect?v=1&t=pageview&tid=UA-PHASE2-1&cid=phase2';
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
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `qa-phase2-${RUN_ID}` },
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
    if (requestUrl.startsWith(BASE_URL)) {
      const errorText = request.failure()?.errorText || '';
      const pathName = (() => {
        try { return new URL(requestUrl).pathname; } catch (_) { return ''; }
      })();
      if (errorText === 'net::ERR_ABORTED' && ['/auth/me', '/api/auth/me'].includes(pathName)) return;
      page.__qaEvents.push({ type: 'requestfailed', text: `${requestUrl} ${errorText}`, url: page.url() });
    }
  });
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

async function registerUser(page, username, password, displayName) {
  await page.goto(`${BASE_URL}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#displayName', displayName);
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.fill('#confirmPassword', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForSelector('.container', { timeout: 15000 });
  recordCheck('Authentication', `registered ${username}`, 'PASS');
}

async function loginUser(page, username, password) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForSelector('.container', { timeout: 15000 });
  recordCheck('Authentication', `logged in ${username}`, 'PASS');
}

async function logoutViaUi(page) {
  await page.click('[data-action="logout"]');
  await page.waitForURL(/\/login$/, { timeout: 15000 });
}

async function expectDialog(page, action, pattern, label, issue) {
  const dialogPromise = page.waitForEvent('dialog', { timeout: 3000 }).then(async (dialog) => {
    const message = dialog.message();
    await dialog.dismiss();
    return message;
  }).catch(() => null);
  await action();
  const message = await dialogPromise;
  check('Edge validation', label, Boolean(message && (!pattern || pattern.test(message))), {
    ...issue,
    actual: message || 'No dialog appeared'
  });
}

async function createActionTemplate(page, type, name, steps) {
  const res = await apiJson(page, '/api/action-templates', {
    method: 'POST',
    body: { name, description: `Phase 2 ${type} template`, type, steps }
  });
  if (!res.ok) throw new Error(`Failed to create ${type} template: ${res.status} ${res.text}`);
  return res.data.template.id;
}

async function createRuleSet(page, name) {
  const rules = [
    {
      name: 'Phase 2 title passes',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'QA Target' }]
    },
    {
      name: 'Phase 2 title intentionally fails',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'pageField', field: 'pageTitle', operator: 'contains', value: 'Never Matches Phase 2' }]
    },
    {
      name: 'Phase 2 not applied condition',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: '/not-a-real-phase2-page' }],
      assertions: [{ type: 'cookie', field: 'name', operator: 'contains', value: 'qa_session' }]
    },
    {
      name: 'Phase 2 request captured',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'requestUrl', field: 'url', operator: 'contains', value: '/api/local-pixel' }]
    },
    {
      name: 'Phase 2 cookie captured',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'cookie', field: 'name', operator: 'contains', value: 'qa_session' }]
    },
    {
      name: 'Phase 2 dataLayer captured',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'dataLayer', field: 'event', operator: 'contains', value: 'qa_page_view' }]
    },
    {
      name: 'Phase 2 console captured',
      whenMode: 'all',
      expectMode: 'all',
      evaluationLimit: 10,
      conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
      assertions: [{ type: 'console', field: 'info', operator: 'contains', value: 'qa target home loaded' }]
    }
  ];
  const res = await apiJson(page, '/api/rule-sets', {
    method: 'POST',
    body: { name, description: 'Phase 2 mixed pass/fail/not-applied rules', rules }
  });
  if (!res.ok) throw new Error(`Failed to create rule set: ${res.status} ${res.text}`);
  return res.data.ruleSet.id;
}

async function createFlowTemplate(page, name) {
  const steps = [
    { name: 'Wait for consent button', action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 },
    { name: 'Click consent button', action: 'click', selector: '#acceptCookies', timeout: 7000 }
  ];
  const res = await apiJson(page, '/api/interaction-flow-templates', {
    method: 'POST',
    body: { name, description: 'Phase 2 interaction flow template', steps }
  });
  if (!res.ok) throw new Error(`Failed to create flow template: ${res.status} ${res.text}`);
  return res.data.template.id;
}

async function createAuditConfig(page, name) {
  const res = await apiJson(page, '/api/audit-configs', {
    method: 'POST',
    body: {
      name,
      description: 'Phase 2 audit config',
      domain: TARGET_URL,
      maxPages: 2,
      sameOriginOnly: true,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      urlSources: [`${TARGET_URL}/page-2`],
      includeSitemaps: false,
      options: { browserEngine: 'playwright', workerMode: 'ram-protected', simultaneousWorkers: 2 },
      preActionTemplateIds: [created.preTemplateId],
      postActionTemplateIds: [created.postTemplateId],
      ruleSetIds: [created.ruleSetId]
    }
  });
  if (!res.ok) throw new Error(`Failed to create audit config: ${res.status} ${res.text}`);
  created.auditConfigId = res.data.config.id;
  return res.data.config.id;
}

async function createInteractionConfig(page, name, steps, extra = {}) {
  const res = await apiJson(page, '/api/interaction-configs', {
    method: 'POST',
    body: {
      name,
      description: 'Phase 2 interaction config',
      startingUrl: TARGET_URL,
      waitUntil: extra.waitUntil || 'domcontentloaded',
      showBrowser: false,
      generalSettings: { browserEngine: 'playwright', stopOnStepFailure: extra.stopOnStepFailure !== false, defaultTimeoutMs: 10000, navigationTimeoutMs: 15000 },
      steps,
      flowTemplateIds: extra.flowTemplateIds || [],
      ruleSetIds: extra.ruleSetIds || []
    }
  });
  if (!res.ok) throw new Error(`Failed to create interaction config: ${res.status} ${res.text}`);
  if (!created.interactionConfigId) created.interactionConfigId = res.data.config.id;
  return res.data.config.id;
}

async function pollAudit(page, id, timeoutMs = 120000) {
  const started = Date.now();
  let status = null;
  while (Date.now() - started < timeoutMs) {
    status = await apiJson(page, `/api/audit/${id}/status`);
    if (status.ok && ['completed', 'failed'].includes(status.data.status)) break;
    await page.waitForTimeout(700);
  }
  const detail = await apiJson(page, `/api/audit/${id}`);
  const results = await apiJson(page, `/api/audit/${id}/results`);
  return { status: status.data?.status || detail.data?.status, detail, results };
}

async function startAudit(page, payload, label, expectCompleted = true) {
  const res = await apiJson(page, '/api/audit/start', { method: 'POST', body: payload });
  check('Advanced audit runner', `${label} start accepted`, res.ok, {
    id: `P2-AUDIT-START-${slug(label).toUpperCase()}`,
    severity: 'high',
    page: '/api/audit/start',
    feature: 'Audit start',
    steps: `Start ${label}`,
    expected: 'Audit start endpoint returns id',
    actual: `${res.status} ${res.text}`,
    suspectedFile: 'server.js'
  });
  if (!res.ok) return null;
  created.auditRunIds.push(res.data.id);
  const run = await pollAudit(page, res.data.id, payload.navigationTimeoutMs ? Math.max(45000, payload.navigationTimeoutMs + 20000) : 120000);
  const okStatus = expectCompleted ? run.status === 'completed' : ['completed', 'failed'].includes(run.status);
  check('Advanced audit runner', `${label} finishes gracefully`, okStatus, {
    id: `P2-AUDIT-FINISH-${slug(label).toUpperCase()}`,
    severity: 'high',
    page: `/api/audit/${res.data.id}`,
    feature: 'Audit runner status',
    steps: `Poll ${label} until terminal state`,
    expected: expectCompleted ? 'completed' : 'completed or failed with stored error',
    actual: JSON.stringify(run.detail.data || run.status).slice(0, 1000)
  });
  return { id: res.data.id, ...run };
}

async function runConfigAudit(page, configId, label) {
  const res = await apiJson(page, `/api/audit-configs/${configId}/run`, { method: 'POST', body: {} });
  if (!res.ok) throw new Error(`Config audit failed to start: ${res.status} ${res.text}`);
  created.auditRunIds.push(res.data.id);
  const run = await pollAudit(page, res.data.id, 120000);
  check('Performance/stability', `${label} config audit completes`, run.status === 'completed', {
    id: `P2-CONFIG-AUDIT-${slug(label).toUpperCase()}`,
    severity: 'high',
    page: `/api/audit/${res.data.id}`,
    feature: 'Config audit stability',
    steps: `Run config audit ${label}`,
    expected: 'completed',
    actual: JSON.stringify(run.detail.data || {}).slice(0, 1000)
  });
  return { id: res.data.id, ...run };
}

async function pollInteraction(page, id, timeoutMs = 120000) {
  const started = Date.now();
  let status = null;
  while (Date.now() - started < timeoutMs) {
    status = await apiJson(page, `/api/interaction-runs/${id}/status`);
    if (status.ok && ['completed', 'failed'].includes(status.data.status)) break;
    await page.waitForTimeout(700);
  }
  const detail = await apiJson(page, `/api/interaction-runs/${id}`);
  const results = await apiJson(page, `/api/interaction-runs/${id}/results`);
  return { status: status.data?.status || detail.data?.status, detail, results };
}

async function runInteractionConfig(page, configId, label, expectStatus = 'completed') {
  const res = await apiJson(page, `/api/interaction-configs/${configId}/run`, { method: 'POST', body: {} });
  if (!res.ok) throw new Error(`Interaction failed to start: ${res.status} ${res.text}`);
  created.interactionRunIds.push(res.data.id);
  const run = await pollInteraction(page, res.data.id, 120000);
  check('Advanced interaction runner', `${label} terminal status`, run.status === expectStatus, {
    id: `P2-INTERACTION-${slug(label).toUpperCase()}`,
    severity: 'high',
    page: `/api/interaction-runs/${res.data.id}`,
    feature: 'Interaction runner status',
    steps: `Run interaction ${label}`,
    expected: expectStatus,
    actual: JSON.stringify(run.detail.data || {}).slice(0, 1000)
  });
  return { id: res.data.id, ...run };
}

async function runEdgeValidation(page) {
  await page.goto(`${BASE_URL}/?scratch=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#auditForm:not(.hidden) button[type="submit"]', { timeout: 10000 });
  await expectDialog(page, () => page.click('#auditForm button[type="submit"]'), /domain|url/i, 'create audit blocks empty target', {
    id: 'P2-UI-CREATE-AUDIT-EMPTY',
    severity: 'medium',
    page: '/?scratch=1',
    feature: 'Create Audit validation',
    steps: 'Click Start Audit with empty domain and starting URL',
    expected: 'Clear validation dialog'
  });

  const uiForms = [
    { route: '/audit-configs.html?new=1', click: '#saveConfig', pattern: /config name/i, label: 'audit config blocks empty name' },
    { route: '/action-templates.html?type=pre&new=1', click: '#saveTemplate', pattern: /template name/i, label: 'action template blocks empty name' },
    { route: '/rule-sets.html?new=1', click: '#saveRuleSet', pattern: /rule set name/i, label: 'rule set blocks empty name' },
    { route: '/interaction-flow-templates.html?new=1', click: '#saveTemplate', pattern: /flow name/i, label: 'flow template blocks empty name' },
    { route: '/interaction-configs.html?new=1', click: '#saveInteractionConfig', pattern: /interaction config name/i, label: 'interaction config blocks empty name' }
  ];
  for (const item of uiForms) {
    await page.goto(`${BASE_URL}${item.route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(item.click, { timeout: 10000 });
    await expectDialog(page, () => page.click(item.click), item.pattern, item.label, {
      id: `P2-UI-${slug(item.label).toUpperCase()}`,
      severity: 'medium',
      page: item.route,
      feature: 'Form validation',
      steps: `Save ${item.route} without required fields`,
      expected: 'Clear validation dialog'
    });
  }

  const apiCases = [
    { route: '/api/audit/start', body: {}, label: 'audit start rejects empty payload' },
    { route: '/api/audit-configs', body: { name: '', domain: TARGET_URL }, label: 'audit config API rejects empty name' },
    { route: '/api/action-templates', body: { name: '', type: 'pre', steps: [] }, label: 'action template API rejects empty name' },
    { route: '/api/rule-sets', body: { name: '', rules: [] }, label: 'rule set API rejects empty name' },
    { route: '/api/interaction-flow-templates', body: { name: '', steps: [] }, label: 'flow template API rejects empty name' },
    { route: '/api/interaction-configs', body: { name: '', startingUrl: TARGET_URL, steps: [] }, label: 'interaction config API rejects empty name' },
    { route: '/api/interaction-configs', body: { name: 'Missing URL', startingUrl: '', steps: [] }, label: 'interaction config API rejects empty starting URL' }
  ];
  for (const item of apiCases) {
    const before = await apiJson(page, item.route.replace('/api/', '/api/').split('?')[0].includes(':') ? item.route : item.route, { method: 'POST', body: item.body });
    check('Edge validation', item.label, before.status >= 400 && before.status < 500, {
      id: `P2-API-${slug(item.label).toUpperCase()}`,
      severity: 'medium',
      page: item.route,
      feature: 'API validation',
      steps: `POST ${item.route} with ${JSON.stringify(item.body)}`,
      expected: '4xx JSON error and no usable record',
      actual: `${before.status} ${before.text}`,
      suspectedFile: 'server.js, src/db.js'
    });
  }

  const longName = `Phase 2 Long ${'x'.repeat(260)} <script>alert(1)</script>`;
  const longRes = await apiJson(page, '/api/audit-configs', {
    method: 'POST',
    body: { name: longName, description: 'special chars <>&"\' and unicode-ish ascii only', domain: TARGET_URL, maxPages: -20, options: { browserEngine: 'playwright' } }
  });
  check('Edge validation', 'negative maxPages normalizes without corrupting config', longRes.ok && longRes.data.config.maxPages >= 1, {
    id: 'P2-NUMERIC-MAXPAGES-NEGATIVE',
    severity: 'medium',
    page: '/api/audit-configs',
    feature: 'Numeric validation',
    steps: 'Create config with negative maxPages and special character text',
    expected: 'Config is either rejected or normalized to at least 1',
    actual: `${longRes.status} ${longRes.text}`,
    suspectedFile: 'src/db.js'
  });
}

async function runAdvancedAudits(page) {
  const base = {
    domain: TARGET_URL,
    maxPages: 2,
    sameOriginOnly: true,
    headless: true,
    waitUntil: 'domcontentloaded',
    browserEngine: 'playwright',
    workerMode: 'ram-protected',
    simultaneousWorkers: 2,
    navigationTimeoutMs: 20000,
    findPagesInSitemaps: false,
    rules: []
  };
  await startAudit(page, { ...base, maxPages: 1 }, 'no actions');
  await startAudit(page, { ...base, maxPages: 1, preAuditActions: [{ action: 'click', selector: '#acceptCookies', timeout: 7000 }] }, 'pre actions only');
  await startAudit(page, { ...base, maxPages: 1, postAuditActions: [{ action: 'executeJavaScript', value: "window.dataLayer.push({event:'phase2_post_only'});" }] }, 'post actions only');
  const mixed = await startAudit(page, {
    ...base,
    maxPages: 3,
    startingUrls: [`${TARGET_URL}/page-2`, `${TARGET_URL}/console-warning`],
    findPagesInSitemaps: true,
    sameOriginOnly: false,
    waitUntil: 'load',
    preAuditActions: [{ action: 'click', selector: '#acceptCookies', timeout: 7000 }],
    postAuditActions: [{ action: 'executeJavaScript', value: "window.dataLayer.push({event:'phase2_both'});" }],
    rules: (await apiJson(page, `/api/rule-sets/${created.ruleSetId}`)).data.ruleSet.rules
  }, 'combined actions urls sitemap rules');
  if (mixed?.results?.ok) {
    const ruleStatuses = (mixed.results.data.pages || []).flatMap((pageResult) => pageResult.ruleResults || []).map((rule) => rule.status);
    check('Advanced audit runner', 'pass fail and skipped rule states are represented', ['passed', 'failed', 'skipped'].every((status) => ruleStatuses.includes(status)), {
      id: 'P2-AUDIT-RULE-STATES',
      severity: 'high',
      page: `/api/audit/${mixed.id}/results`,
      feature: 'Rule evaluation states',
      steps: 'Run mixed rules against local target',
      expected: 'passed, failed, and skipped statuses appear',
      actual: JSON.stringify(ruleStatuses)
    });
    const csv = await page.request.get(`${BASE_URL}/api/audit/${mixed.id}/csv`);
    const json = await page.request.get(`${BASE_URL}/api/audit/${mixed.id}/json`);
    check('Advanced audit runner', 'mixed audit exports work', csv.ok() && json.ok(), {
      id: 'P2-AUDIT-MIXED-EXPORTS',
      severity: 'high',
      page: `/api/audit/${mixed.id}`,
      feature: 'Audit exports',
      steps: 'Download CSV and JSON for mixed audit',
      expected: 'Both endpoints return 200',
      actual: `csv=${csv.status()} json=${json.status()}`
    });
  }
}

async function runAdvancedInteractions(page) {
  const emptyId = await createInteractionConfig(page, `Phase 2 Empty Journey ${RUN_ID}`, []);
  const emptyRun = await runInteractionConfig(page, emptyId, 'empty journey');
  check('Advanced interaction runner', 'empty journey returns readable zero-step report', emptyRun.results.ok && emptyRun.results.data.summary.totalSteps === 0, {
    id: 'P2-INTERACTION-EMPTY-JOURNEY',
    severity: 'medium',
    page: `/api/interaction-runs/${emptyRun.id}/results`,
    feature: 'Empty interaction journey',
    steps: 'Run interaction config with no steps',
    expected: 'Completed report with totalSteps 0',
    actual: `${emptyRun.results.status} ${emptyRun.results.text}`
  });

  const singleId = await createInteractionConfig(page, `Phase 2 Single Step ${RUN_ID}`, [
    { name: 'Wait home', action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 }
  ]);
  await runInteractionConfig(page, singleId, 'single step');

  const multiSteps = [
    { name: 'Template consent wait', action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 },
    { name: 'Disabled placeholder', action: 'click', selector: '#doesNotMatter', timeout: 1000, enabled: false },
    { name: 'Click consent', action: 'click', selector: '#acceptCookies', timeout: 7000 },
    { name: 'Fill name', action: 'fillFormField', selector: '#qaName', value: 'Phase Two', timeout: 7000 },
    { name: 'Select beta', action: 'selectDropdownOption', selector: '#qaChoice', value: 'beta', timeout: 7000 },
    { name: 'Agree', action: 'checkCheckbox', selector: '#qaAgree', timeout: 7000 },
    { name: 'Submit form', action: 'click', selector: '#submitForm', timeout: 7000 },
    { name: 'Wait for network idle', action: 'waitForNetworkIdle', timeout: 5000 },
    { name: 'Execute JS', action: 'executeJavaScript', value: "window.dataLayer.push({event:'phase2_interaction_js'}); console.warn('phase2 interaction warning');", timeout: 7000 },
    { name: 'Switch iframe', action: 'switchToIFrame', selector: '#qaFrame', timeout: 7000 },
    { name: 'Click iframe', action: 'click', selector: '#iframeButton', timeout: 7000 },
    { name: 'Back main', action: 'switchToMainFrame', timeout: 7000 },
    { name: 'Assert result', action: 'assertElementText', selector: '#result', value: 'Submitted Phase Two', timeout: 7000 },
    { name: 'Navigate page two', action: 'navigate', value: `${TARGET_URL}/page-2`, timeout: 10000 },
    { name: 'Wait for navigation state', action: 'waitForNavigation', timeout: 7000 },
    { name: 'Assert URL', action: 'assertUrlContains', value: '/page-2', timeout: 7000, captureStepSnapshot: true }
  ];
  const multiId = await createInteractionConfig(page, `Phase 2 Multi Step ${RUN_ID}`, multiSteps, { ruleSetIds: [created.ruleSetId] });
  created.interactionConfigId = multiId;
  const multiRun = await runInteractionConfig(page, multiId, 'multi step with failing rules', 'failed');
  if (multiRun.results.ok) {
    const steps = multiRun.results.data.steps || [];
    check('Advanced interaction runner', 'disabled iframe js navigation evidence is readable', steps.some((step) => step.status === 'skipped') && steps.some((step) => step.action === 'switchToIFrame') && steps.some((step) => (step.console || []).length || (step.networkRequests || []).length), {
      id: 'P2-INTERACTION-EVIDENCE-STATES',
      severity: 'high',
      page: `/api/interaction-runs/${multiRun.id}/results`,
      feature: 'Interaction step evidence',
      steps: 'Run multi-step journey with disabled, iframe, JS, navigation and rules',
      expected: 'Skipped step plus evidence-bearing steps are present',
      actual: JSON.stringify(multiRun.results.data.summary)
    });
    check('Advanced interaction runner', 'interaction failed-rule status is explicit', multiRun.results.data.summary.failedRules > 0 && multiRun.results.data.summary.passedRules > 0 && steps.every((step) => step.status !== 'failed'), {
      id: 'P2-INTERACTION-RULE-FAIL-STATUS',
      severity: 'high',
      page: `/api/interaction-runs/${multiRun.id}/results`,
      feature: 'Interaction rule result reporting',
      steps: 'Run multi-step journey with intentionally mixed pass/fail rules',
      expected: 'Run status is failed because rules failed, while journey steps remain readable',
      actual: JSON.stringify(multiRun.results.data.summary)
    });
    const csv = await page.request.get(`${BASE_URL}/api/interaction-runs/${multiRun.id}/csv`);
    const json = await page.request.get(`${BASE_URL}/api/interaction-runs/${multiRun.id}/json`);
    check('Advanced interaction runner', 'multi interaction exports work', csv.ok() && json.ok(), {
      id: 'P2-INTERACTION-EXPORTS',
      severity: 'high',
      page: `/api/interaction-runs/${multiRun.id}`,
      feature: 'Interaction exports',
      steps: 'Download CSV and JSON for multi-step interaction',
      expected: 'Both endpoints return 200',
      actual: `csv=${csv.status()} json=${json.status()}`
    });
  }

  const failedId = await createInteractionConfig(page, `Phase 2 Failed Selector ${RUN_ID}`, [
    { name: 'Missing selector', action: 'click', selector: '#not-present-phase2', timeout: 1200 }
  ]);
  const failedRun = await runInteractionConfig(page, failedId, 'failed selector', 'failed');
  check('Advanced interaction runner', 'failed selector report contains clear error', failedRun.results.ok && /not-present-phase2|timeout/i.test(JSON.stringify(failedRun.results.data)), {
    id: 'P2-INTERACTION-FAILED-SELECTOR-ERROR',
    severity: 'high',
    page: `/api/interaction-runs/${failedRun.id}/results`,
    feature: 'Failed step error reporting',
    steps: 'Run click step against missing selector',
    expected: 'Failed report includes selector/timeout details',
    actual: `${failedRun.results.status} ${failedRun.results.text}`.slice(0, 1000)
  });
}

async function runPersistence(page, appProcessRef) {
  appProcessRef.child.kill();
  await new Promise((resolve) => appProcessRef.child.once('exit', resolve));
  appProcessRef.child = startAppServer();
  await waitForHttp(`${BASE_URL}/api/health`, 30000);
  await loginUser(page, created.userA.username, created.userA.password);

  const endpoints = [
    ['/api/audit-configs', 'configs', created.auditConfigId],
    ['/api/action-templates?type=pre', 'templates', created.preTemplateId],
    ['/api/action-templates?type=post', 'templates', created.postTemplateId],
    ['/api/rule-sets', 'ruleSets', created.ruleSetId],
    ['/api/interaction-flow-templates', 'templates', created.flowTemplateId],
    ['/api/interaction-configs', 'configs', created.interactionConfigId],
    ['/api/audits?limit=50', 'audits', created.auditRunIds[0]],
    ['/api/interaction-runs?limit=50', 'runs', created.interactionRunIds[0]]
  ];
  for (const [route, key, id] of endpoints) {
    const res = await apiJson(page, route);
    const rows = res.data?.[key] || [];
    check('Data persistence', `${route} persists after restart`, res.ok && rows.some((row) => row.id === id), {
      id: `P2-PERSIST-${slug(route).toUpperCase()}`,
      severity: 'high',
      page: route,
      feature: 'Persistence after restart',
      steps: 'Restart app and list created records',
      expected: `Record ${id} is still listed`,
      actual: `${res.status} ${res.text}`.slice(0, 1000)
    });
  }

  const auditId = created.auditRunIds.find(Boolean);
  const interactionId = created.interactionRunIds.find(Boolean);
  const auditJson = auditId ? await page.request.get(`${BASE_URL}/api/audit/${auditId}/json`) : null;
  const interactionJson = interactionId ? await page.request.get(`${BASE_URL}/api/interaction-runs/${interactionId}/json`) : null;
  check('Data persistence', 'stored reports and exports open after restart', auditJson?.ok() && interactionJson?.ok(), {
    id: 'P2-PERSIST-EXPORTS',
    severity: 'high',
    page: '/api/audit/:id/json /api/interaction-runs/:id/json',
    feature: 'Stored report exports',
    steps: 'Download exports after server restart',
    expected: 'Audit and interaction JSON exports return 200',
    actual: `audit=${auditJson?.status()} interaction=${interactionJson?.status()}`
  });
}

async function runSecurity(browser) {
  const userBContext = await browser.newContext();
  const userBPage = await userBContext.newPage();
  monitorPage(userBPage);
  await registerUser(userBPage, created.userB.username, created.userB.password, 'Phase 2 User B');

  const protectedRoutes = [
    [`/api/audit-configs/${created.auditConfigId}`, 'audit config'],
    [`/api/action-templates/${created.preTemplateId}`, 'pre template'],
    [`/api/action-templates/${created.postTemplateId}`, 'post template'],
    [`/api/rule-sets/${created.ruleSetId}`, 'rule set'],
    [`/api/interaction-flow-templates/${created.flowTemplateId}`, 'flow template'],
    [`/api/interaction-configs/${created.interactionConfigId}`, 'interaction config'],
    [`/api/audit/${created.auditRunIds[0]}`, 'audit detail'],
    [`/api/audit/${created.auditRunIds[0]}/results`, 'audit results'],
    [`/api/audit/${created.auditRunIds[0]}/json`, 'audit json export'],
    [`/api/audit/${created.auditRunIds[0]}/csv`, 'audit csv export'],
    [`/api/audit/${created.auditRunIds[0]}/logs`, 'audit SSE logs'],
    [`/api/interaction-runs/${created.interactionRunIds[0]}`, 'interaction run'],
    [`/api/interaction-runs/${created.interactionRunIds[0]}/results`, 'interaction results'],
    [`/api/interaction-runs/${created.interactionRunIds[0]}/json`, 'interaction json export'],
    [`/api/interaction-runs/${created.interactionRunIds[0]}/csv`, 'interaction csv export'],
    [`/api/interaction-runs/${created.interactionRunIds[0]}/logs`, 'interaction SSE logs']
  ];
  for (const [route, label] of protectedRoutes) {
    const res = await apiJson(userBPage, route, { timeout: 3500 });
    check('Cross-user security', `User B blocked from User A ${label}`, [401, 403, 404].includes(res.status), {
      id: `P2-SECURITY-${slug(label).toUpperCase()}`,
      severity: 'high',
      page: route,
      feature: 'Ownership enforcement',
      steps: `User B directly requests User A ${label}`,
      expected: '401/403/404 and no data leak',
      actual: `${res.status} ${res.text}`.slice(0, 1000),
      suspectedFile: 'server.js, src/db.js'
    });
  }

  const lists = [
    ['/api/audit-configs', 'configs', created.auditConfigId],
    ['/api/action-templates?type=pre', 'templates', created.preTemplateId],
    ['/api/rule-sets', 'ruleSets', created.ruleSetId],
    ['/api/interaction-flow-templates', 'templates', created.flowTemplateId],
    ['/api/interaction-configs', 'configs', created.interactionConfigId],
    ['/api/audits?limit=100', 'audits', created.auditRunIds[0]],
    ['/api/interaction-runs?limit=100', 'runs', created.interactionRunIds[0]]
  ];
  for (const [route, key, id] of lists) {
    const res = await apiJson(userBPage, route);
    const rows = res.data?.[key] || [];
    check('Cross-user security', `User B list excludes User A ${key}`, res.ok && !rows.some((row) => row.id === id), {
      id: `P2-SECURITY-LIST-${slug(key).toUpperCase()}`,
      severity: 'high',
      page: route,
      feature: 'List ownership isolation',
      steps: `User B lists ${route}`,
      expected: `List does not contain ${id}`,
      actual: `${res.status} ${res.text}`.slice(0, 1000)
    });
  }
  await userBContext.close();
}

async function runResponsive(page) {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 820, height: 1180 },
    { name: 'mobile', width: 390, height: 844 }
  ];
  const routes = [
    '/dashboard.html',
    '/audit-configs.html',
    '/interaction-configs.html',
    '/rule-sets.html',
    `/interaction-report.html?id=${encodeURIComponent(created.interactionRunIds[0])}`,
    `/?auditId=${encodeURIComponent(created.auditRunIds[0])}`
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    for (const route of routes) {
      page.__qaEvents = [];
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.container, #interactionReportSummary, #results', { timeout: 15000 });
      await page.waitForTimeout(350);
      const shot = await screenshot(page, `phase2 ${viewport.name} ${route}`);
      const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
      const buttonsVisible = await page.locator('button:visible, a:visible').count();
      if (route === '/dashboard.html') {
        const actionSizes = await page.locator('#configShortcuts .config-card-actions button, #configShortcuts .config-card-actions a').evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect();
          return { text: element.textContent.trim(), width: rect.width, height: rect.height };
        }));
        check('Browser/responsive', `${viewport.name} long config action labels remain readable`, actionSizes.length > 0 && actionSizes.every((size) => size.width >= 38 && size.height <= 44), {
          id: `P2-DASHBOARD-ACTION-LABELS-${viewport.name.toUpperCase()}`,
          severity: 'medium', page: route, feature: 'Long config shortcut actions',
          steps: `Open Dashboard with the long-name config at ${viewport.width}px`,
          expected: 'Run and Edit retain readable single-line labels', actual: JSON.stringify(actionSizes),
          screenshot: shot, suspectedFile: 'public/styles.css'
        });
      }
      check('Browser/responsive', `${viewport.name} ${route} renders usable`, buttonsVisible > 0 && page.__qaEvents.length === 0 && overflow < 80, {
        id: `P2-RESPONSIVE-${slug(`${viewport.name}-${route}`).toUpperCase()}`,
        severity: overflow >= 80 ? 'medium' : 'high',
        page: route,
        feature: 'Responsive visual layout',
        steps: `Open ${route} at ${viewport.width}x${viewport.height}`,
        expected: 'No app console errors, visible controls, no broad unexpected overflow',
        actual: `buttons=${buttonsVisible} overflow=${overflow} events=${JSON.stringify(page.__qaEvents.slice(0, 3))}`,
        screenshot: shot,
        suspectedFile: 'public/styles.css'
      });
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
}

async function runSafeExternal(page) {
  const run = await startAudit(page, {
    domain: SAFE_EXTERNAL_URL,
    maxPages: 1,
    sameOriginOnly: true,
    headless: true,
    waitUntil: 'domcontentloaded',
    browserEngine: 'playwright',
    navigationTimeoutMs: 20000,
    findPagesInSitemaps: false,
    rules: [{ name: 'External page URL captured', assertions: [{ type: 'pageField', field: 'finalUrl', operator: 'contains', value: 'example' }] }]
  }, 'safe external example.com', false);
  check('Realistic safe target', 'external audit reaches terminal state with readable evidence', Boolean(run && ['completed', 'failed'].includes(run.status)), {
    id: 'P2-EXTERNAL-TERMINAL',
    severity: 'medium',
    page: SAFE_EXTERNAL_URL,
    feature: 'Safe external URL handling',
    steps: 'Audit safe public URL with maxPages 1',
    expected: 'Terminal state with stored detail and no stuck job',
    actual: JSON.stringify(run?.detail?.data || {}).slice(0, 1000)
  });
}

async function runStability(page) {
  for (let i = 1; i <= 3; i += 1) {
    await startAudit(page, {
      domain: TARGET_URL,
      maxPages: 1,
      sameOriginOnly: true,
      headless: true,
      waitUntil: 'domcontentloaded',
      browserEngine: i % 2 ? 'playwright' : 'puppeteer',
      navigationTimeoutMs: 20000,
      findPagesInSitemaps: false
    }, `stability scratch audit ${i}`);
  }
  for (let i = 1; i <= 3; i += 1) {
    await runConfigAudit(page, created.auditConfigId, `stability ${i}`);
  }
  for (let i = 1; i <= 3; i += 1) {
    const id = await createInteractionConfig(page, `Phase 2 Stability Interaction ${i} ${RUN_ID}`, [
      { name: 'Wait home', action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 }
    ]);
    await runInteractionConfig(page, id, `stability interaction ${i}`);
  }
  const audits = await apiJson(page, '/api/audits?limit=50');
  const interactions = await apiJson(page, '/api/interaction-runs?limit=50');
  check('Performance/stability', 'history contains sequential run records', audits.ok && interactions.ok && created.auditRunIds.every((id) => (audits.data.audits || []).some((row) => row.id === id)) && created.interactionRunIds.every((id) => (interactions.data.runs || []).some((row) => row.id === id)), {
    id: 'P2-STABILITY-HISTORY',
    severity: 'high',
    page: '/api/audits /api/interaction-runs',
    feature: 'Run history stability',
    steps: 'Run multiple small audits/interactions sequentially and list history',
    expected: 'Every created run appears in history',
    actual: `audits=${created.auditRunIds.length}/${audits.data?.audits?.length} interactions=${created.interactionRunIds.length}/${interactions.data?.runs?.length}`
  });
}

async function seedData(page) {
  created.preTemplateId = await createActionTemplate(page, 'pre', `Phase 2 Pre ${RUN_ID}`, [
    { action: 'waitForSelector', selector: '#acceptCookies', timeout: 7000 },
    { action: 'click', selector: '#acceptCookies', timeout: 7000 }
  ]);
  created.postTemplateId = await createActionTemplate(page, 'post', `Phase 2 Post ${RUN_ID}`, [
    { action: 'executeJavaScript', value: "window.dataLayer.push({event:'phase2_post_template'});", timeout: 7000 }
  ]);
  created.ruleSetId = await createRuleSet(page, `Phase 2 Rule Set ${RUN_ID}`);
  created.flowTemplateId = await createFlowTemplate(page, `Phase 2 Flow ${RUN_ID}`);
  created.auditConfigId = await createAuditConfig(page, `Phase 2 Audit Config ${RUN_ID}`);
}

function writeReports() {
  const summaryLines = [
    '# Phase 2 Adversarial QA Summary',
    '',
    `Run ID: ${RUN_ID}`,
    `Date: ${new Date().toISOString()}`,
    `App URL: ${BASE_URL}`,
    `Target URL: ${TARGET_URL}`,
    `Safe external URL: ${SAFE_EXTERNAL_URL}`,
    `Screenshot folder: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`,
    '',
    '## Result',
    '',
    `- Checks executed: ${checks.length}`,
    `- Issues found: ${issues.length}`,
    `- Blocker/high issues: ${issues.filter((issue) => ['blocker', 'high'].includes(issue.severity)).length}`,
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
    ...checks.map((row) => `| ${row.area} | ${row.name} | ${row.status} | ${String(row.details || '').replace(/\|/g, '\\|')} |`),
    '',
    '## Screenshots',
    '',
    ...screenshots.map((shot) => `- ${shot}`)
  ];
  fs.writeFileSync(path.join(ROOT, 'QA_PHASE2_REGRESSION_SUMMARY.md'), `${summaryLines.join('\n')}\n`);

  const issueLines = ['# Phase 2 QA Issues', '', `Run ID: ${RUN_ID}`, `Screenshots: ${path.relative(ROOT, OUTPUT_DIR).replace(/\\/g, '/')}`, ''];
  if (!issues.length) {
    issueLines.push('No reproducible issues were found in this Phase 2 run.');
  } else {
    for (const issue of issues) {
      issueLines.push(`## ${issue.id} - ${issue.severity.toUpperCase()} - ${issue.feature || issue.page}`);
      issueLines.push('');
      issueLines.push(`- Page/feature: ${issue.page || 'n/a'}`);
      issueLines.push(`- Steps to reproduce: ${issue.steps || 'n/a'}`);
      issueLines.push(`- Expected: ${issue.expected || 'n/a'}`);
      issueLines.push(`- Actual: ${issue.actual || 'n/a'}`);
      issueLines.push(`- Screenshot: ${issue.screenshot || 'n/a'}`);
      issueLines.push(`- Console/network: ${issue.consoleOrNetwork || 'n/a'}`);
      issueLines.push(`- Suspected file/function: ${issue.suspectedFile || 'n/a'}`);
      issueLines.push(`- Fix applied: ${issue.fixApplied}`);
      issueLines.push(`- Retest result: ${issue.retest}`);
      issueLines.push('');
    }
  }
  fs.writeFileSync(path.join(ROOT, 'QA_PHASE2_ISSUES.md'), `${issueLines.join('\n')}\n`);
}

async function runMain() {
  const targetServer = await startTargetServer();
  const appProcessRef = { child: startAppServer() };
  let browser = null;
  try {
    await waitForHttp(`${BASE_URL}/api/health`, 30000);
    browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
    const contextA = await browser.newContext();
    const page = await contextA.newPage();
    monitorPage(page);

    const suffix = Math.random().toString(36).slice(2, 8);
    created.userA = { username: `p2a${suffix}`, password: `P2APass${suffix}!` };
    created.userB = { username: `p2b${suffix}`, password: `P2BPass${suffix}!` };
    await registerUser(page, created.userA.username, created.userA.password, 'Phase 2 User A');

    await runEdgeValidation(page);
    await seedData(page);
    await runAdvancedAudits(page);
    await runAdvancedInteractions(page);
    await runPersistence(page, appProcessRef);
    await runSecurity(browser);
    await runResponsive(page);
    await runSafeExternal(page);
    await runStability(page);
    writeReports();
    await contextA.close();
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (appProcessRef.child && !appProcessRef.child.killed) appProcessRef.child.kill();
    await new Promise((resolve) => targetServer.close(resolve));
  }
}

runMain().then(() => {
  const severe = issues.filter((issue) => ['blocker', 'high'].includes(issue.severity));
  if (severe.length) {
    console.error(`Phase 2 QA failed with ${severe.length} blocker/high issue(s). See QA_PHASE2_ISSUES.md`);
    process.exit(1);
  }
  if (issues.length) {
    console.error(`Phase 2 QA found ${issues.length} issue(s). See QA_PHASE2_ISSUES.md`);
    process.exit(1);
  }
  console.log('Phase 2 QA passed without reproducible issues. See QA_PHASE2_REGRESSION_SUMMARY.md');
}).catch((error) => {
  addIssue({
    id: 'P2-HARNESS-ERROR',
    severity: 'blocker',
    page: 'QA harness',
    feature: 'QA harness',
    steps: 'Run Phase 2 adversarial harness',
    expected: 'Harness completes and writes reports',
    actual: String(error && error.stack ? error.stack : error),
    suspectedFile: 'tests/qa/phase2-adversarial.js'
  });
  writeReports();
  console.error(error);
  process.exit(1);
});
