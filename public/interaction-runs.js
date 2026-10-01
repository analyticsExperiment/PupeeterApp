(function () {
  const { apiJson, escapeHtml, formatDateTime, formatDuration } = window.FreeAuditApi;
  let runs = [];

  function statusClass(status) {
    const value = String(status || '').toLowerCase();
    if (value === 'completed' || value === 'passed') return 'status-passed';
    if (value === 'failed') return 'status-failed';
    return 'status-running';
  }

  function renderRuns() {
    const query = document.getElementById('runSearch').value.trim().toLowerCase();
    const filtered = runs.filter((run) => {
      const haystack = [
        run.id,
        run.configName,
        run.status,
        run.configSnapshot?.name,
        run.configSnapshot?.startingUrl
      ].join(' ').toLowerCase();
      return !query || haystack.includes(query);
    });
    const host = document.getElementById('interactionRunsList');
    if (!filtered.length) {
      host.innerHTML = `
        <div class="config-empty-state">
          <h2>No interaction runs yet</h2>
          <p class="muted">Create an interaction config, add journey steps, then run it to see reports here.</p>
          <a class="button-style" href="/interaction-configs.html">Create Interaction Config</a>
        </div>
      `;
      return;
    }
    host.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Run Date</th>
            <th>Interaction Config</th>
            <th>Starting URL</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map((run) => {
            const snapshot = run.configSnapshot || {};
            return `
              <tr>
                <td>${escapeHtml(formatDateTime(run.createdAt || run.startedAt))}</td>
                <td>
                  <strong>${escapeHtml(run.configName || snapshot.name || 'Untitled Interaction')}</strong>
                  <div class="muted">${escapeHtml(run.id)}</div>
                </td>
                <td class="url-cell">${escapeHtml(snapshot.startingUrl || '-')}</td>
                <td><span class="status-pill ${statusClass(run.status)}">${escapeHtml(run.status || '-')}</span></td>
                <td>${escapeHtml(formatDuration(run.startedAt, run.completedAt))}</td>
                <td>
                  <div class="toolbar">
                    <a class="pill" href="/interaction-report.html?id=${encodeURIComponent(run.id)}">View Report</a>
                    <a class="pill" href="/api/interaction-runs/${encodeURIComponent(run.id)}/json">JSON</a>
                    <a class="pill" href="/api/interaction-runs/${encodeURIComponent(run.id)}/csv">CSV</a>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  async function loadRuns() {
    const data = await apiJson('/api/interaction-runs?limit=200');
    runs = data.runs || [];
    renderRuns();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('runSearch').addEventListener('input', renderRuns);
    loadRuns().catch((err) => {
      document.getElementById('interactionRunsList').innerHTML = `<div class="login-error">${escapeHtml(err.message || 'Failed to load interaction runs')}</div>`;
    });
  });
})();
