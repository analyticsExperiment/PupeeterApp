(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;

  function statusPill(status) {
    const safe = escapeHtml(status || 'unknown');
    return `<span class="pill status-pill status-${safe.toLowerCase()}">${safe}</span>`;
  }

  function renderMetrics(audits, configs) {
    const completed = audits.filter((audit) => audit.status === 'completed').length;
    const failedRules = audits.reduce((sum, audit) => sum + Number(audit.summary?.ruleFailures || 0), 0);
    document.getElementById('dashboardMetrics').innerHTML = `
      <div class="card"><div class="muted">Audits</div><div style="font-size:22px">${audits.length}</div></div>
      <div class="card"><div class="muted">Completed</div><div style="font-size:22px">${completed}</div></div>
      <div class="card"><div class="muted">Failed Rules</div><div style="font-size:22px;color:var(--bad)">${failedRules}</div></div>
      <div class="card"><div class="muted">Saved Configs</div><div style="font-size:22px">${configs.length}</div></div>
    `;
  }

  function renderAudits(audits) {
    const rows = audits.slice(0, 8).map((audit) => `
      <tr>
        <td>${formatDateTime(audit.startedAt)}</td>
        <td class="break">${escapeHtml(audit.domain || '')}</td>
        <td>${statusPill(audit.status)}</td>
        <td>${escapeHtml(audit.configName || '-')}</td>
        <td><a class="pill" href="/?auditId=${encodeURIComponent(audit.id)}">Open</a></td>
      </tr>
    `).join('');
    document.getElementById('recentAudits').innerHTML = rows || '<tr><td colspan="5" class="muted">No audits yet.</td></tr>';
  }

  function renderConfigs(configs) {
    const html = configs.slice(0, 8).map((config) => `
      <div class="config-card" data-id="${escapeHtml(config.id)}">
        <div>
          <strong>${escapeHtml(config.name)}</strong>
          <div class="muted">${escapeHtml(config.domain || 'No domain set')}</div>
        </div>
        <div class="config-card-actions">
          ${config.isDefault ? '<span class="pill">Default</span>' : ''}
          <button class="pill run-config" data-id="${escapeHtml(config.id)}" type="button">Run</button>
          <a class="pill" href="/audit-configs.html?id=${encodeURIComponent(config.id)}">Edit</a>
        </div>
      </div>
    `).join('');
    document.getElementById('configShortcuts').innerHTML = html || '<div class="muted">No configs saved yet.</div>';
  }

  async function runConfig(id) {
    const data = await apiJson(`/api/audit-configs/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} });
    window.location.href = `/?auditId=${encodeURIComponent(data.id)}`;
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [auditData, configData] = await Promise.all([
        apiJson('/api/audits?limit=50'),
        apiJson('/api/audit-configs')
      ]);
      const audits = auditData.audits || [];
      const configs = configData.configs || [];
      renderMetrics(audits, configs);
      renderAudits(audits);
      renderConfigs(configs);
    } catch (err) {
      console.error(err);
    }
  });

  document.body.addEventListener('click', async (event) => {
    const run = event.target.closest('.run-config');
    if (!run) return;
    run.disabled = true;
    try {
      await runConfig(run.dataset.id);
    } catch (err) {
      alert(err.message || 'Failed to run config');
      run.disabled = false;
    }
  });
})();
