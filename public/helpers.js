// Helper functions for vendor grouping and modal rendering
// Relies on escapeHtml declared in app.js

// Time formatter (Asia/Kolkata)
window.formatTimeIST = window.formatTimeIST || function(ts){
  try{
    const d = new Date(ts);
    const dtf = new Intl.DateTimeFormat('en-IN', { hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Kolkata' });
    const parts = Object.fromEntries(dtf.formatToParts(d).map(p=>[p.type,p.value]));
    const ms = String(d.getMilliseconds()).padStart(3,'0');
    return `${parts.hour}:${parts.minute}:${parts.second}.${ms}`;
  }catch{ return new Date(ts).toLocaleTimeString(); }
};

function escapeAttr(s){
  try { return (escapeHtml ? escapeHtml(String(s)) : String(s)).replace(/\"/g, '&quot;'); } catch(_) { return String(s); }
}

function groupByVendor(list) {
  const map = {};
  for (const a of list || []) {
    const v = a.vendor || 'Unknown';
    if (!map[v]) map[v] = [];
    map[v].push(a);
  }
  return map;
}

function openVendorModal(page, vendor) {
  const group = (page.analytics || []).filter((a) => (a.vendor || 'Unknown') === vendor);
  window.__MODAL_STATE__ = { type: 'vendor', page, vendor, group };
  const rows = group.map((a, i) => {
    const u = safeURL(a.url);
    const params = u ? Object.fromEntries(u.searchParams.entries()) : {};
    const paramCount = Object.keys(params).length;
    const urlCell = `<div class="break ellipsis" title="${escapeHtml(a.url || '')}">${escapeHtml(a.url || '')}</div>`;
    return `<tr>
      <td><span class="pill">${escapeHtml(a.vendor || '')}</span></td>
      <td>${escapeHtml(a.tagName || a.vendor || '')}</td>
      <td>${escapeHtml(a.matchType || '')}</td>
      <td>${escapeHtml(a.method || '')}</td>
      <td>${escapeHtml(a.resourceType || '')}</td>
      <td>${urlCell}</td>
      <td><span class="pill">${paramCount} params</span> <button class="pill view-request" data-i="${i}">View</button></td>
    </tr>`;
  }).join('');
  const downloadHref = window.__LATEST_JOBID ? `/api/audit/${window.__LATEST_JOBID}/vendor.csv?vendor=${encodeURIComponent(vendor)}` : '#';
  const html = `
    <div class="muted" style="margin-bottom:8px">${escapeHtml(page.url)}</div>
    <div class="actions" style="justify-content:flex-end;margin-bottom:8px; gap:8px">
      <a class="pill" href="${downloadHref}">Download ${escapeHtml(vendor)} CSV</a>
    </div>
    <table class="table">
      <thead><tr><th>Vendor</th><th>Tag</th><th>Match</th><th>Method</th><th>Type</th><th>URL</th><th>Params</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No requests</td></tr>'}</tbody>
    </table>`;
  showModal(`${vendor} requests`, html, { push: true, state: window.__MODAL_STATE__ });

  // Delegate click inside modal for request detail view
  const modal = document.querySelector('#modal');
  if (modal) modal.onclick = null;
  modal?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-request');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-i') || 0);
    const req = window.__MODAL_STATE__?.group?.[idx];
    if (req) openRequestModal(req);
  });
}

