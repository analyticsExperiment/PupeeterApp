const el = (sel) => document.querySelector(sel);
const elAll = (sel) => Array.from(document.querySelectorAll(sel));

const ACTION_OPTIONS = [
  'click',
  'type',
  'waitForSelector',
  'waitForTimeout',
  'hover',
  'scroll',
  'navigate',
  'switchToIFrame',
  'switchToMainFrame',
  'executeJavaScript'
];

const WAIT_UNTIL_OPTIONS = new Set(['domcontentloaded', 'load', 'networkidle2']);
const createAuditState = {
  loadedConfigId: null,
  auditDetail: null,
  auditConfigs: []
};

function handleUnauthorizedResponse(resp) {
  if (resp && resp.status === 401) {
    window.location.href = '/login';
    return true;
  }
  return false;
}

function normalizeWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle0' || normalized === 'networkidle') return 'networkidle2';
  if (WAIT_UNTIL_OPTIONS.has(normalized)) return normalized;
  return 'domcontentloaded';
}

async function loadRuleCatalog() {
  try {
    const response = await fetch('/api/tag-catalog');
    if (handleUnauthorizedResponse(response)) return [];
    if (!response.ok) throw new Error('Failed to load tag catalog');
    const payload = await response.json();
    return Array.isArray(payload.ruleOptions) ? payload.ruleOptions : [];
  } catch (err) {
    console.error('Failed to load tag catalog', err);
    return [];
  }
}

