(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;

  let extensionTokens = [];

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function renderExtensionTokens() {
    const rows = document.getElementById('extensionTokenRows');
    if (!rows) return;
    if (!extensionTokens.length) {
      rows.innerHTML = '<tr><td colspan="5" class="muted">No extension pairing tokens yet.</td></tr>';
      return;
    }
    rows.innerHTML = extensionTokens.map((token) => `
      <tr>
        <td>${escapeHtml(token.label || 'Chrome Recorder')}</td>
        <td>${formatDateTime(token.createdAt)}</td>
        <td>${token.lastUsedAt ? formatDateTime(token.lastUsedAt) : '-'}</td>
        <td><span class="pill ${token.active ? '' : 'muted'}">${token.active ? 'Active' : 'Revoked'}</span></td>
        <td>${token.active ? `<button class="danger-button revoke-extension-token" data-id="${escapeHtml(token.id)}" type="button">Revoke</button>` : '-'}</td>
      </tr>
    `).join('');
  }

  async function loadExtensionTokens() {
    const data = await apiJson('/api/extension/tokens');
    extensionTokens = data.tokens || [];
    renderExtensionTokens();
  }

  function showNewExtensionToken(token) {
    const box = document.getElementById('newExtensionToken');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = `
      <div>
        <strong>Pairing token created.</strong>
        <p class="muted">Copy it now. For safety, Free Audit will not show the full token again.</p>
      </div>
      <div class="extension-token-copy">
        <code>${escapeHtml(token)}</code>
        <button class="pill" id="copyExtensionToken" type="button">Copy</button>
      </div>
    `;
    document.getElementById('copyExtensionToken')?.addEventListener('click', async () => {
      const copied = await copyText(token);
      if (!copied) window.prompt('Copy extension pairing token', token);
    });
  }

  async function createExtensionToken() {
    const label = window.prompt('Token label', 'Free Audit Recorder');
    if (label === null) return;
    const button = document.getElementById('createExtensionToken');
    button.disabled = true;
    try {
      const data = await apiJson('/api/extension/tokens', { method: 'POST', body: { label: label.trim() || 'Free Audit Recorder' } });
      showNewExtensionToken(data.token);
      await loadExtensionTokens();
    } finally { button.disabled = false; }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [me, configs] = await Promise.all([
        apiJson('/api/auth/me'),
        apiJson('/api/audit-configs')
      ]);
      const user = me.user || {};
      document.getElementById('accountRows').innerHTML = `
        <tr><td><strong>Username</strong></td><td>${escapeHtml(user.username || '')}</td></tr>
        <tr><td><strong>Display Name</strong></td><td>${escapeHtml(user.displayName || user.username || '')}</td></tr>
      `;
      const defaultConfig = (configs.configs || []).find((config) => config.isDefault);
      document.getElementById('defaultConfig').innerHTML = defaultConfig
        ? `<div class="config-card"><div><strong>${escapeHtml(defaultConfig.name)}</strong><div class="muted">Updated ${formatDateTime(defaultConfig.updatedAt)}</div></div><a class="pill" href="/audit-configs.html?id=${encodeURIComponent(defaultConfig.id)}">Edit</a></div>`
        : 'No default audit config selected.';
      await loadExtensionTokens();
      document.getElementById('createExtensionToken')?.addEventListener('click', () => {
        createExtensionToken().catch((err) => alert(err.message || 'Failed to create extension token'));
      });
      document.getElementById('extensionTokenRows')?.addEventListener('click', async (event) => {
        const button = event.target.closest('.revoke-extension-token');
        if (!button) return;
        if (!window.confirm('Revoke this extension token?')) return;
        button.disabled = true;
        try {
          await apiJson(`/api/extension/tokens/${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
          document.getElementById('newExtensionToken').replaceChildren();
          document.getElementById('newExtensionToken').classList.add('hidden');
          await loadExtensionTokens();
        } catch (err) {
          alert(err.message || 'Failed to revoke token');
        } finally { button.disabled = false; }
      });
    } catch (err) {
      console.error(err);
    }
  });
})();