function openToolsModal(page) {
  const groups = groupByVendor(page.analytics || []);
  window.__MODAL_STATE__ = { type: 'tools', page };
  const entries = Object.keys(groups).sort().map((v) => {
    const count = groups[v].length;
    return `<tr>
      <td><span class="pill">${escapeHtml(v)}</span></td>
      <td>${count}</td>
      <td><button class="pill view-vendor" data-vendor="${escapeAttr(v)}">Open</button></td>
    </tr>`;
  }).join('');
  const html = `
    <div class="muted" style="margin-bottom:8px">${escapeHtml(page.url)}</div>
    <table class="table"><thead><tr><th>Vendor</th><th>Requests</th><th></th></tr></thead>
    <tbody>${entries || '<tr><td colspan="3" class="muted">No tools detected</td></tr>'}</tbody></table>`;
  resetModalStack();
  showModal('Tools detected', html, { push: true, state: window.__MODAL_STATE__ });

  const modal = document.querySelector('#modal');
  if (modal) modal.onclick = null;
  modal?.addEventListener('click', (e) => {
    const btn = e.target.closest('.view-vendor');
    if (!btn) return;
    const v = btn.getAttribute('data-vendor');
    openVendorModal(page, v);
  });
}

function openRequestModal(req) {
  const u = safeURL(req.url || '');
  const params = u ? Object.fromEntries(u.searchParams.entries()) : {};
  const paramsRows = Object.entries(params).map(([k,v]) => `<tr><td>${escapeHtml(k)}</td><td class="code"><span class="break">${escapeHtml(v)}</span></td></tr>`).join('');
  const docs = Array.isArray(req.documentation) ? req.documentation : [];
  const endpoints = req.endpoints && typeof req.endpoints === 'object' ? req.endpoints : {};
  const docLinks = docs.length
    ? docs.map((doc) => `<a class="pill" href="${escapeAttr(doc.url || '#')}" target="_blank" rel="noreferrer">${escapeHtml(doc.label || 'Vendor documentation')}</a>`).join(' ')
    : '<span class="muted">No documentation mapped</span>';
  const endpointRows = Object.entries(endpoints)
    .filter(([, values]) => Array.isArray(values) && values.length)
    .map(([key, values]) => `<tr><td>${escapeHtml(key)}</td><td class="code break">${escapeHtml(values.join('\n'))}</td></tr>`)
    .join('');
  const meta = `
    <table class="table"><tbody>
      <tr><th>Vendor</th><td>${escapeHtml(req.vendor || '')}</td></tr>
      <tr><th>Tag</th><td>${escapeHtml(req.tagName || req.vendor || '')}</td></tr>
      <tr><th>Match Type</th><td>${escapeHtml(req.matchType || '')}</td></tr>
      <tr><th>Method</th><td>${escapeHtml(req.method || '')}</td></tr>
      <tr><th>Type</th><td>${escapeHtml(req.resourceType || '')}</td></tr>
      <tr><th>Request URL</th><td><div class="code break">${escapeHtml(req.url || '')}</div></td></tr>
      <tr><th>Vendor Docs</th><td>${docLinks}</td></tr>
    </tbody></table>`;
  const endpointsHtml = endpointRows
    ? `<table class="table"><thead><tr><th>Endpoint Group</th><th>Mapped Patterns</th></tr></thead><tbody>${endpointRows}</tbody></table>`
    : '<div class="muted" style="margin:12px 0;">No endpoint patterns mapped for this request.</div>';
  const paramsHtml = `<table class="table"><thead><tr><th>Param</th><th>Value</th></tr></thead><tbody>${paramsRows || '<tr><td colspan="2" class="muted">No query parameters</td></tr>'}</tbody></table>`;
  showModal('Request details', meta + endpointsHtml + paramsHtml, { push: true, state: window.__MODAL_STATE__ });
}

function safeURL(u){ try { return new URL(u); } catch { return null; } }

// Modal navigation stack
window.__MODAL_STACK = window.__MODAL_STACK || [];

function showModal(title, bodyHtml, opts = { push: true, state: null }){
  const t = document.querySelector('#modalTitle');
  const b = document.querySelector('#modalBody');
  const m = document.querySelector('#modal');
  if (opts.push && m && !m.classList.contains('hidden')) {
    // Save current
    window.__MODAL_STACK.push({ title: t?.innerHTML || '', body: b?.innerHTML || '', state: window.__MODAL_STATE__ || null });
  }
  if (t) t.innerHTML = title;
  if (b) b.innerHTML = bodyHtml;
  if (m) m.classList.remove('hidden');
  if (opts.state !== undefined) window.__MODAL_STATE__ = opts.state;
  updateModalBack();
  window.FreeAuditReportUI?.openDialog(m);
}
function hideModal(){ const m = document.querySelector('#modal'); if (m) m.classList.add('hidden'); resetModalStack(); window.FreeAuditReportUI?.closeDialog(m); }

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.getElementById('modal')?.classList.contains('hidden')) hideModal();
});

