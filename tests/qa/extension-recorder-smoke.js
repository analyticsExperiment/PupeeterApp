const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_EXTENSION_APP_PORT || 3350);
const TARGET_PORT = Number(process.env.QA_EXTENSION_TARGET_PORT || 4650);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const EXT_DIR = path.join(ROOT, 'extension', 'free-audit-recorder');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const USERNAME = `extension_agent_${Date.now()}`;
const PASSWORD = 'ExtensionAgent123!';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function read(file) {
  return fs.readFileSync(path.join(EXT_DIR, file), 'utf8');
}

function startTargetServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, TARGET_URL);
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (url.pathname === '/favicon.ico') return send(204, 'text/plain', '');
    if (url.pathname === '/next') {
      return send(200, 'text/html', targetPage('Next Page', '<h1 id="nextTitle">Next Page</h1><a id="homeLink" href="/">Home</a>'));
    }
    if (url.pathname === '/frame') {
      return send(200, 'text/html', '<!doctype html><html><body><button id="frameButton">Frame Button</button></body></html>');
    }
    return send(200, 'text/html', targetPage('Recorder Target', `
      <h1>Recorder Target</h1>
      <a id="nextLink" data-testid="next-link" href="/next">Next</a>
      <button id="menuButton" data-qa="menu-button">Menu</button>
      <form id="loginForm">
        <label>Email <input id="email" name="email" autocomplete="username" /></label>
        <label>Password <input id="password" name="password" type="password" autocomplete="current-password" /></label>
        <label>Choice <select id="choice" name="choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
        <label><input id="agree" name="agree" type="checkbox" /> Agree</label>
        <label><input id="radioA" name="kind" type="radio" value="a" /> A</label>
        <button id="submitButton" type="submit">Submit</button>
      </form>
      <div style="height: 900px"></div>
      <iframe id="demoFrame" src="/frame"></iframe>
    `));
  });
  return new Promise((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

function targetPage(title, body) {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}<script>
    document.getElementById('loginForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      document.body.setAttribute('data-submitted', 'yes');
    });
  </script></body></html>`;
}

function startAppServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `extension-smoke-${RUN_ID}` },
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
    return { status: response.status, ok: response.ok, data, text };
  }
}

async function waitForInteraction(client, id) {
  for (let i = 0; i < 80; i += 1) {
    const status = await client.request(`/api/interaction-runs/${encodeURIComponent(id)}/status`);
    if (status.data?.status === 'completed') return status.data;
    if (status.data?.status === 'failed') throw new Error(`Interaction failed: ${status.data.error || 'unknown error'}`);
    await sleep(750);
  }
  throw new Error(`Interaction ${id} did not complete`);
}

async function main() {
  const expectedFiles = ['manifest.json', 'popup.html', 'popup.js', 'contentScript.js', 'recorder.js', 'selectorGenerator.js', 'styles.css', 'README.md'];
  for (const file of expectedFiles) assert(fs.existsSync(path.join(EXT_DIR, file)), `Missing extension file ${file}`);
  const manifest = JSON.parse(read('manifest.json'));
  assert(manifest.manifest_version === 3, 'Extension must use Manifest V3');
  assert(manifest.name === 'Free Audit Recorder', 'Extension name mismatch');

  const target = await startTargetServer();
  const app = startAppServer();
  let browser;
  try {
    await waitForHttp(`${BASE_URL}/api/health`);
    const client = new ApiClient(BASE_URL);
    const register = await client.request('/auth/register', {
      method: 'POST',
      body: { username: USERNAME, password: PASSWORD, displayName: USERNAME }
    });
    assert([201, 409].includes(register.status), `register failed ${register.status} ${register.text}`);
    if (register.status === 409) {
      const login = await client.request('/auth/login', { method: 'POST', body: { username: USERNAME, password: PASSWORD } });
      assert(login.ok, `login failed ${login.status} ${login.text}`);
    }

    const tokenResponse = await client.request('/api/extension/tokens', { method: 'POST', body: { label: `Smoke ${RUN_ID}` } });
    assert(tokenResponse.status === 201 && tokenResponse.data.token, `token create failed ${tokenResponse.status} ${tokenResponse.text}`);
    const token = tokenResponse.data.token;
    const tokenRecord = tokenResponse.data.tokenRecord;
    assert(tokenRecord?.id && !Object.prototype.hasOwnProperty.call(tokenRecord, 'token'), 'token record leaked raw token');
    const tokenList = await client.request('/api/extension/tokens');
    assert(tokenList.ok && tokenList.data.tokens.some((item) => item.id === tokenRecord.id), `token list missing created token ${tokenList.status} ${tokenList.text}`);
    const status = await fetch(`${BASE_URL}/api/extension/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert(status.status === 200, `extension status failed ${status.status} ${await status.text()}`);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ path: path.join(EXT_DIR, 'selectorGenerator.js') });
    await page.addScriptTag({ path: path.join(EXT_DIR, 'recorder.js') });
    await page.addScriptTag({ path: path.join(EXT_DIR, 'contentScript.js') });
    await page.evaluate(() => window.FreeAuditRecorder.start());
    await page.click('#menuButton');
    await page.fill('#email', 'person@example.com');
    await page.fill('#password', 'super-secret-password');
    await page.selectOption('#choice', 'beta');
    await page.check('#agree');
    await page.check('#radioA');
    await page.keyboard.press('Enter');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const steps = await page.evaluate(() => window.FreeAuditRecorder.stop().steps);
    assert(steps.some((step) => step.action === 'openUrl' && step.value === TARGET_URL + '/'), 'openUrl step missing');
    assert(steps.some((step) => step.action === 'click' && step.selector.includes('menu')), 'click step missing');
    assert(steps.some((step) => (step.action === 'type' || step.action === 'fillFormField') && step.value === 'person@example.com'), 'email type step missing');
    assert(steps.some((step) => (step.action === 'type' || step.action === 'fillFormField') && step.value === '{{PASSWORD}}' && step.sensitive), 'password was not masked');
    assert(steps.some((step) => step.action === 'selectDropdownOption' && step.value === 'beta'), 'select step missing');
    assert(steps.some((step) => step.action === 'checkCheckbox' && step.selector), 'checkbox step missing');
    assert(steps.every((step) => step.action && (step.action === 'openUrl' || step.selector || step.value)), 'recorded steps are not schema-like');

    const flowSave = await fetch(`${BASE_URL}/api/extension/interaction-flow-template`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `Extension Flow ${RUN_ID}`, description: 'Saved by extension smoke.', steps })
    });
    const flowData = await flowSave.json();
    assert(flowSave.status === 201 && flowData.template?.id, `flow save failed ${flowSave.status} ${JSON.stringify(flowData)}`);

    const runnableSteps = steps.filter((step) => !step.sensitive && !['pressKey'].includes(step.action));
    const configSave = await fetch(`${BASE_URL}/api/extension/interaction-config`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Extension Config ${RUN_ID}`,
        description: 'Saved by extension smoke.',
        startingUrl: TARGET_URL,
        waitUntil: 'domcontentloaded',
        showBrowser: false,
        generalSettings: { browserEngine: 'playwright' },
        steps: runnableSteps
      })
    });
    const configData = await configSave.json();
    assert(configSave.status === 201 && configData.config?.id, `config save failed ${configSave.status} ${JSON.stringify(configData)}`);

    const run = await client.request(`/api/interaction-configs/${encodeURIComponent(configData.config.id)}/run`, { method: 'POST', body: {} });
    assert(run.ok && run.data.id, `generated interaction run failed to start ${run.status} ${run.text}`);
    await waitForInteraction(client, run.data.id);
    const results = await client.request(`/api/interaction-runs/${encodeURIComponent(run.data.id)}/results`);
    assert(results.ok && Array.isArray(results.data.steps), `generated interaction results missing ${results.status} ${results.text}`);

    const revoke = await client.request(`/api/extension/tokens/${encodeURIComponent(tokenRecord.id)}`, { method: 'DELETE' });
    assert(revoke.ok, `token revoke failed ${revoke.status} ${revoke.text}`);
    const revokedStatus = await fetch(`${BASE_URL}/api/extension/status`, { headers: { Authorization: `Bearer ${token}` } });
    assert(revokedStatus.status === 401, `revoked extension token still worked ${revokedStatus.status} ${await revokedStatus.text()}`);

    console.log(`Extension recorder smoke passed with ${steps.length} recorded steps.`);
  } finally {
    if (browser) await browser.close();
    app.kill('SIGTERM');
    await new Promise((resolve) => target.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
