const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_AGENT_API_PORT || 3330);
const TARGET_PORT = Number(process.env.QA_AGENT_TARGET_PORT || 4630);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const USER_A = `agent_api_${Date.now()}`;
const USER_B = `agent_api_b_${Date.now()}`;
const PASSWORD = 'AgentApiTest123!';

const checks = [];

function check(name, condition, details = '') {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', details });
  if (!condition) throw new Error(`${name}${details ? `: ${details}` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
</urlset>`);
    }
    if (url.pathname === '/api/local-pixel') return send(200, 'application/json', JSON.stringify({ ok: true }));
    return send(200, 'text/html', `<!doctype html><html><head><title>Agent API Target</title></head><body>
      <h1>Agent API Target</h1>
      <button id="acceptCookies">Accept Cookies</button>
      <form id="qaForm">
        <input id="qaName" />
        <button id="submitForm" type="submit">Submit</button>
      </form>
      <div id="result">Waiting</div>
      <script>
        document.cookie = 'agent_api_session=1; path=/';
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'agent_api_page_view' });
        console.info('agent api target ready');
        fetch('/api/local-pixel?event=home');
        document.getElementById('acceptCookies').addEventListener('click', () => {
          document.cookie = 'agent_api_consent=yes; path=/';
          window.dataLayer.push({ event: 'agent_api_consent' });
        });
        document.getElementById('qaForm').addEventListener('submit', (event) => {
          event.preventDefault();
          document.getElementById('result').textContent = 'Submitted ' + document.getElementById('qaName').value;
          window.dataLayer.push({ event: 'agent_api_submit' });
          fetch('/api/local-pixel?event=submit');
        });
      </script>
    </body></html>`);
  });
  return new Promise((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

function startAppServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `agent-api-${RUN_ID}` },
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
      else setTimeout(tick, 350);
    };
    tick();
  });
}