function resetModalStack(){ window.__MODAL_STACK = []; updateModalBack(); }

function updateModalBack(){
  const back = document.getElementById('modalBack');
  if (!back) return;
  back.classList.toggle('hidden', (window.__MODAL_STACK || []).length === 0);
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'modalBack') {
    const prev = (window.__MODAL_STACK || []).pop();
    if (prev) showModal(prev.title, prev.body, { push: false, state: prev.state || null }); else updateModalBack();
  }
});

// Cookies modal (1P / 3P tabs)
function isFirstPartyCookieFront(cookie, pageUrl){
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    const cd = (cookie.domain || '').replace(/^\./,'').toLowerCase();
    if (!cd) return true;
    return host === cd || host.endsWith(`.${cd}`) || cd.endsWith(`.${host}`);
  } catch { return false; }
}

function openCookiesModal(page) {
  const cookies = Array.isArray(page.cookies) ? page.cookies : [];
  const first = [], third = [];
  for (const c of cookies) {
    (isFirstPartyCookieFront(c, page.url) ? first : third).push(c);
  }
  const table = (list) => {
    return `<table class="table"><thead><tr>
      <th>Name</th><th>Domain</th><th>Path</th><th>Expires</th><th>HttpOnly</th><th>Secure</th><th>SameSite</th><th>Value</th>
    </tr></thead><tbody>
    ${list.map(c => {
      const value = String(c.value || '');
      const short = shorten(value, 120);
      return `<tr>
      <td>${escapeHtml(c.name||'')}</td>
      <td>${escapeHtml(c.domain||'')}</td>
      <td>${escapeHtml(c.path||'')}</td>
      <td>${escapeHtml(String(c.expires||''))}</td>
      <td>${c.httpOnly? 'true':'false'}</td>
      <td>${c.secure? 'true':'false'}</td>
      <td>${escapeHtml(c.sameSite||'')}</td>
      <td><span class="code ellipsis cookie-value" data-cookie-raw="${escapeAttr(value)}" title="${escapeAttr(value)}">${escapeHtml(short)}</span></td>
    </tr>`; }).join('')}
    </tbody></table>`;
  };

  const html = `
    <div class="muted" style="margin-bottom:8px">${escapeHtml(page.url)}</div>
    <div class="modal-tools" style="margin-bottom:8px">
      <label class="check-label compact"><input type="checkbox" data-cookie-decode /> Show decoded cookie values</label>
      <span class="muted">${cookies.length} cookie(s)</span>
    </div>
    <div class="tabbar" style="display:flex; gap:8px; margin-bottom:8px">
      <button class="pill tab active" data-tab="fp">First-Party (${first.length})</button>
      <button class="pill tab" data-tab="tp">Third-Party (${third.length})</button>
    </div>
    <div class="tabcontent" data-tab="fp">${table(first)}</div>
    <div class="tabcontent hidden" data-tab="tp">${table(third)}</div>
  `;
  window.__MODAL_STATE__ = { type: 'cookies', page };
  resetModalStack();
  showModal('Cookies', html, { push: true, state: window.__MODAL_STATE__ });

  // Wire tab switching
  const modal = document.querySelector('#modal');
  modal?.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    const which = b.getAttribute('data-tab');
    for (const el of modal.querySelectorAll('.tab')) el.classList.remove('active');
    b.classList.add('active');
    for (const tc of modal.querySelectorAll('.tabcontent')) {
      tc.classList.toggle('hidden', tc.getAttribute('data-tab') !== which);
    }
  });
}

