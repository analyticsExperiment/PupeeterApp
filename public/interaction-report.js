(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const params = new URLSearchParams(window.location.search);
  const runId = params.get('id');
  let results = null;
  let modalStack = [];

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function statusClass(status) {
    const value = String(status || '').toLowerCase();
    if (['passed', 'completed'].includes(value)) return 'status-passed';
    if (value === 'failed') return 'status-failed';
    if (value === 'skipped') return 'status-skipped';
    return 'status-running';
  }

  function duration(ms) {
    const value = Number(ms) || 0;
    if (value >= 60000) return `${Math.floor(value / 60000)}m ${Math.round((value % 60000) / 1000)}s`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
    return `${value}ms`;
  }

  function hostFromUrl(url) {
    try { return new URL(url).host; } catch (_) { return '-'; }
  }

  function decodeCookieValue(value) {
    const raw = String(value == null ? '' : value);
    try {
      return decodeURIComponent(raw.replace(/\+/g, '%20'));
    } catch (_) {
      return raw;
    }
  }

  function parseMaybeJson(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function renderPayloadBlock(title, preview, emptyText) {
    const payload = preview && typeof preview === 'object' && Object.prototype.hasOwnProperty.call(preview, 'text')
      ? preview
      : { text: preview || '', format: 'text' };
    const text = String(payload.text || '').trim();
    if (preview && typeof preview === 'object' && preview.omitted) {
      const reason = [preview.reason, preview.contentType ? `Content-Type: ${preview.contentType}` : '', preview.declaredLength ? `${preview.declaredLength} bytes` : ''].filter(Boolean).join(' | ');
      return `<h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(reason || emptyText)}</p>`;
    }
    const parsed = payload.format === 'json' ? parseMaybeJson(text) : parseMaybeJson(text);
    const meta = [
      payload.format ? String(payload.format).toUpperCase() : '',
      payload.originalLength != null ? `${payload.originalLength} chars` : '',
      payload.truncated ? 'truncated' : ''
    ].filter(Boolean).join(' | ');
    if (!text) {
      return `<h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(emptyText)}</p>`;
    }
    return `
      <h3>${escapeHtml(title)}</h3>
      ${meta ? `<div class="muted payload-meta">${escapeHtml(meta)}</div>` : ''}
      ${parsed
        ? window.FreeAuditJson.render(parsed, { label: title })
        : `<pre class="json-block">${escapeHtml(text)}</pre>`}
    `;
  }

  function setStatus(message, kind = 'info') {
    const host = document.getElementById('interactionReportStatus');
    host.classList.remove('hidden');
    host.innerHTML = `<div class="${kind === 'error' ? 'login-error' : ''}">${escapeHtml(message)}</div>`;
  }

  function hideStatus() {
    document.getElementById('interactionReportStatus').classList.add('hidden');
  }

  function openModal(title, bodyHtml, previous) {
    if (previous) modalStack.push(previous);
    document.getElementById('interactionModalTitle').textContent = title;
    document.getElementById('interactionModalBody').innerHTML = bodyHtml;
    document.getElementById('interactionModalBack').classList.toggle('hidden', modalStack.length === 0);
    document.getElementById('interactionModal').classList.remove('hidden');
    window.FreeAuditReportUI?.openDialog(document.getElementById('interactionModal'));
  }

  function closeModal() {
    modalStack = [];
    document.getElementById('interactionModal').classList.add('hidden');
    window.FreeAuditReportUI?.closeDialog(document.getElementById('interactionModal'));
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });

  function goBackModal() {
    const previous = modalStack.pop();
    if (!previous) return;
    document.getElementById('interactionModalTitle').textContent = previous.title;
    document.getElementById('interactionModalBody').innerHTML = previous.body;
    document.getElementById('interactionModalBody').dataset.requestSource = previous.requestSource || '';
    document.getElementById('interactionModalBack').classList.toggle('hidden', modalStack.length === 0);
  }

  function currentModalState() {
    const body = document.getElementById('interactionModalBody');
    return {
      title: document.getElementById('interactionModalTitle').textContent,
      body: body.innerHTML,
      requestSource: body.dataset.requestSource || ''
    };
  }

  function summaryCard(label, value) {
    return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function renderSummary() {
    const summary = results.summary || {};
    const steps = asArray(results.steps);
    const rules = steps.flatMap(step => asArray(step.ruleResults));
    const failedRules = Math.max(Number(summary.failedRules) || 0, rules.filter(rule => rule.status === 'failed').length);
    const passedRules = Math.max(Number(summary.passedRules) || 0, rules.filter(rule => rule.status === 'passed').length);
    const skippedRules = rules.filter(rule => rule.status !== 'passed' && rule.status !== 'failed').length;
    const failedSteps = Math.max(Number(summary.failedSteps) || 0, steps.filter(step => step.status === 'failed' || step.error).length);
    const totalSteps = summary.totalSteps ?? steps.length;
    const finished = steps.length >= totalSteps && steps.every(step => ['passed', 'skipped'].includes(step.status));
    const execution = failedSteps || results.error ? 'Failed' : !totalSteps ? 'Not run' : finished ? (steps.some(step => step.status === 'passed') ? 'Passed' : 'Skipped') : 'Incomplete';
    const validation = failedRules ? 'Failed' : passedRules ? 'Passed' : skippedRules ? 'Not applied' : 'Not evaluated';
    document.getElementById('reportSubtitle').textContent = `${results.config?.name || 'Interaction'} • ${results.config?.startingUrl || ''}`;
    document.getElementById('downloadInteractionCsv').classList.remove('hidden');
    document.getElementById('downloadInteractionJson').classList.remove('hidden');
    document.getElementById('downloadInteractionCsv').href = `/api/interaction-runs/${encodeURIComponent(runId)}/csv`;
    document.getElementById('downloadInteractionJson').href = `/api/interaction-runs/${encodeURIComponent(runId)}/json`;
    document.getElementById('interactionReportSummary').classList.remove('hidden');
    document.getElementById('interactionReportSummary').innerHTML = `
      <div class="interaction-report-header">
        <div>
          <h2>${escapeHtml(results.config?.name || 'Interaction')}</h2>
          <p class="muted">${escapeHtml(results.config?.description || 'Guided journey report')}</p>
        </div>
        <div class="toolbar">
          <button class="pill" type="button" data-view-overall="requests">All Network Requests</button>
          <button class="pill" type="button" data-view-overall="tags">Detected Tags</button>
          <button class="pill" type="button" data-view-overall="console">All Console</button>
          <button class="pill" type="button" data-view-overall="cookies">Final Cookies</button>
          <button class="pill" type="button" data-view-overall="datalayer">Final dataLayer</button>
          <span class="status-pill ${statusClass(results.status)}">Overall: ${escapeHtml(results.status || 'unknown')}</span>
        </div>
      </div>
      <div class="report-outcomes" aria-label="Run outcomes">
        <div><span>Step execution</span><strong id="executionOutcome" class="outcome-${execution.toLowerCase().replace(/ /g, '-')}">${execution}</strong><small>${failedSteps} failed / ${escapeHtml(totalSteps)} steps</small></div>
        <div><span>Rule validation</span><strong id="validationOutcome" class="outcome-${validation.toLowerCase().replace(/ /g, '-')}">${validation}</strong><small>${failedRules} failed / ${passedRules} passed evaluations</small></div>
      </div>
      <div class="summary-list interaction-summary-list">
        ${results.error ? `<div class="login-error">${escapeHtml(String(results.error))}</div>` : ''}
        <div><span>Starting URL</span><strong>${escapeHtml(results.config?.startingUrl || '-')}</strong></div>
        <div><span>Final URL</span><strong>${escapeHtml(results.finalUrl || summary.finalUrl || '-')}</strong></div>
        <div><span>Run Date</span><strong>${escapeHtml(formatDateTime(results.startedAt))}</strong></div>
        <div><span>Total Duration</span><strong>${escapeHtml(duration(results.durationMs || summary.durationMs))}</strong></div>
      </div>
      <div class="metrics-grid">
        ${summaryCard('Total Steps', summary.totalSteps || asArray(results.steps).length)}
        ${summaryCard('Passed Steps', summary.passedSteps || 0)}
        ${summaryCard('Failed Steps', failedSteps)}
        ${summaryCard('Network Requests', summary.totalRequests || asArray(results.networkRequests).length)}
        ${summaryCard('Tags Detected', summary.detectedRequests || asArray(results.analytics).length)}
        ${summaryCard('Console Messages', summary.consoleMessages || asArray(results.console).length)}
        ${summaryCard('Failed Rules', failedRules)}
      </div>
    `;
  }

  function renderSteps() {
    const host = document.getElementById('interactionStepResults');
    host.innerHTML = asArray(results.steps).map((step, index) => {
      const open = index === 0 || step.status === 'failed' || step.error || asArray(step.ruleResults).some(rule => rule.status === 'failed');
      return `
      <article class="section step-result-card ${open ? 'is-open' : 'is-collapsed'}">
        <div class="step-result-header">
          <div>
            <h2>Step ${escapeHtml(step.stepNumber)}: ${escapeHtml(step.stepName || step.action)}</h2>
            <p class="muted">${escapeHtml(step.action || '-')} • ${escapeHtml(duration(step.durationMs))}</p>
          </div>
          <div class="toolbar">
            <button class="pill step-result-toggle" type="button" data-toggle-step-result aria-expanded="${Boolean(open)}">${open ? 'Collapse' : 'Open'}</button>
            <span class="status-pill ${statusClass(step.status)}">${escapeHtml(step.status || '-')}</span>
          </div>
        </div>
        <div class="step-result-body">
          ${step.error ? `<div class="login-error">${escapeHtml(step.error)}</div>` : ''}
          ${step.warning ? `<div class="status warning">${escapeHtml(step.warning)}</div>` : ''}
          <div class="summary-list interaction-summary-list">
          <div><span>URL before</span><strong>${escapeHtml(step.urlBefore || '-')}</strong></div>
          <div><span>URL after</span><strong>${escapeHtml(step.urlAfter || '-')}</strong></div>
          <div><span>Requests</span><strong>${asArray(step.networkRequests).length}</strong></div>
          <div><span>Detected Tags</span><strong>${asArray(step.analytics).length}</strong></div>
          <div><span>Console</span><strong>${asArray(step.console).length}</strong></div>
          <div><span>Rules</span><strong>${asArray(step.ruleResults).length}</strong></div>
          </div>
          <div class="step-result-actions">
          <button class="pill" type="button" data-view="requests" data-step="${step.stepNumber}">Network Requests</button>
          <button class="pill" type="button" data-view="tags" data-step="${step.stepNumber}">Tags Detected</button>
          <button class="pill" type="button" data-view="console" data-step="${step.stepNumber}">Console</button>
          <button class="pill" type="button" data-view="cookies" data-step="${step.stepNumber}">Cookies</button>
          <button class="pill" type="button" data-view="datalayer" data-step="${step.stepNumber}">dataLayer</button>
          <button class="pill" type="button" data-view="rules" data-step="${step.stepNumber}">Rules</button>
          ${step.screenshotBase64 ? `<button class="pill" type="button" data-view="screenshot" data-step="${step.stepNumber}">Screenshot</button>` : ''}
          </div>
        </div>
      </article>
    `; }).join('');
  }

  function requestRows(requests) {
    return asArray(requests).map((req, index) => {
      const status = req.status ? `${req.status} ${req.statusText || ''}`.trim() : (req.failed ? 'Failed' : 'Pending');
      const search = [req.url, status, req.method, req.resourceType, hostFromUrl(req.url)].join(' ').toLowerCase();
      return `
        <tr data-request-row data-search="${escapeHtml(search)}">
          <td>${index + 1}</td>
          <td class="request-url-cell">${escapeHtml(req.url || '-')}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(req.method || '-')}</td>
          <td>${escapeHtml(req.resourceType || '-')}</td>
          <td>${escapeHtml(hostFromUrl(req.url))}</td>
          <td><a class="pill" target="_blank" rel="noopener" href="${escapeHtml(req.url || '#')}">Open</a></td>
          <td><button class="pill" type="button" data-request-detail="${index}">Details</button></td>
        </tr>
      `;
    }).join('');
  }

  function showRequests(title, requests) {
    const body = `
      <div class="modal-tools">
        <input type="text" data-request-filter placeholder="Filter requests by URL, host, method, status, or type..." />
        <span class="muted">${asArray(requests).length} request(s)</span>
      </div>
      <div class="table-wrap request-table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Request URL</th>
              <th>Status</th>
              <th>Method</th>
              <th>Type</th>
              <th>Host</th>
              <th>Open</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>${requestRows(requests)}</tbody>
        </table>
      </div>
    `;
    openModal(title, body);
    document.getElementById('interactionModalBody').dataset.requestSource = JSON.stringify(asArray(requests));
  }

  function keyValueRows(obj) {
    const entries = Object.entries(obj || {});
    if (!entries.length) return '<p class="muted">No data captured.</p>';
    return `
      <table>
        <tbody>
          ${entries.map(([key, value]) => `
            <tr>
              <th>${escapeHtml(key)}</th>
              <td><pre>${escapeHtml(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}</pre></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function showRequestDetail(req) {
    const body = `
      <h3>Overview</h3>
      ${keyValueRows({
        Method: req.method || '-',
        Status: req.status ? `${req.status} ${req.statusText || ''}`.trim() : (req.failed ? 'Failed' : 'Pending'),
        Type: req.resourceType || '-',
        Host: hostFromUrl(req.url),
        'Request URL': req.url || '-',
        Failed: req.failed ? 'Yes' : 'No',
        'Failure Text': req.failureText || '-',
        'From Cache': req.fromCache ? 'Yes' : 'No',
        'Service Worker': req.fromServiceWorker ? 'Yes' : 'No'
      })}
      <h3>Request Headers</h3>
      ${keyValueRows(req.requestHeaders || {})}
      ${renderPayloadBlock('Request Payload', req.requestPayload, 'No payload captured')}
      <h3>Response Headers</h3>
      ${keyValueRows(req.responseHeaders || {})}
      ${renderPayloadBlock('Response Preview', req.responsePreview, 'No response preview captured')}
    `;
    openModal('Request Details', body, currentModalState());
  }

  function showConsole(title, messages) {
    openModal(title, `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Message</th></tr></thead>
          <tbody>
            ${asArray(messages).map((msg) => `
              <tr>
                <td>${escapeHtml(formatDateTime(msg.ts))}</td>
                <td>${escapeHtml(msg.type || '-')}</td>
                <td><pre>${escapeHtml(msg.text || msg.message || '')}</pre></td>
              </tr>
            `).join('') || '<tr><td colspan="3">No console messages captured.</td></tr>'}
          </tbody>
        </table>
      </div>
    `);
  }

  function showCookies(title, cookies) {
    openModal(title, `
      <div class="modal-tools">
        <label class="check-label compact"><input type="checkbox" data-cookie-decode /> Show decoded cookie values</label>
        <span class="muted">${asArray(cookies).length} cookie(s)</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Domain</th><th>Path</th><th>Value</th><th>Flags</th></tr></thead>
          <tbody>
            ${asArray(cookies).map((cookie) => `
              <tr>
                <td>${escapeHtml(cookie.name || '')}</td>
                <td>${escapeHtml(cookie.domain || '')}</td>
                <td>${escapeHtml(cookie.path || '')}</td>
                <td><pre class="cookie-value" data-cookie-raw="${escapeHtml(cookie.value || '')}">${escapeHtml(cookie.value || '')}</pre></td>
                <td>${escapeHtml([cookie.httpOnly ? 'HttpOnly' : '', cookie.secure ? 'Secure' : '', cookie.sameSite || ''].filter(Boolean).join(', '))}</td>
              </tr>
            `).join('') || '<tr><td colspan="5">No cookies captured.</td></tr>'}
          </tbody>
        </table>
      </div>
    `);
  }

  function showJson(title, value) {
    openModal(title, window.FreeAuditJson.dataLayer(value));
  }

  function showRules(title, rules) {
    const firstFailure = asArray(rules).findIndex(rule => rule.status === 'failed');
    openModal(title, `
      <div class="rule-result-stack">
        ${asArray(rules).map((rule, index) => `
          <details class="rule-result-card" ${index === (firstFailure < 0 ? 0 : firstFailure) ? 'open' : ''}>
            <summary>
              <strong>${escapeHtml(rule.name || rule.ruleName || `Rule ${index + 1}`)}</strong>
              <span class="status-pill ${statusClass(rule.status)}">${escapeHtml(rule.status || '-')}</span>
            </summary>
            <div class="muted">${escapeHtml(rule.summary || '')}</div>
            ${window.FreeAuditJson.render(rule, { label: 'Rule Result' })}
          </details>
        `).join('') || '<div class="muted">No rule results captured.</div>'}
      </div>
    `);
  }

  function showTags(title, tags) {
    openModal(title, `
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Vendor</th><th>Tag</th><th>Method</th><th>Type</th><th>Match</th><th>Request URL</th></tr></thead>
          <tbody>
            ${asArray(tags).map((tag, index) => `
              <tr>
                <td>${index + 1}</td>
                <td><span class="pill">${escapeHtml(tag.vendor || '-')}</span></td>
                <td>${escapeHtml(tag.tagName || tag.vendor || '-')}</td>
                <td>${escapeHtml(tag.method || '-')}</td>
                <td>${escapeHtml(tag.resourceType || '-')}</td>
                <td>${escapeHtml(tag.matchType || '-')}</td>
                <td class="request-url-cell">${escapeHtml(tag.url || '-')}</td>
              </tr>
            `).join('') || '<tr><td colspan="7">No tags detected for this scope.</td></tr>'}
          </tbody>
        </table>
      </div>
    `);
  }

  function showScreenshot(step) {
    openModal(`Step ${step.stepNumber} Screenshot`, `
      <div class="screenshot-frame">
        <img alt="Step screenshot" src="data:image/png;base64,${escapeHtml(step.screenshotBase64)}" />
      </div>
    `);
  }

  function stepByNumber(stepNumber) {
    return asArray(results.steps).find((step) => String(step.stepNumber) === String(stepNumber));
  }

  async function loadReport() {
    if (!runId) {
      setStatus('Missing interaction run id.', 'error');
      return;
    }
    document.getElementById('downloadInteractionCsv').href = `/api/interaction-runs/${encodeURIComponent(runId)}/csv`;
    document.getElementById('downloadInteractionJson').href = `/api/interaction-runs/${encodeURIComponent(runId)}/json`;
    try {
      const data = await apiJson(`/api/interaction-runs/${encodeURIComponent(runId)}/results`);
      if (data.status && !data.summary) {
        setStatus(`Interaction is still ${data.status}. Refresh shortly.`);
        return;
      }
      results = data;
      hideStatus();
      renderSummary();
      renderSteps();
    } catch (err) {
      if (err.status === 202) setStatus('Interaction is still processing. Refresh shortly.');
      else setStatus(err.message || 'Failed to load interaction report', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('interactionModalClose').addEventListener('click', closeModal);
    document.getElementById('interactionModalBack').addEventListener('click', goBackModal);
    document.getElementById('interactionModal').addEventListener('click', (event) => {
      if (event.target.id === 'interactionModal') closeModal();
    });
    document.getElementById('interactionStepResults').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-step-result]');
      if (toggle) {
        const card = toggle.closest('.step-result-card');
        const shouldOpen = card.classList.contains('is-collapsed');
        card.classList.toggle('is-collapsed', !shouldOpen);
        card.classList.toggle('is-open', shouldOpen);
        toggle.textContent = shouldOpen ? 'Collapse' : 'Open';
        toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        return;
      }
      const button = event.target.closest('[data-view]');
      if (!button || !results) return;
      const step = stepByNumber(button.dataset.step);
      if (!step) return;
      const title = `Step ${step.stepNumber}: ${step.stepName || step.action}`;
      if (button.dataset.view === 'requests') showRequests(`${title} - Network Requests`, step.networkRequests || []);
      if (button.dataset.view === 'tags') showTags(`${title} - Tags Detected`, step.analytics || []);
      if (button.dataset.view === 'console') showConsole(`${title} - Console`, step.console || []);
      if (button.dataset.view === 'cookies') showCookies(`${title} - Cookies`, step.cookies?.after || []);
      if (button.dataset.view === 'datalayer') showJson(`${title} - dataLayer Changes`, step.dataLayer || {});
      if (button.dataset.view === 'rules') showRules(`${title} - Rule Results`, step.ruleResults || []);
      if (button.dataset.view === 'screenshot') showScreenshot(step);
    });
    document.getElementById('interactionReportSummary').addEventListener('click', (event) => {
      const button = event.target.closest('[data-view-overall]');
      if (!button || !results) return;
      if (button.dataset.viewOverall === 'requests') showRequests('All Journey Network Requests', results.networkRequests || []);
      if (button.dataset.viewOverall === 'tags') showTags('All Journey Detected Tags', results.analytics || []);
      if (button.dataset.viewOverall === 'console') showConsole('All Journey Console Messages', results.console || []);
      if (button.dataset.viewOverall === 'cookies') showCookies('Final Journey Cookies', results.cookies || []);
      if (button.dataset.viewOverall === 'datalayer') showJson('Final Journey dataLayer', results.dataLayer || []);
    });
    document.getElementById('interactionModalBody').addEventListener('input', (event) => {
      const filter = event.target.closest('[data-request-filter]');
      if (filter) {
        const query = filter.value.trim().toLowerCase();
        document.querySelectorAll('[data-request-row]').forEach((row) => {
          row.classList.toggle('hidden', query && !(row.dataset.search || '').includes(query));
        });
        return;
      }
      const decodeToggle = event.target.closest('[data-cookie-decode]');
      if (decodeToggle) {
        const shouldDecode = decodeToggle.checked;
        document.querySelectorAll('[data-cookie-raw]').forEach((node) => {
          const raw = node.dataset.cookieRaw || '';
          node.textContent = shouldDecode ? decodeCookieValue(raw) : raw;
        });
      }
    });
    document.getElementById('interactionModalBody').addEventListener('click', (event) => {
      const detail = event.target.closest('[data-request-detail]');
      if (!detail) return;
      let requests = [];
      try { requests = JSON.parse(document.getElementById('interactionModalBody').dataset.requestSource || '[]'); } catch (_) {}
      const req = requests[Number(detail.dataset.requestDetail)];
      if (req) showRequestDetail(req);
    });
    loadReport();
  });
})();