function looksLikeJavaScriptSnippet(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /(document\.|window\.|querySelector|querySelectorAll|=>|function\s*\(|\.click\s*\(|\.submit\s*\(|return\s+|console\.|eval\s*\(|await\s+)/i.test(text);
}

function stepRow(step = {}) {
  const row = document.createElement('div');
  row.className = 'step';
  const actionOptions = ACTION_OPTIONS.map((action) => `<option value="${action}">${action}</option>`).join('');
  row.innerHTML = `
    <div class="step-seq">
      <span class="step-index">1</span>
      <div class="step-move">
        <button class="move-up" type="button" title="Move up">Up</button>
        <button class="move-down" type="button" title="Move down">Dn</button>
      </div>
    </div>
    <select class="action">
      ${actionOptions}
    </select>
    <input class="selector" placeholder="selector (or URL for navigate)" />
    <textarea class="value" rows="2" placeholder="value (for type) or JavaScript"></textarea>
    <input class="timeout" placeholder="timeout ms" type="number" />
    <button class="del" type="button">X</button>
  `;
  row.querySelector('.action').value = step.action || 'click';
  row.querySelector('.selector').value = step.selector || '';
  row.querySelector('.value').value = step.value || '';
  row.querySelector('.timeout').value = step.timeout || '';
  row.querySelector('.action').addEventListener('change', () => updateStepRowUI(row));
  row.querySelector('.move-up').addEventListener('click', () => moveStep(row, -1));
  row.querySelector('.move-down').addEventListener('click', () => moveStep(row, 1));
  updateStepRowUI(row);
  row.querySelector('.del').addEventListener('click', () => {
    const container = row.parentElement;
    row.remove();
    if (container) updateStepOrder(container);
  });
  return row;
}

function moveStep(row, direction) {
  const container = row.parentElement;
  if (!container) return;

  if (direction < 0) {
    const prev = row.previousElementSibling;
    if (prev) container.insertBefore(row, prev);
  } else if (direction > 0) {
    const next = row.nextElementSibling;
    if (next) container.insertBefore(next, row);
  }
  updateStepOrder(container);
}

function updateStepOrder(container) {
  const rows = Array.from(container.querySelectorAll('.step'));
  rows.forEach((row, idx) => {
    const indexEl = row.querySelector('.step-index');
    const up = row.querySelector('.move-up');
    const down = row.querySelector('.move-down');
    if (indexEl) indexEl.textContent = String(idx + 1);
    if (up) up.disabled = idx === 0;
    if (down) down.disabled = idx === rows.length - 1;
  });
}

function addStepToContainer(containerSelector, step = {}) {
  const container = el(containerSelector);
  if (!container) return;
  container.appendChild(stepRow(step));
  updateStepOrder(container);
}

function setStepsInContainer(containerSelector, steps = []) {
  const container = el(containerSelector);
  if (!container) return;
  container.innerHTML = '';
  (Array.isArray(steps) ? steps : []).forEach((step) => addStepToContainer(containerSelector, step));
}

function updateStepRowUI(row) {
  const action = (row.querySelector('.action')?.value || '').toLowerCase();
  const selector = row.querySelector('.selector');
  const value = row.querySelector('.value');
  if (!selector || !value) return;

  if (action === 'navigate') {
    selector.placeholder = 'URL to navigate';
    value.placeholder = 'optional notes';
  } else if (action === 'switchtoiframe') {
    selector.placeholder = 'iframe selector (preferred)';
    value.placeholder = 'or frame name/url contains';
  } else if (action === 'switchtomainframe') {
    selector.placeholder = 'not required';
    value.placeholder = 'not required';
  } else if (action === 'executejavascript') {
    if (!value.value.trim() && looksLikeJavaScriptSnippet(selector.value)) {
      value.value = selector.value;
      selector.value = '';
    }
    selector.placeholder = 'optional selector/context';
    value.placeholder = 'JavaScript to execute in page context';
  } else if (action === 'waitfortimeout') {
    selector.placeholder = 'not required';
    value.placeholder = 'not required';
  } else {
    selector.placeholder = 'selector';
    value.placeholder = 'value (for type)';
  }
}

function collectSteps(containerSelector) {
  return elAll(`${containerSelector} .step`).map((row) => {
    const action = row.querySelector('.action').value;
    const selector = row.querySelector('.selector').value.trim();
    const value = row.querySelector('.value').value;
    const timeout = row.querySelector('.timeout').value;
    const step = { action };
    if (action === 'navigate') {
      if (selector) step.value = selector;
      else if (value !== '') step.value = value;
    } else if (action === 'executeJavaScript' || action === 'executejavascript') {
      if (value !== '') step.value = value;
      else if (looksLikeJavaScriptSnippet(selector)) step.value = selector;
      if (selector && !looksLikeJavaScriptSnippet(selector)) step.selector = selector;
    } else {
      if (selector) step.selector = selector;
      if (value !== '') step.value = value;
    }
    if (timeout) step.timeout = Number(timeout);
    return step;
  });
}

function renderSummary(res) {
  const s = res.summary || { total: 0, analyticsHits: 0, pagesWithAnalytics: 0, errors: 0 };
  const headers = res.requestHeaders || {};
  const geo = headers.geoLocation || {};
  const detectedRequests = s.detectedRequests != null ? s.detectedRequests : (s.analyticsHits || 0);
  const totalNetworkRequests = s.networkRequests != null ? s.networkRequests : 0;

  // Parse user agent for device info
  const deviceInfo = parseUserAgent(headers.userAgent || '');

  return `
    <div class="summary">
      <div class="card"><div class="muted">Pages / Target</div><div style="font-size:22px">${escapeHtml(String(s.total ?? '-'))}${s.pageTarget ? ` / ${escapeHtml(String(s.pageTarget))}` : ''}</div></div>
      <div class="card"><div class="muted">Pages w/ Detected Requests</div><div style="font-size:22px">${s.pagesWithDetectedRequests ?? s.pagesWithAnalytics ?? '-'}</div></div>
      <div class="card"><div class="muted">Detected Requests</div><div style="font-size:22px">${detectedRequests}</div></div>
      <div class="card"><div class="muted">Network Requests</div><div style="font-size:22px">${totalNetworkRequests}</div></div>
      <div class="card"><div class="muted">Errors</div><div style="font-size:22px;color:var(--bad)">${s.errors ?? '-'}</div></div>
      <div class="card"><div class="muted">Console Messages</div><div style="font-size:22px">${s.consoleMessages || 0}</div></div>
      <div class="card"><div class="muted">Failed Rules</div><div style="font-size:22px">${s.ruleFailures || 0}</div></div>
    </div>
    
    <details class="request-headers-section report-metadata">
      <summary>Request Information</summary>
      <div class="headers-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:12px;">
        <div class="header-card">
          <div class="muted">IP Address</div>
          <div class="value">${escapeHtml(headers.ipAddress || 'Unknown')}</div>
        </div>
        <div class="header-card">
          <div class="muted">Location</div>
          <div class="value">${escapeHtml(geo.city || 'Unknown')}, ${escapeHtml(geo.country || 'Unknown')}</div>
        </div>
      <div class="header-card">
        <div class="muted">Browser</div>
        <div class="value">${escapeHtml(deviceInfo.browser)}</div>
      </div>
        <div class="header-card">
          <div class="muted">OS</div>
          <div class="value">${escapeHtml(deviceInfo.os)}</div>
        </div>
        <div class="header-card">
          <div class="muted">Device Type</div>
          <div class="value">${escapeHtml(deviceInfo.deviceType)}</div>
        </div>
        <div class="header-card">
          <div class="muted">Language</div>
          <div class="value">${escapeHtml(headers.acceptLanguage ? headers.acceptLanguage.split(',')[0] : 'Unknown')}</div>
        </div>
      </div>
      <div class="header-details" style="margin-top:12px;">
        <button class="pill" id="viewRequestHeaders" type="button">View Full Headers</button>
      </div>
    </details>
    
    <div class="actions" style="margin-top:16px; gap:8px">
      <a class="pill" href="#" id="downloadCsv">Download CSV</a>
      <a class="pill" href="#" id="downloadJson">Download JSON</a>
      <a class="pill" href="/audits.html">Audit History</a>
      ${res.ruleSummary?.rules?.length ? '<button class="pill" id="viewRulesAction" type="button">View Rules</button>' : ''}
      <button class="pill" id="viewLogs" type="button">View Logs</button>
    </div>
  `;
}

function renderPage(p) {
  const cookies = (p.cookies || []).map((c) => `${c.name}=${c.value}`).slice(0, 10);
  const dlCount = (p.dataLayer?.after?.length || 0) + (p.dataLayer?.before?.length || 0);
  const groups = groupByVendor(p.analytics || []);
  const chips = Object.keys(groups).map((v) => `<span class="chip" data-vendor="${escapeAttr(v)}">${v}<span class="count">(${groups[v].length})</span></span>`).join('');
  const dataLayers = ``;
  const cookiesHtml = cookies.map((c) => `<div class="item">${c}</div>`).join('');
  const consoleCount = Array.isArray(p.console) ? p.console.length : 0;
  const networkCount = Array.isArray(p.networkRequests) ? p.networkRequests.length : 0;
  const ruleMeta = window.RuleBuilder ? window.RuleBuilder.renderPageRuleMeta(p) : 'rules: 0 passed, 0 failed, 0 not applied';
  return `
    <div class="page">
      <div class="flex">
      <div><strong>${escapeHtml(p.title || '(no title)')}</strong></div>
      <a class="pill" href="${escapeAttr(/^https?:/i.test(p.url || '') ? p.url : '#')}" target="_blank" rel="noopener">Open</a>
      <div class="pill">links: ${p.linksFound ?? '-'}</div>
      <div class="right pill">requests: ${(p.analytics || []).length}, network: ${networkCount}, dataLayer: ${dlCount}, cookies: ${(p.cookies || []).length}, console: ${consoleCount}, ${ruleMeta}</div>
      </div>
      <div class="meta">${escapeHtml(p.url || '')}</div>
      ${p.finalStatusCode ? `<div class="meta">Final HTTP status: ${escapeHtml(String(p.finalStatusCode))}</div>` : ''}
      ${p.captureNotes ? `<div class="meta">Capture note: ${escapeHtml(p.captureNotes)}</div>` : ''}
      ${p.error ? `<div class="section"><h4>Page Error — results may not represent the target page</h4><div class="item">${escapeHtml(String(p.error))}</div></div>` : ''}
      ${p.preAuditError ? `<div class="section"><h4>Pre-Audit Action Error</h4><div class="item">${escapeHtml(String(p.preAuditError))}</div></div>` : ''}
      ${p.onPageError ? `<div class="section"><h4>On Page Action Error</h4><div class="item">${escapeHtml(String(p.onPageError))}</div></div>` : ''}
      ${p.flowError ? `<div class="section"><h4>Flow Error</h4><div class="item">${escapeHtml(String(p.flowError))}</div></div>` : ''}
      <div class="section">
        <div class="tiles">
          <button type="button" class="tile clickable view-tools"><span class="label">Tools</span><span class="num">${(p.vendors || []).length}</span></button>
          <button type="button" class="tile clickable view-datalayer"><span class="label">dataLayer</span><span class="num">${dlCount}</span></button>
          <button type="button" class="tile clickable view-cookies"><span class="label">Cookies</span><span class="num">${(p.cookies || []).length}</span></button>
          <button type="button" class="tile clickable view-console"><span class="label">Console</span><span class="num">${consoleCount}</span></button>
          <button type="button" class="tile clickable view-network"><span class="label">Network Requests</span><span class="num">${networkCount}</span></button>
          <button type="button" class="tile clickable view-rules"><span class="label">Rules</span><span class="num">${(p.ruleResults || []).length}</span></button>
        </div>
      </div>
    </div>
  `;
}

function renderResults(res, jobId) {
  const root = el('#results');
  document.body.classList.add('audit-report-mode');
  el('#consoleHeading').textContent = 'Audit Report';
  document.title = 'Audit Report - Free Audit';
  document.querySelectorAll('.app-nav-link').forEach(link => {
    const active = link.getAttribute('href') === '/audits.html';
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  const detail = createAuditState.auditDetail || {};
  const started = detail.startedAt ? new Date(detail.startedAt).toLocaleString() : '';
  const identity = `<header class="report-identity"><h2>${escapeHtml(detail.configName || detail.configSnapshot?.name || 'Unsaved audit')}</h2><p>${escapeHtml(detail.domain || res.pages?.[0]?.url || '')}</p><div class="report-run-meta">${started ? `<span>${escapeHtml(started)}</span>` : ''}<span>Run ${escapeHtml(jobId || '')}</span></div>${res.error ? `<p class="login-error">${escapeHtml(String(res.error))}</p>` : ''}</header>`;
  const ruleSummary = window.RuleBuilder ? window.RuleBuilder.renderRuleSummaryBlock(res) : '';
  const attachedNote = res.captureMode === 'attached-chrome'
    ? `<p class="muted" role="note">Attached Chrome audit: ${escapeHtml(res.captureLimitations || '')}</p>`
    : '';
  const reasons = { 'target-reached': 'Target reached', 'site-denied-access': 'Site denied access',
    'no-more-discoverable-pages': 'No more discoverable pages', 'depth-limit': 'Configured depth limit reached',
    'manual-stop': 'Stopped manually' };
  const summary = res.summary || {};
  const outcomeNote = summary.pageTarget && summary.crawlStopReason
    ? `<p class="muted" role="status">${escapeHtml(String(summary.total || 0))} of ${escapeHtml(String(summary.pageTarget))} target pages attempted. ${escapeHtml(reasons[summary.crawlStopReason] || summary.crawlStopReason)}.</p>`
    : '';
  root.innerHTML = identity + attachedNote + outcomeNote + renderSummary(res) + ruleSummary + (res.pages || []).map(renderPage).join('');
  const dl = el('#downloadCsv');
  if (dl) {
    dl.href = `/api/audit/${jobId}/csv`;
  }
  const dj = el('#downloadJson');
  if (dj) dj.href = `/api/audit/${jobId}/json`;
  window.__LATEST_RESULTS = res;
  window.__LATEST_JOBID = jobId;
  const vl = el('#viewLogs');
  if (vl) vl.onclick = () => openLogsModal();
  const vh = el('#viewRequestHeaders');
  if (vh) vh.onclick = () => openRequestHeadersModal();
  const ruleButtons = [el('#viewRulesAction'), el('#viewRulesSummary')].filter(Boolean);
  for (const button of ruleButtons) {
    if (button && window.RuleBuilder) button.onclick = () => window.RuleBuilder.openRuleSummaryModal(res);
  }
}

async function loadAuditDetail(jobId) {
  if (!jobId) return null;
  try {
    const resp = await fetch(`/api/audit/${encodeURIComponent(jobId)}`, { credentials: 'same-origin', cache: 'no-store' });
    if (handleUnauthorizedResponse(resp)) return null;
    if (!resp.ok) return null;
    return await resp.json();
  } catch (err) {
    console.warn('Failed to load audit detail', err);
    return null;
  }
}

function setAuditRunContext(detail = {}) {
  createAuditState.auditDetail = detail;
  const target = el('#auditRunContext');
  if (!target) return;
  const configName = detail.configName || detail.configSnapshot?.name || null;
  const domain = detail.domain || detail.payload?.domain || detail.payload?.startingUrls?.[0] || '';
  const status = detail.status ? `<span class="audit-run-badge">${escapeHtml(detail.status)}</span>` : '';
  target.innerHTML = `
    <div>
      <strong>${escapeHtml(configName || 'Unsaved audit run')}</strong>
      <span>${escapeHtml(domain || 'Domain pending')}</span>
    </div>
    ${status}
  `;
  target.classList.remove('hidden');
}

function hideAuditRunContext() {
  const target = el('#auditRunContext');
  if (!target) return;
  target.innerHTML = '';
  target.classList.add('hidden');
}

async function loadSavedAudit(jobId) {
  if (!jobId) return;
  try {
    el('#auditForm')?.classList.add('hidden');
    el('#configLanding')?.classList.add('hidden');
    showStatus();
    setProgress(15, 'Loading saved audit...');
    const detail = await loadAuditDetail(jobId);
    if (detail) setAuditRunContext(detail);
    const safeId = encodeURIComponent(jobId);
    const resp = await fetch(`/api/audit/${safeId}/results`);
    if (handleUnauthorizedResponse(resp)) return;
    if (resp.status === 202) {
      setProgress(12, 'Audit is running. Streaming live logs...');
      await waitForJob(jobId);
      return;
    }
    if (resp.status === 422) {
      const data = await resp.json().catch(() => ({ error: 'Unknown error' }));
      setProgress(100, `Audit failed: ${data.error || 'Unknown error'}`);
      return;
    }
    if (resp.status === 404) {
      setProgress(100, 'Saved audit not found.');
      return;
    }
    if (!resp.ok) throw new Error('Failed to load saved audit');
    const data = await resp.json();
    hideStatus();
    const resultsEl = document.querySelector('#results');
    if (resultsEl) resultsEl.classList.remove('hidden');
    renderResults(data, jobId);
  } catch (err) {
    console.error('Failed to load saved audit', err);
    setProgress(100, 'Failed to load saved audit.');
  }
}


function showStatus() {
  el('#status').classList.remove('hidden');
}
function hideStatus() {
  el('#status').classList.add('hidden');
  hideAuditRunContext();
}
function setProgress(percent, text) {
  el('#bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  el('#statusText').textContent = text || '';
}

async function pollStatus(id) {
  const response = await fetch(`/api/audit/${id}/status`);
  if (handleUnauthorizedResponse(response)) {
    setProgress(100, 'Session expired. Redirecting to login...');
    return { done: true, failed: true, error: 'Unauthorized' };
  }
  if (!response.ok) {
    const message = response.status === 404 ? 'Job not found' : 'Failed to fetch status';
    setProgress(100, message);
    return { done: true, failed: true, error: message };
  }
  const s = await response.json();
  if (s.status === 'completed') return { done: true };
  if (s.status === 'failed') {
    const err = s.error || 'Unknown error';
    setProgress(100, `Job failed: ${err}`);
    return { done: true, failed: true, error: err };
  }
  const p = s.progress || {};
  const processed = Number(p.processed || 0);
  const q = Number(p.queue || 0);
  const total = processed + q + 1;
  const percent = total ? Math.round((processed / total) * 100) : 0;
  setProgress(percent, `Scanning... ${processed} done, ${q} queued`);
  return { done: false };
}

async function waitForJob(id) {
  showStatus();
  setProgress(5, 'Starting...');
  startLogStream(id);
  let failedError = null;
  while (true) {
    const r = await pollStatus(id);
    if (r.done) { failedError = r.error || null; break; }
    await new Promise((res) => setTimeout(res, 1200));
  }
  const resResp = await fetch(`/api/audit/${id}/results`);
  if (handleUnauthorizedResponse(resResp)) return;
  let res;
  if (resResp.ok) {
    res = await resResp.json();
  } else {
    try { res = await resResp.json(); } catch { res = { status: 'failed', error: failedError }; }
  }
  hideStatus();
  // After results, hide live logs and expand layout
  const layout = document.querySelector('.layout');
  layout?.classList.remove('with-logs');
  const live = document.getElementById('liveLogs');
  if (live) { live.classList.add('hidden'); live.classList.remove('full'); }
  el('#results').classList.remove('hidden');
  renderResults(res, id);
  if (res.status === 'failed' || failedError) {
    const stream = document.querySelector('#logStream');
    if (stream) {
      const line = document.createElement('div');
      line.className = 'log-line error';
      line.innerHTML = `<div class="time">${formatTimeIST(Date.now())}</div><div class="level">error</div><div class="msg">Job failed: ${escapeHtml(res.error || failedError || '')}</div>`;
      stream.appendChild(line);
    }
  }
}

function buildPayload() {
  const domain = el('#domain').value.trim();
  const maxPages = Number(el('#maxPages').value || 15);
  const sameOriginOnly = el('#sameOriginOnly').value === 'true';
  const waitUntil = normalizeWaitUntil(el('#waitUntil').value);
  const showBrowser = Boolean(el('#showBrowser')?.checked);
  const flow = collectSteps('#steps');
  const preAuditActions = collectSteps('#preAuditSteps');
  const postAuditActions = collectSteps('#onPageSteps');
  const onPageActions = postAuditActions;
  const rules = window.RuleBuilder ? window.RuleBuilder.collectRules() : [];
  const startingUrlsText = el('#startingUrls').value || '';
  const startingUrls = startingUrlsText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const findPagesInSitemaps = Boolean(el('#findPagesInSitemaps')?.checked);

  return {
    domain,
    maxPages,
    sameOriginOnly,
    waitUntil,
    headless: !showBrowser,
    flow,
    preAuditActions,
    postAuditActions,
    onPageActions,
    rules,
    startingUrls,
    findPagesInSitemaps
  };
}

function setRules(rules = []) {
  const root = el('#rulesList');
  if (!root || !window.RuleBuilder) return;
  root.innerHTML = '';
  (Array.isArray(rules) ? rules : []).forEach((rule) => window.RuleBuilder.addRule(rule));
  if (!root.children.length) window.RuleBuilder.addRule();
}

function populateConfigPicker(configs = []) {
  const picker = el('#configPicker');
  if (!picker) return;
  picker.innerHTML = '<option value="">Start from scratch</option>' + configs.map((config) => (
    `<option value="${escapeHtml(config.id)}">${escapeHtml(config.name)}${config.isDefault ? ' (Default)' : ''}</option>`
  )).join('');
  if (createAuditState.loadedConfigId) picker.value = createAuditState.loadedConfigId;
}

async function loadAuditConfigs() {
  if (!window.FreeAuditApi) return;
  try {
    const data = await window.FreeAuditApi.apiJson('/api/audit-configs');
    createAuditState.auditConfigs = data.configs || [];
    populateConfigPicker(createAuditState.auditConfigs);
  } catch (err) {
    console.error('Failed to load audit configs', err);
  }
}

function configPrimaryUrl(config = {}) {
  if (config.domain) return config.domain;
  if (Array.isArray(config.urlSources) && config.urlSources[0]) return config.urlSources[0];
  return 'No starting URL set';
}

function renderConfigLauncher() {
  const target = el('#configLandingContent');
  if (!target) return;
  const configs = createAuditState.auditConfigs || [];
  if (!configs.length) {
    target.innerHTML = `
      <div class="launcher-empty">
        <div class="launcher-empty-icon">FA</div>
        <h2>No audit configs yet</h2>
        <p class="muted">Create your first reusable audit config with URL sources, pre-audit actions, On Page actions, rules, and interaction flow steps.</p>
        <a class="button-style" href="/audit-configs.html?new=1">Create Audit Config</a>
      </div>
    `;
    return;
  }

  target.innerHTML = `
    <div class="config-launch-grid">
      ${configs.map((config) => `
        <article class="config-launch-card" data-config-id="${escapeHtml(config.id)}">
          <div class="config-launch-card-top">
            <div>
              <span class="eyebrow">${config.isDefault ? 'Default Config' : 'Audit Config'}</span>
              <h3>${escapeHtml(config.name || 'Untitled Config')}</h3>
              <p>${escapeHtml(config.description || configPrimaryUrl(config))}</p>
            </div>
            <span class="status-pill status-${escapeHtml(config.isDefault ? 'completed' : 'queued')}">${config.isDefault ? 'Default' : 'Saved'}</span>
          </div>
          <div class="config-launch-meta">
            <div><strong>${escapeHtml(config.maxPages || 15)}</strong><span>Target pages</span></div>
            <div><strong>${escapeHtml(config.auditCount || 0)}</strong><span>Audits run</span></div>
            <div><strong>${escapeHtml(config.waitUntil || 'DOM loaded')}</strong><span>Wait until</span></div>
          </div>
          <div class="config-launch-url">${escapeHtml(configPrimaryUrl(config))}</div>
          <div class="config-launch-actions">
            <button class="button-style" type="button" data-run-config="${escapeHtml(config.id)}">Run Audit</button>
            <a class="pill" href="/audit-configs.html?id=${encodeURIComponent(config.id)}">Open Config</a>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function showConfigLauncher() {
  el('#auditForm')?.classList.add('hidden');
  el('#results')?.classList.add('hidden');
  hideStatus();
  const landing = el('#configLanding');
  if (landing) landing.classList.remove('hidden');
  renderConfigLauncher();
}

function showAuditForm() {
  el('#configLanding')?.classList.add('hidden');
  el('#auditForm')?.classList.remove('hidden');
}

async function runConfigFromLauncher(configId) {
  if (!configId || !window.FreeAuditApi) return;
  const config = createAuditState.auditConfigs.find((item) => item.id === configId) || {};
  el('#configLanding')?.classList.add('hidden');
  el('#results')?.classList.add('hidden');
  showStatus();
  setAuditRunContext({ configName: config.name, domain: configPrimaryUrl(config), status: 'starting' });
  setProgress(3, 'Starting audit from saved config...');
  try {
    const data = await window.FreeAuditApi.apiJson(`/api/audit-configs/${encodeURIComponent(configId)}/run`, { method: 'POST', body: {} });
    if (!data.id) throw new Error('Audit did not return a job id');
    window.history.pushState({}, '', `/?auditId=${encodeURIComponent(data.id)}`);
    setAuditRunContext({ id: data.id, configName: config.name, domain: configPrimaryUrl(config), status: 'running' });
    await waitForJob(data.id);
  } catch (err) {
    console.error('Failed to run config', err);
    setProgress(100, err.message || 'Failed to start audit from config.');
  }
}

function fillFormFromPayload(payload = {}, config = null) {
  el('#domain').value = payload.domain || '';
  el('#maxPages').value = payload.maxPages || 15;
  el('#sameOriginOnly').value = payload.sameOriginOnly === false ? 'false' : 'true';
  el('#waitUntil').value = normalizeWaitUntil(payload.waitUntil);
  if (el('#showBrowser')) el('#showBrowser').checked = payload.headless === false;
  el('#startingUrls').value = Array.isArray(payload.startingUrls) ? payload.startingUrls.join('\n') : '';
  if (el('#findPagesInSitemaps')) el('#findPagesInSitemaps').checked = payload.findPagesInSitemaps !== false;
  setStepsInContainer('#preAuditSteps', payload.preAuditActions || []);
  setStepsInContainer('#onPageSteps', payload.postAuditActions || payload.onPageActions || []);
  setStepsInContainer('#steps', payload.flow || []);
  setRules(payload.rules || []);
  if (config) {
    createAuditState.loadedConfigId = config.id;
    const name = el('#loadedConfigName');
    if (name) name.value = config.name || '';
    const picker = el('#configPicker');
    if (picker) picker.value = config.id || '';
  }
}

async function loadConfigIntoForm(configId) {
  if (!configId || !window.FreeAuditApi) return;
  const data = await window.FreeAuditApi.apiJson(`/api/audit-configs/${encodeURIComponent(configId)}`);
  fillFormFromPayload(data.assembledPayload || {}, data.config || null);
}

function buildConfigPayloadFromCurrentForm(nameOverride) {
  const payload = buildPayload();
  return {
    name: nameOverride || el('#loadedConfigName')?.value || payload.domain || 'Untitled Config',
    description: '',
    domain: payload.domain,
    maxPages: payload.maxPages,
    sameOriginOnly: payload.sameOriginOnly,
    waitUntil: payload.waitUntil,
    showBrowser: payload.headless === false,
    urlSources: payload.startingUrls || [],
    includeSitemaps: payload.findPagesInSitemaps !== false,
    options: {
      preAuditActions: payload.preAuditActions || [],
      postAuditActions: payload.postAuditActions || [],
      rules: payload.rules || [],
      flow: payload.flow || []
    },
    isDefault: false
  };
}

async function saveCurrentSetupAsConfig() {
  if (!window.FreeAuditApi) return;
  const fallbackName = el('#loadedConfigName')?.value || el('#domain')?.value || 'New Audit Config';
  const name = window.prompt('Config name', fallbackName);
  if (!name) return;
  const payload = buildConfigPayloadFromCurrentForm(name);
  const url = createAuditState.loadedConfigId
    ? `/api/audit-configs/${encodeURIComponent(createAuditState.loadedConfigId)}`
    : '/api/audit-configs';
  const method = createAuditState.loadedConfigId ? 'PUT' : 'POST';
  const data = await window.FreeAuditApi.apiJson(url, { method, body: payload });
  createAuditState.loadedConfigId = data.config.id;
  await loadAuditConfigs();
  const loadedName = el('#loadedConfigName');
  if (loadedName) loadedName.value = data.config.name;
  alert('Audit config saved.');
}

function applyPendingLibraryItems() {
  const pendingAction = sessionStorage.getItem('freeAudit.pendingActionTemplate');
  if (pendingAction) {
    sessionStorage.removeItem('freeAudit.pendingActionTemplate');
    try {
      const item = JSON.parse(pendingAction);
      const target = item.type === 'post' ? '#onPageSteps' : '#preAuditSteps';
      (item.steps || []).forEach((step) => addStepToContainer(target, step));
    } catch (err) {
      console.error('Failed to apply action template', err);
    }
  }

  const pendingRules = sessionStorage.getItem('freeAudit.pendingRuleSet');
  if (pendingRules) {
    sessionStorage.removeItem('freeAudit.pendingRuleSet');
    try {
      const item = JSON.parse(pendingRules);
      (item.rules || []).forEach((rule) => window.RuleBuilder?.addRule(rule));
    } catch (err) {
      console.error('Failed to apply rule set', err);
    }
  }

  const pendingFlow = sessionStorage.getItem('freeAudit.pendingFlowTemplate');
  if (pendingFlow) {
    sessionStorage.removeItem('freeAudit.pendingFlowTemplate');
    try {
      const item = JSON.parse(pendingFlow);
      (item.steps || []).forEach((step) => addStepToContainer('#steps', step));
    } catch (err) {
      console.error('Failed to apply flow template', err);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const waitUntilEl = el('#waitUntil');
  if (waitUntilEl) {
    waitUntilEl.value = normalizeWaitUntil(waitUntilEl.value);
  }
  el('#addStep').addEventListener('click', () => {
    addStepToContainer('#steps');
  });
  el('#addPreAuditStep').addEventListener('click', () => {
    addStepToContainer('#preAuditSteps', { action: 'executeJavaScript' });
  });
  el('#addOnPageStep').addEventListener('click', () => {
    addStepToContainer('#onPageSteps', { action: 'executeJavaScript' });
  });
  if (window.RuleBuilder) {
    const ruleOptions = await loadRuleCatalog();
    window.RuleBuilder.init({ ruleOptions });
  }
  await loadAuditConfigs();
  el('#configLanding')?.addEventListener('click', (event) => {
    const runButton = event.target.closest('[data-run-config]');
    if (runButton) {
      event.preventDefault();
      event.stopPropagation();
      runConfigFromLauncher(runButton.dataset.runConfig);
      return;
    }
    if (event.target.closest('a, button')) return;
    const card = event.target.closest('[data-config-id]');
    if (card) {
      window.location.href = `/audit-configs.html?id=${encodeURIComponent(card.dataset.configId)}`;
    }
  });
  el('#loadConfig')?.addEventListener('click', async () => {
    const id = el('#configPicker')?.value;
    if (!id) {
      createAuditState.loadedConfigId = null;
      el('#loadedConfigName').value = '';
      return;
    }
    try {
      await loadConfigIntoForm(id);
    } catch (err) {
      alert(err.message || 'Failed to load config');
    }
  });
  el('#saveCurrentConfig')?.addEventListener('click', () => {
    saveCurrentSetupAsConfig().catch((err) => alert(err.message || 'Failed to save config'));
  });
  el('#saveRulesAsSet')?.addEventListener('click', async () => {
    if (!window.FreeAuditApi || !window.RuleBuilder) return;
    const rules = window.RuleBuilder.collectRules();
    if (!rules.length) return alert('Add at least one rule before saving a rule set.');
    const name = window.prompt('Rule set name', `${el('#domain')?.value || 'Audit'} Rules`);
    if (!name) return;
    try {
      await window.FreeAuditApi.apiJson('/api/rule-sets', { method: 'POST', body: { name, description: '', rules } });
      alert('Rule set saved.');
    } catch (err) {
      alert(err.message || 'Failed to save rule set');
    }
  });
  applyPendingLibraryItems();

  el('#auditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    el('#results').classList.add('hidden');
    el('#results').innerHTML = '';

    const payload = buildPayload();
    if (!payload.domain && (!Array.isArray(payload.startingUrls) || !payload.startingUrls.length)) {
      return alert('Please enter a domain/URL or provide at least one starting URL.');
    }

    if (createAuditState.loadedConfigId) {
      payload.configId = createAuditState.loadedConfigId;
    }
    const response = window.FreeAuditApi
      ? await window.FreeAuditApi.apiFetch('/api/audit/start', { method: 'POST', body: payload })
      : await fetch('/api/audit/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
    if (handleUnauthorizedResponse(response)) return;
    const resp = await response.json();
    if (!resp.id) {
      alert(resp.error || 'Failed to start audit');
      return;
    }
    const loadedName = el('#loadedConfigName')?.value || '';
    setAuditRunContext({
      configName: loadedName || (createAuditState.loadedConfigId ? 'Saved config audit' : 'Scratch audit'),
      domain: payload.domain || payload.startingUrls?.[0] || '',
      status: 'running'
    });
    window.history.pushState({}, '', `/?auditId=${encodeURIComponent(resp.id)}`);
    waitForJob(resp.id);
  });
  // Delegated interactions: vendor chips -> open modal; modal close
  document.body.addEventListener('click', (e) => {
    const vt = e.target.closest('.view-tools');
    if (vt) {
      const pageEl = vt.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData) openToolsModal(pageData);
    }
    const vc = e.target.closest('.view-cookies');
    if (vc) {
      const pageEl = vc.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData) openCookiesModal(pageData);
    }
    const vd = e.target.closest('.view-datalayer');
    if (vd) {
      const pageEl = vd.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData) openDataLayerModal(pageData);
    }
    const vcon = e.target.closest('.view-console');
    if (vcon) {
      const pageEl = vcon.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData) openConsoleMessagesModal(pageData);
    }
    const vnet = e.target.closest('.view-network');
    if (vnet) {
      const pageEl = vnet.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData) openNetworkRequestsModal(pageData);
    }
    const vrule = e.target.closest('.view-rules');
    if (vrule) {
      const pageEl = vrule.closest('.page');
      const pagesEls = Array.from(document.querySelectorAll('.page'));
      const idx = pagesEls.indexOf(pageEl);
      const pageData = window.__LATEST_RESULTS?.pages?.[idx];
      if (pageData && window.RuleBuilder) window.RuleBuilder.openPageRulesModal(pageData);
    }
    if (e.target && (e.target.id === 'modalClose' || e.target.id === 'modal')) hideModal();
  });

  const params = new URLSearchParams(window.location.search);
  const savedAuditId = params.get('auditId');
  const configId = params.get('configId');
  const scratchMode = params.get('scratch') === '1';
  if (configId) {
    window.location.replace(`/audit-configs.html?id=${encodeURIComponent(configId)}`);
    return;
  }
  if (savedAuditId) {
    loadSavedAudit(savedAuditId);
    return;
  }
  if (scratchMode) {
    showAuditForm();
    return;
  }
  showConfigLauncher();
});

// --- Live logs via SSE ---
let es; // EventSource
function startLogStream(id) {
  try { if (es) { es.close(); } } catch (_) { }
  const panel = el('#liveLogs');
  const stream = el('#logStream');
  const auto = el('#autoscroll');
  // Show live logs panel during scan and enable 2-column layout
  const layout = document.querySelector('.layout');
  layout?.classList.add('with-logs');
  panel?.classList.remove('hidden');
  panel?.classList.add('full');
  if (stream) stream.innerHTML = '';

  es = new EventSource(`/api/audit/${id}/logs`);
  es.addEventListener('log', (ev) => {
    try {
      const data = JSON.parse(ev.data);
      window.__LOGS__ = window.__LOGS__ || [];
      window.__LOGS__.push(data);
      const line = document.createElement('div');
      const ts = formatTimeIST(data.ts || Date.now());
      const lvl = (data.level || 'info').toLowerCase();
      line.className = `log-line ${lvl}`;
      line.innerHTML = `<div class="time">${ts}</div><div class="level">${lvl}</div><div class="msg">${escapeHtml(data.msg || '')} ${renderExtras(data)}</div>`;
      if (stream) {
        stream.appendChild(line);
        if (auto && auto.checked) stream.scrollTop = stream.scrollHeight;
      }
    } catch (_) { }
  });
  es.addEventListener('done', () => {
    try { es.close(); } catch (_) { }
  });

  el('#clearLogs').onclick = () => { stream.innerHTML = ''; };
}

function renderExtras(d) {
  const clone = { ...d };
  delete clone.ts; delete clone.level; delete clone.msg;
  if (!Object.keys(clone).length) return '';
  return `<span class="muted">${escapeHtml(JSON.stringify(clone))}</span>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Parse user agent to extract device information
function parseUserAgent(userAgent) {
  const ua = userAgent.toLowerCase();

  // Browser detection
  let browser = 'Unknown';
  if (ua.includes('chrome') && !ua.includes('edg')) browser = 'Chrome';
  else if (ua.includes('firefox')) browser = 'Firefox';
  else if (ua.includes('safari') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('edg')) browser = 'Edge';
  else if (ua.includes('opera') || ua.includes('opr')) browser = 'Opera';

  // OS detection
  let os = 'Unknown';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('mac')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('iphone') || ua.includes('ipad')) os = 'iOS';

  // Device type detection
  let deviceType = 'Desktop';
  if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) deviceType = 'Mobile';
  else if (ua.includes('tablet') || ua.includes('ipad')) deviceType = 'Tablet';

  return { browser, os, deviceType };
}