function shorten(s, n){ s = String(s); return s.length > n ? s.slice(0, n-1) + '...' : s; }

function decodeCookieValueFront(value) {
  const raw = String(value == null ? '' : value);
  try {
    return decodeURIComponent(raw.replace(/\+/g, '%20'));
  } catch {
    return raw;
  }
}

document.addEventListener('input', (event) => {
  const toggle = event.target && event.target.closest ? event.target.closest('[data-cookie-decode]') : null;
  if (!toggle) return;
  const shouldDecode = toggle.checked;
  document.querySelectorAll('[data-cookie-raw]').forEach((node) => {
    const raw = node.dataset.cookieRaw || '';
    const shown = shouldDecode ? decodeCookieValueFront(raw) : raw;
    const shortened = shorten(shown, 120);
    node.textContent = shortened;
    node.setAttribute('title', shown);
  });
});

function openDataLayerModal(page) {
  window.__MODAL_STATE__ = { type: 'datalayer', page };
  const html = `
    <div class="muted" style="margin-bottom:8px">${escapeHtml(page.url)}</div>
    ${window.FreeAuditJson.dataLayer(page.dataLayer)}
  `;
  resetModalStack();
  showModal('dataLayer', html, { push: true, state: window.__MODAL_STATE__ });
}

// Keep the helper names compatible while using the shared inspector.
function renderJSONConsole(value, key) { return window.FreeAuditJson.render(value, { label: key || 'JSON' }); }
function renderJSONTree(value, key) { return window.FreeAuditJson.render(value, { label: key || 'JSON' }); }

// Logs modal - render accumulated logs in a modal
function openLogsModal() {
  const logs = window.__LOGS__ || [];
  const rows = logs.map((data) => {
    const ts = window.formatTimeIST ? window.formatTimeIST(data.ts || Date.now()) : new Date(data.ts || Date.now()).toLocaleTimeString();
    const lvl = (data.level || 'info').toUpperCase();
    const extra = (() => { const c = { ...data }; delete c.ts; delete c.level; delete c.msg; return c; })();
    return `<div class="log-line ${escapeHtml((data.level||'').toLowerCase())}">` +
      `<div class="time">${ts}</div>` +
      `<div class="level">${lvl}</div>` +
      `<div class="msg">${escapeHtml(data.msg || '')} <span class="muted">${escapeHtml(JSON.stringify(extra))}</span></div>` +
    `</div>`;
  }).join('');
  const html = `<div class="log-modal-stream" style="max-height:70vh; overflow:auto">${rows || '<div class="muted">No logs</div>'}</div>`;
  showModal('Backend Logs', html);
}

// Request Headers modal - render full request headers information

