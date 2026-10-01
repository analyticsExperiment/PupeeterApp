(function() {
  const state = {
    audits: [],
    selectedId: null,
    detailRequest: 0
  };

  const rowsEl = document.getElementById('auditRows');
  const detailEl = document.getElementById('auditDetail');
  const filters = document.getElementById('historyFilters');
  const countEl = document.getElementById('historyCount');

  function redirectIfUnauthorized(resp) {
    if (resp && resp.status === 401) {
      window.location.href = '/login';
      return true;
    }
    return false;
  }

  function renderDetailPlaceholder(message) {
    const copy = escapeHtml(message || 'Select an audit from the list to see its key metrics and shortcuts.');
    detailEl.innerHTML = `<h2 class="section-title">Audit Details</h2><div class="muted">${copy}</div>`;
  }

  renderDetailPlaceholder();

  function formatDateTime(ts) {

    if (!ts) return '-';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  }

  function formatDuration(start, end) {
    if (!start || !end) return '-';
    const diff = Number(end) - Number(start);
    if (!Number.isFinite(diff) || diff < 0) return '-';
    const seconds = Math.floor(diff / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hours}h ${remMins}m ${secs}s`;
    }
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  }

  function renderAudits(list) {
    if (!Array.isArray(list) || !list.length) {
      const message = state.audits.length ? 'No audits match these filters.' : 'No audits recorded yet.';
      rowsEl.innerHTML = `<tr><td colspan="9" class="muted">${message}</td></tr>`;
      renderDetailPlaceholder(message);
      return;
    }
    const html = list.map((item) => {
      const summary = item.summary || {};
      const status = escapeHtml(item.status || 'unknown');
      const statusBadge = `<span class="pill status-pill status-${status.toLowerCase()}">${status}</span>`;
      const pages = summary.total != null ? summary.total : '-';
      const networkRequests = summary.networkRequests != null ? summary.networkRequests : '-';
      const failedRules = summary.ruleFailures != null ? summary.ruleFailures : '-';
      const started = formatDateTime(item.startedAt);
      const duration = formatDuration(item.startedAt, item.completedAt);
      const domain = escapeHtml(item.domain || '');
      return `<tr data-id="${escapeHtml(item.id)}">
        <td>${started}</td>
        <td>${duration}</td>
        <td>${statusBadge}</td>
        <td class="break">${domain}</td>
        <td>${escapeHtml(item.configName || '-')}</td>
        <td>${pages}</td>
        <td>${networkRequests}</td>
        <td>${failedRules}</td>
        <td class="row-actions">
          <button class="pill audit-details" data-id="${escapeHtml(item.id)}" type="button">Details</button>
          <a class="pill" href="/?auditId=${encodeURIComponent(item.id)}">View</a>
          <button class="pill rerun-audit" data-id="${escapeHtml(item.id)}" type="button">Re-run</button>
          <button class="pill duplicate-config" data-id="${escapeHtml(item.id)}" type="button">Duplicate Config</button>
        </td>
      </tr>`;
    }).join('');
    rowsEl.innerHTML = html;
    highlightSelected();
  }

  function highlightSelected() {
    Array.from(rowsEl.querySelectorAll('tr[data-id]')).forEach((row) => {
      row.classList.toggle('selected', row.getAttribute('data-id') === state.selectedId);
    });
  }

  function renderDetailLoading() {
    renderDetailPlaceholder('Loading audit details...');
  }

  function renderDetailError(message) {
    renderDetailPlaceholder(message || 'Unable to load audit detail');
  }

  function renderDetail(audit) {
    if (!audit) {
      renderDetailError('Audit not found');
      return;
    }
    const summary = audit.summary || {};
    const metrics = [
      { label: 'Pages / Target', value: summary.pageTarget ? `${summary.total || 0} / ${summary.pageTarget}` : summary.total },
      { label: 'Pages w/ Requests', value: summary.pagesWithDetectedRequests != null ? summary.pagesWithDetectedRequests : summary.pagesWithAnalytics },
      { label: 'Detected Requests', value: summary.detectedRequests != null ? summary.detectedRequests : summary.analyticsHits },
      { label: 'Network Requests', value: summary.networkRequests },
      { label: 'Errors', value: summary.errors },
      { label: 'Console Messages', value: summary.consoleMessages },
      { label: 'Failed Rules', value: summary.ruleFailures }
    ];
    const facts = metrics.map((m) => {
      const val = m.value != null ? escapeHtml(String(m.value)) : '-';
      return `<div><dt>${escapeHtml(m.label)}</dt><dd>${val}</dd></div>`;
    }).join('');

    const started = formatDateTime(audit.startedAt);
    const completed = formatDateTime(audit.completedAt);
    const duration = formatDuration(audit.startedAt, audit.completedAt);
    const status = escapeHtml(audit.status || 'unknown');
    const domain = escapeHtml(audit.domain || audit.payload?.domain || '');
    const configName = escapeHtml(audit.configName || audit.configSnapshot?.name || 'Unsaved audit');

    const configuration = `<details class="report-metadata"><summary>Audit Configuration</summary>${window.FreeAuditJson.render(audit.payload || {}, { label: 'Audit configuration' })}</details>`;
    const snapshot = audit.configSnapshot ? `<details class="report-metadata"><summary>Saved Config Snapshot</summary>${window.FreeAuditJson.render(audit.configSnapshot, { label: 'Config snapshot' })}</details>` : '';

    const actions = `
      <div class="actions" style="margin-top:16px; gap:8px;">
        <a class="pill" href="/?auditId=${encodeURIComponent(audit.id)}">Open Full Report</a>
        <a class="pill" href="/api/audit/${encodeURIComponent(audit.id)}/csv">Download CSV</a>
        <a class="pill" href="/api/audit/${encodeURIComponent(audit.id)}/json">Download JSON</a>
        <button class="pill rerun-audit" data-id="${escapeHtml(audit.id)}" type="button">Re-run Audit</button>
        <button class="pill duplicate-config" data-id="${escapeHtml(audit.id)}" type="button">Duplicate Config</button>
        ${audit.results || audit.requestHeaders ? '<button class="pill" id="historyViewHeaders" type="button">View Request Headers</button>' : ''}
      </div>
    `;

    detailEl.innerHTML = `
      <header class="history-detail-heading"><div><h2 class="section-title">${configName}</h2><p>${domain}</p></div><span class="status-pill">${status}</span></header>
      <div class="report-run-meta">Run ${escapeHtml(audit.id)}</div>
      ${actions}
      <dl class="history-facts"><div><dt>Started</dt><dd>${started}</dd></div><div><dt>Completed</dt><dd>${completed}</dd></div><div><dt>Duration</dt><dd>${duration}</dd></div>${facts}</dl>
      ${configuration}
      ${snapshot}
    `;

    if (audit.results) {
      window.__LATEST_RESULTS = audit.results;
      if (!window.__LATEST_RESULTS.requestHeaders && audit.requestHeaders) {
        window.__LATEST_RESULTS.requestHeaders = audit.requestHeaders;
      }
    } else {
      window.__LATEST_RESULTS = { requestHeaders: audit.requestHeaders || null };
    }
    window.__LATEST_JOBID = audit.id;

    const viewBtn = document.getElementById('historyViewHeaders');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        if (typeof openRequestHeadersModal === 'function') {
          try {
            openRequestHeadersModal();
          } catch (err) {
            console.error('Failed to open headers modal', err);
          }
        }
      });
    }
  }

  async function selectAudit(id) {
    if (!id) return;
    const request = ++state.detailRequest;
    state.selectedId = id;
    highlightSelected();
    renderDetailLoading();
    try {
      const resp = await fetch(`/api/audits/${encodeURIComponent(id)}`);
      if (request !== state.detailRequest) return;
      if (redirectIfUnauthorized(resp)) return;
      if (!resp.ok) {
        if (resp.status === 404) {
          renderDetailError('Audit not found or no longer available.');
        } else {
          renderDetailError('Failed to load audit detail.');
        }
        return;
      }
      const data = await resp.json();
      if (request !== state.detailRequest) return;
      renderDetail(data);
    } catch (err) {
      if (request !== state.detailRequest) return;
      console.error('Failed to fetch audit detail', err);
      renderDetailError('Failed to load audit detail.');
    }
  }

  async function loadAudits() {
    try {
      const resp = await fetch('/api/audits?limit=200');
      if (redirectIfUnauthorized(resp)) return;
      if (!resp.ok) throw new Error('Failed to load audits');
      const data = await resp.json();
      state.audits = data.audits || [];
      applyFilters();
    } catch (err) {
      console.error(err);
      countEl.textContent = 'Recent audits unavailable.';
      rowsEl.innerHTML = '<tr><td colspan="9" class="muted">Failed to load audits.</td></tr>';
      renderDetailPlaceholder('Failed to load audits.');
    }
  }

  rowsEl.addEventListener('click', (event) => {
    const details = event.target.closest('.audit-details');
    if (details) { selectAudit(details.dataset.id); return; }
    const link = event.target.closest('a');
    if (link && link.closest('td')) {
      return; // allow navigation
    }
    if (event.target.closest('button')) {
      return;
    }
    const row = event.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.getAttribute('data-id');
    selectAudit(id);
  });

  async function postJson(url) {
    if (window.FreeAuditApi) return window.FreeAuditApi.apiJson(url, { method: 'POST', body: {} });
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (redirectIfUnauthorized(resp)) return null;
    return resp.json();
  }

  document.body.addEventListener('click', (event) => {
    if (event.target && (event.target.id === 'modalClose' || event.target.id === 'modal')) {
      hideModal();
    }
    const rerun = event.target.closest('.rerun-audit');
    if (rerun) {
      const id = rerun.getAttribute('data-id');
      rerun.disabled = true;
      postJson(`/api/audits/${encodeURIComponent(id)}/rerun`)
        .then((data) => {
          if (data?.id) window.location.href = `/?auditId=${encodeURIComponent(data.id)}`;
        })
        .catch((err) => {
          alert(err.message || 'Failed to re-run audit');
          rerun.disabled = false;
        });
    }
    const duplicate = event.target.closest('.duplicate-config');
    if (duplicate) {
      const id = duplicate.getAttribute('data-id');
      duplicate.disabled = true;
      postJson(`/api/audits/${encodeURIComponent(id)}/duplicate-config`)
        .then((data) => {
          if (data?.config?.id) window.location.href = `/audit-configs.html?id=${encodeURIComponent(data.config.id)}`;
        })
        .catch((err) => {
          alert(err.message || 'Failed to duplicate config');
          duplicate.disabled = false;
        });
    }
  });

  function applyFilters() {
    const query = document.getElementById('historySearch').value.trim().toLowerCase();
    const status = document.getElementById('historyStatus').value;
    const from = document.getElementById('historyFrom').value;
    const to = document.getElementById('historyTo').value;
    const failed = document.getElementById('historyFailed').checked;
    const invalidRange = from && to && from > to;
    const list = invalidRange ? [] : state.audits.filter(item => {
      const date = new Date(item.startedAt);
      const day = Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return (!query || [item.id, item.domain, item.configName].some(value => String(value || '').toLowerCase().includes(query)))
        && (!status || item.status === status) && (!from || day >= from) && (!to || (day && day <= to))
        && (!failed || Number(item.summary?.ruleFailures) > 0);
    });
    countEl.textContent = invalidRange ? 'From date must be on or before To date.' : `${list.length} of ${state.audits.length} recent audits (latest 200)`;
    countEl.classList.toggle('login-error', Boolean(invalidRange));
    renderAudits(list);
    if (!list.some(item => item.id === state.selectedId)) {
      state.selectedId = null;
      state.detailRequest++;
      if (list.length) selectAudit(list[0].id);
    }
  }

  filters.addEventListener('submit', event => event.preventDefault());
  filters.addEventListener('input', applyFilters);
  filters.addEventListener('reset', () => setTimeout(applyFilters, 0));
  loadAudits();
})();