class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.cookies = new Map();
  }

  absorbCookies(response) {
    const header = response.headers.get('set-cookie');
    if (!header) return;
    for (const part of header.split(/,(?=\s*[^;,\s]+=)/)) {
      const first = part.split(';')[0];
      const index = first.indexOf('=');
      if (index > 0) this.cookies.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  async request(route, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(`${this.baseUrl}${route}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    this.absorbCookies(response);
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: response.status, ok: response.ok, data, text, headers: response.headers };
  }

  async register(username, password) {
    const result = await this.request('/auth/register', {
      method: 'POST',
      body: { username, password, displayName: username }
    });
    check(`register ${username}`, result.status === 201 || result.status === 409, result.text);
    if (result.status === 409) {
      const login = await this.request('/auth/login', { method: 'POST', body: { username, password } });
      check(`login existing ${username}`, login.ok, login.text);
    }
  }
}

function auditPayload(run = true) {
  return {
    name: `Agent API Audit ${RUN_ID}`,
    description: 'Created by automated agent API regression.',
    run,
    config: {
      domain: TARGET_URL,
      urlSources: [TARGET_URL],
      maxPages: 1,
      maxDepth: 0,
      sameOriginOnly: true,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      includeSitemaps: false,
      options: {
        browserEngine: 'playwright',
        workerMode: 'custom',
        simultaneousWorkers: 1,
        navigationTimeoutMs: 8000
      }
    },
    preActionTemplates: [{
      name: `Agent API Pre ${RUN_ID}`,
      description: 'Accept local test consent.',
      steps: [{ action: 'click', selector: '#acceptCookies', timeout: 3000 }]
    }],
    postActionTemplates: [{
      name: `Agent API Post ${RUN_ID}`,
      description: 'Short wait after page capture.',
      steps: [{ action: 'waitForTimeout', timeout: 100 }]
    }],
    ruleSets: [{
      name: `Agent API Rule ${RUN_ID}`,
      description: 'Validate final URL from API-created rule set.',
      rules: [{
        id: 'rule-1',
        name: 'Final URL contains target',
        whenMode: 'all',
        expectMode: 'all',
        evaluationLimit: 1,
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
        assertions: [{ type: 'pageField', field: 'finalUrl', operator: 'contains', value: TARGET_URL }]
      }]
    }]
  };
}

function interactionPayload(run = true) {
  return {
    name: `Agent API Interaction ${RUN_ID}`,
    description: 'Created by automated agent API regression.',
    run,
    config: {
      startingUrl: TARGET_URL,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      generalSettings: { browserEngine: 'playwright', rules: [] },
      steps: [
        { name: 'Open target', action: 'openUrl', value: TARGET_URL, timeout: 8000 },
        { name: 'Accept cookies', action: 'click', selector: '#acceptCookies', timeout: 5000 },
        { name: 'Fill form', action: 'fillFormField', selector: '#qaName', value: 'Agent API', timeout: 5000 },
        { name: 'Submit form', action: 'click', selector: '#submitForm', timeout: 5000 },
        { name: 'Assert result', action: 'assertElementText', selector: '#result', value: 'Submitted Agent API', timeout: 5000 }
      ]
    },
    flowTemplates: [{
      name: `Agent API Flow ${RUN_ID}`,
      description: 'Reusable local target flow.',
      steps: [{ name: 'Template wait', action: 'waitForTimeout', value: '50', timeout: 50 }]
    }],
    ruleSets: [{
      name: `Agent API Interaction Rule ${RUN_ID}`,
      rules: [{
        id: 'rule-1',
        name: 'Final URL contains target',
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
        assertions: [{ type: 'pageField', field: 'finalUrl', operator: 'contains', value: TARGET_URL }]
      }]
    }]
  };
}

async function waitForAudit(client, id) {
  for (let i = 0; i < 80; i += 1) {
    const status = await client.request(`/api/audit/${encodeURIComponent(id)}/status`);
    check('audit status endpoint responds', status.ok, status.text);
    if (status.data.status === 'completed') return status.data;
    if (status.data.status === 'failed') throw new Error(`Audit failed: ${status.data.error || 'unknown error'}`);
    await sleep(750);
  }
  throw new Error(`Audit ${id} did not complete`);
}

async function waitForInteraction(client, id) {
  for (let i = 0; i < 80; i += 1) {
    const status = await client.request(`/api/interaction-runs/${encodeURIComponent(id)}/status`);
    check('interaction status endpoint responds', status.ok, status.text);
    if (status.data.status === 'completed') return status.data;
    if (status.data.status === 'failed') throw new Error(`Interaction failed: ${status.data.error || 'unknown error'}`);
    await sleep(750);
  }
  throw new Error(`Interaction ${id} did not complete`);
}

async function assertForbiddenForUserB(client, created) {
  const routes = [
    `/api/audit-configs/${created.auditConfigId}`,
    `/api/action-templates/${created.preTemplateId}`,
    `/api/action-templates/${created.postTemplateId}`,
    `/api/rule-sets/${created.auditRuleSetId}`,
    `/api/interaction-flow-templates/${created.flowTemplateId}`,
    `/api/interaction-configs/${created.interactionConfigId}`,
    `/api/audit/${created.auditRunId}`,
    `/api/audit/${created.auditRunId}/json`,
    `/api/interaction-runs/${created.interactionRunId}`,
    `/api/interaction-runs/${created.interactionRunId}/json`
  ];
  for (const route of routes) {
    const response = await client.request(route);
    check(`cross-user blocked ${route}`, [401, 403, 404].includes(response.status), `${response.status} ${response.text}`);
  }
}

async function main() {
  const target = await startTargetServer();
  const app = startAppServer();
  try {
    await waitForHttp(`${BASE_URL}/api/health`);
    const anonymous = new ApiClient(BASE_URL);
    const unauthSchema = await anonymous.request('/api/agent/schema');
    check('agent schema requires auth', unauthSchema.status === 401, `${unauthSchema.status} ${unauthSchema.text}`);

    const userA = new ApiClient(BASE_URL);
    const userB = new ApiClient(BASE_URL);
    await userA.register(USER_A, PASSWORD);
    await userB.register(USER_B, PASSWORD);

    const schema = await userA.request('/api/agent/schema');
    check('agent schema loads', schema.ok && Array.isArray(schema.data.schema?.actionTypes), schema.text);

    const invalidAudit = await userA.request('/api/agent/audits', {
      method: 'POST',
      body: { name: 'Invalid Audit', config: { domain: 'bad url !', maxPages: 0 } }
    });
    check('agent audit rejects invalid config', invalidAudit.status === 400, `${invalidAudit.status} ${invalidAudit.text}`);

    const invalidInteraction = await userA.request('/api/agent/interactions', {
      method: 'POST',
      body: { name: 'Invalid Interaction', config: { startingUrl: '', steps: [{ action: 'click' }] } }
    });
    check('agent interaction rejects invalid config', invalidInteraction.status === 400, `${invalidInteraction.status} ${invalidInteraction.text}`);

    const auditCreate = await userA.request('/api/agent/audits', { method: 'POST', body: auditPayload(true) });
    check('agent audit create/run succeeds', auditCreate.status === 201 && auditCreate.data.auditRun?.id, auditCreate.text);
    const auditRunId = auditCreate.data.auditRun.id;
    await waitForAudit(userA, auditRunId);
    const auditResults = await userA.request(`/api/audit/${encodeURIComponent(auditRunId)}/results`);
    check('agent audit results load', auditResults.ok && Array.isArray(auditResults.data.pages), auditResults.text);
    const auditCsv = await userA.request(`/api/audit/${encodeURIComponent(auditRunId)}/csv`);
    check('agent audit csv export works', auditCsv.ok && auditCsv.text.includes('URL'), auditCsv.text.slice(0, 120));
    const auditJson = await userA.request(`/api/audit/${encodeURIComponent(auditRunId)}/json`);
    check('agent audit json export works', auditJson.ok && auditJson.text.includes('pages'), auditJson.text.slice(0, 120));

    const interactionCreate = await userA.request('/api/agent/interactions', { method: 'POST', body: interactionPayload(true) });
    check('agent interaction create/run succeeds', interactionCreate.status === 201 && interactionCreate.data.interactionRun?.id, interactionCreate.text);
    const interactionRunId = interactionCreate.data.interactionRun.id;
    await waitForInteraction(userA, interactionRunId);
    const interactionResults = await userA.request(`/api/interaction-runs/${encodeURIComponent(interactionRunId)}/results`);
    check('agent interaction results load', interactionResults.ok && Array.isArray(interactionResults.data.steps), interactionResults.text);
    const interactionCsv = await userA.request(`/api/interaction-runs/${encodeURIComponent(interactionRunId)}/csv`);
    check('agent interaction csv export works', interactionCsv.ok && interactionCsv.text.includes('Step'), interactionCsv.text.slice(0, 120));
    const interactionJson = await userA.request(`/api/interaction-runs/${encodeURIComponent(interactionRunId)}/json`);
    check('agent interaction json export works', interactionJson.ok && interactionJson.text.includes('steps'), interactionJson.text.slice(0, 120));

    await assertForbiddenForUserB(userB, {
      auditConfigId: auditCreate.data.auditConfig.id,
      preTemplateId: auditCreate.data.created.preActionTemplateIds[0],
      postTemplateId: auditCreate.data.created.postActionTemplateIds[0],
      auditRuleSetId: auditCreate.data.created.ruleSetIds[0],
      interactionConfigId: interactionCreate.data.interactionConfig.id,
      flowTemplateId: interactionCreate.data.created.flowTemplateIds[0],
      auditRunId,
      interactionRunId
    });

    console.log(`Agent API regression passed with ${checks.length} checks.`);
  } finally {
    app.kill('SIGTERM');
    await new Promise((resolve) => target.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  console.error('Checks:', checks);
  process.exit(1);
});