function openRequestHeadersModal() {
  const results = window.__LATEST_RESULTS;
  if (!results || !results.requestHeaders) {
    showModal('Request Headers', '<div class="muted">No request headers data available</div>');
    return;
  }

  const headers = results.requestHeaders;
  const geo = headers.geoLocation || {};

  const headerRows = [
    ['IP Address', headers.ipAddress || 'Unknown'],
    ['User Agent', headers.userAgent || 'Unknown'],
    ['Accept Language', headers.acceptLanguage || 'Unknown'],
    ['Accept Encoding', headers.acceptEncoding || 'Unknown'],
    ['Referer', headers.referer || 'Direct'],
    ['Host', headers.host || 'Unknown'],
    ['Connection', headers.connection || 'Unknown'],
    ['Timestamp', headers.timestamp || 'Unknown']
  ].map(([key, value]) => `
    <tr>
      <td><strong>${escapeHtml(key)}</strong></td>
      <td class="code break">${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const geoRows = [
    ['Country', geo.country || 'Unknown'],
    ['City', geo.city || 'Unknown'],
    ['Region', geo.region || 'Unknown'],
    ['Timezone', geo.timezone || 'Unknown'],
    ['Organization', geo.org || 'Unknown']
  ].map(([key, value]) => `
    <tr>
      <td><strong>${escapeHtml(key)}</strong></td>
      <td>${escapeHtml(value)}</td>
    </tr>
  `).join('');

  const additionalHeaders = headers.allHeaders && typeof headers.allHeaders === 'object' ? headers.allHeaders : {};
  const allHeaderEntries = Object.entries(additionalHeaders).sort((a, b) => a[0].localeCompare(b[0]));
  const allHeaderRows = allHeaderEntries.length
    ? allHeaderEntries.map(([key, value]) => {
        let display = value;
        if (Array.isArray(display)) {
          display = display.join(', ');
        } else if (display && typeof display === 'object') {
          try { display = JSON.stringify(display, null, 2); }
          catch { display = String(display); }
        } else if (display === undefined || display === null) {
          display = '';
        }
        return `
    <tr>
      <td><strong>${escapeHtml(key)}</strong></td>
      <td class="code break">${escapeHtml(String(display))}</td>
    </tr>
  `;
      }).join('')
    : '<tr><td colspan="2" class="muted">No additional headers</td></tr>';

  const html = `
    <div style="margin-bottom:16px;">
      <h4>Request Headers</h4>
      <table class="table">
        <tbody>${headerRows}</tbody>
      </table>
    </div>
    <div>
      <h4>Geographic Information</h4>
      <table class="table">
        <tbody>${geoRows}</tbody>
      </table>
    </div>
    <div style="margin-top:16px;">
      <h4>All Headers</h4>
      <table class="table">
        <tbody>${allHeaderRows}</tbody>
      </table>
    </div>
  `;

  showModal('Full Request Headers', html);
}


// Page Console Messages modal - show messages captured during crawl
function openConsoleMessagesModal(page) {
  const msgs = Array.isArray(page.console) ? page.console : [];
  const items = msgs.map((m) => {
    const cls = `console-message console-${(m.type || 'log').toLowerCase()}`;
    const time = window.formatTimeIST ? window.formatTimeIST(m.ts || Date.now()) : new Date(m.ts || Date.now()).toLocaleTimeString();
    const content = escapeHtml(m.text || '');
    return `<div class="${cls}"><div class="console-time">${time}</div><div class="console-content">${content}</div></div>`;
  }).join('');
  const total = msgs.length;
  const errors = msgs.filter((m) => (m.type || '').toLowerCase() === 'error').length;
  const html = `
    <div class="muted" style="margin-bottom:8px">${escapeHtml(page.url || '')}</div>
    <div class="console-summary"><div class="muted">Messages: ${total} | Errors: ${errors}</div></div>
    <div class="console-messages">${items || '<div class="muted">No console messages captured</div>'}</div>
  `;
  showModal('Console Messages', html, { push: true });
}

function getNetworkRequestStatusText(request) {
  if (request.failed) return 'failed';
  if (request.status != null) {
    return `${request.status}${request.statusText ? ` ${request.statusText}` : ''}`;
  }
  return 'pending';
}

function getNetworkRequestSearchText(request) {
  const parsed = safeURL(request.url || '');
  return [
    request.id,
    getNetworkRequestStatusText(request),
    request.method,
    request.resourceType,
    parsed ? parsed.host : '',
    request.url,
    request.failureText
  ].filter(Boolean).join(' ').toLowerCase();
}

function renderHeaderTable(headers, emptyText = 'No headers captured') {
  const entries = headers && typeof headers === 'object' ? Object.entries(headers).sort((a, b) => a[0].localeCompare(b[0])) : [];
  const rows = entries.map(([key, value]) => {
    const rendered = Array.isArray(value)
      ? value.join(', ')
      : (value && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
    return `<tr><td><strong>${escapeHtml(key)}</strong></td><td class="code break">${escapeHtml(rendered)}</td></tr>`;
  }).join('');
  return `<table class="table"><tbody>${rows || `<tr><td colspan="2" class="muted">${escapeHtml(emptyText)}</td></tr>`}</tbody></table>`;
}

function parsePreviewJson(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function renderPreviewContent(preview) {
  const text = String(preview && preview.text != null ? preview.text : '');
  const parsed = preview && preview.format === 'json' ? parsePreviewJson(text) : parsePreviewJson(text);
  if (parsed) {
    return window.FreeAuditJson.render(parsed, { label: 'JSON' });
  }
  return `<pre class="network-code">${escapeHtml(text)}</pre>`;
}

function renderPreviewSection(title, preview, emptyText) {
  if (!preview) {
    return `<div class="network-detail-section"><h4>${escapeHtml(title)}</h4><div class="muted">${escapeHtml(emptyText)}</div></div>`;
  }
  if (preview.omitted) {
    const extra = [];
    if (preview.reason) extra.push(preview.reason);
    if (preview.contentType) extra.push(`Content-Type: ${preview.contentType}`);
    return `<div class="network-detail-section"><h4>${escapeHtml(title)}</h4><div class="muted">${escapeHtml(extra.join(' | ') || emptyText)}</div></div>`;
  }
  const meta = [];
  if (preview.format) meta.push(preview.format.toUpperCase());
  if (preview.originalLength != null) meta.push(`${preview.originalLength} chars`);
  if (preview.truncated) meta.push('truncated');
  return `
    <div class="network-detail-section">
      <div class="network-detail-section-header">
        <h4>${escapeHtml(title)}</h4>
        <span class="pill">${escapeHtml(meta.join(' | ') || 'preview')}</span>
      </div>
      ${renderPreviewContent(preview)}
    </div>
  `;
}

function openNetworkRequestDetailModal(page, request) {
  const parsed = safeURL(request.url || '');
  const html = `
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(page.url || '')}</div>
    <div class="network-detail-grid">
      <div class="network-detail-section">
        <h4>Overview</h4>
        <table class="table">
          <tbody>
            <tr><td><strong>Method</strong></td><td>${escapeHtml(request.method || '')}</td></tr>
            <tr><td><strong>Status</strong></td><td>${escapeHtml(request.status != null ? `${request.status}${request.statusText ? ` ${request.statusText}` : ''}` : (request.failed ? 'Failed' : 'Pending'))}</td></tr>
            <tr><td><strong>Type</strong></td><td>${escapeHtml(request.resourceType || '')}</td></tr>
            <tr><td><strong>Host</strong></td><td>${escapeHtml(parsed ? parsed.host : '')}</td></tr>
            <tr><td><strong>Request URL</strong></td><td class="code break">${escapeHtml(request.url || '')}</td></tr>
            <tr><td><strong>From Cache</strong></td><td>${request.fromCache ? 'Yes' : 'No'}</td></tr>
            <tr><td><strong>Service Worker</strong></td><td>${request.fromServiceWorker ? 'Yes' : 'No'}</td></tr>
            <tr><td><strong>Failure</strong></td><td>${escapeHtml(request.failureText || 'None')}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="network-detail-section">
        <h4>Request Headers</h4>
        ${renderHeaderTable(request.requestHeaders, 'No request headers captured')}
      </div>
      <div class="network-detail-section">
        <h4>Response Headers</h4>
        ${renderHeaderTable(request.responseHeaders, 'No response headers captured')}
      </div>
      ${renderPreviewSection('Request Payload', request.requestPayload, 'No request payload')}
      ${renderPreviewSection('Response Preview', request.responsePreview, 'No response preview')}
    </div>
  `;
  showModal(`Network Request #${escapeHtml(String(request.id || ''))}`, html, { push: true, state: { type: 'network-detail', page, request } });
}

function openNetworkRequestsModal(page) {
  const requests = Array.isArray(page.networkRequests) ? page.networkRequests : [];
  const failedCount = requests.filter((request) => request.failed || (request.status != null && request.status >= 400)).length;
  const xhrCount = requests.filter((request) => ['xhr', 'fetch'].includes(String(request.resourceType || '').toLowerCase())).length;
  const documentCount = requests.filter((request) => String(request.resourceType || '').toLowerCase() === 'document').length;

  function renderRows(query = '') {
    const normalized = String(query || '').trim().toLowerCase();
    const filtered = requests
      .map((request, index) => ({ request, index }))
      .filter(({ request }) => !normalized || getNetworkRequestSearchText(request).includes(normalized));

    const rows = filtered.map(({ request, index }) => {
      const parsed = safeURL(request.url || '');
      return `
        <tr>
          <td class="network-index-col">${index + 1}</td>
          <td class="network-url-col">
            <div class="network-url-cell" title="${escapeAttr(request.url || '')}">${escapeHtml(request.url || '')}</div>
          </td>
          <td class="network-status-col">${escapeHtml(getNetworkRequestStatusText(request))}</td>
          <td class="network-method-col">${escapeHtml(request.method || '')}</td>
          <td class="network-type-col">${escapeHtml(request.resourceType || '')}</td>
          <td class="network-host-col">${escapeHtml(parsed ? parsed.host : '')}</td>
          <td class="network-open-col"><button class="pill view-network-request" data-i="${index}">Open</button></td>
        </tr>
      `;
    }).join('');

    return {
      rows,
      filteredCount: filtered.length
    };
  }

  const html = `
    <div class="muted" style="margin-bottom:10px;">${escapeHtml(page.url || '')}</div>
    <div class="network-summary-grid">
      <div class="card"><div class="muted">Total Requests</div><div style="font-size:22px">${requests.length}</div></div>
      <div class="card"><div class="muted">XHR / Fetch</div><div style="font-size:22px">${xhrCount}</div></div>
      <div class="card"><div class="muted">Documents</div><div style="font-size:22px">${documentCount}</div></div>
      <div class="card"><div class="muted">Failed / Error</div><div style="font-size:22px">${failedCount}</div></div>
    </div>
    <div class="network-filter-bar">
      <input id="networkRequestFilter" class="network-filter-input" type="text" placeholder="Search by URL, status, method, type, host..." autocomplete="off" />
      <div id="networkRequestFilterCount" class="network-filter-meta"></div>
    </div>
    <table class="table network-request-table">
      <thead>
        <tr>
          <th class="network-index-col">#</th>
          <th class="network-url-col">Request URL</th>
          <th class="network-status-col">Status</th>
          <th class="network-method-col">Method</th>
          <th class="network-type-col">Type</th>
          <th class="network-host-col">Host</th>
          <th class="network-open-col"></th>
        </tr>
      </thead>
      <tbody id="networkRequestTableBody"></tbody>
    </table>
  `;

  window.__MODAL_STATE__ = { type: 'network', page, requests, query: '' };
  resetModalStack();
  showModal('Network Requests', html, { push: true, state: window.__MODAL_STATE__ });

  const tbody = document.querySelector('#networkRequestTableBody');
  const filterInput = document.querySelector('#networkRequestFilter');
  const filterCount = document.querySelector('#networkRequestFilterCount');
  const renderFilteredRows = (query = '') => {
    const { rows, filteredCount } = renderRows(query);
    if (tbody) {
      tbody.innerHTML = rows || '<tr><td colspan="7" class="muted network-empty">No matching network requests</td></tr>';
    }
    if (filterCount) {
      filterCount.textContent = `${filteredCount} of ${requests.length} requests shown`;
    }
  };
  renderFilteredRows('');

  filterInput?.addEventListener('input', (e) => {
    const query = e.target.value || '';
    if (window.__MODAL_STATE__) window.__MODAL_STATE__.query = query;
    renderFilteredRows(query);
  });

  const modal = document.querySelector('#modal');
  if (modal) {
    modal.onclick = (e) => {
    const btn = e.target.closest('.view-network-request');
    if (!btn) return;
    const idx = Number(btn.getAttribute('data-i') || -1);
    const request = window.__MODAL_STATE__?.requests?.[idx];
    if (request) openNetworkRequestDetailModal(page, request);
    };
  }
}


