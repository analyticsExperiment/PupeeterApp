(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const builder = window.FreeAuditActionBuilder;
  const state = {
    templates: [],
    selectedId: null
  };

  function selectedTemplate() {
    return state.templates.find((template) => template.id === state.selectedId) || null;
  }

  function setEditor(template) {
    state.selectedId = template ? template.id : null;
    document.getElementById('templateName').value = template?.name || '';
    document.getElementById('templateDescription').value = template?.description || '';
    builder.setSteps(document.getElementById('steps'), template?.steps || [{ action: 'click' }]);
    renderList();
  }

  function renderList() {
    const query = document.getElementById('templateSearch').value.trim().toLowerCase();
    const filtered = state.templates.filter((template) => !query || `${template.name} ${template.description}`.toLowerCase().includes(query));
    document.getElementById('templateList').innerHTML = filtered.map((template) => `
      <button class="config-card selectable ${template.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(template.id)}" type="button">
        <div>
          <strong>${escapeHtml(template.name)}</strong>
          <div class="muted">${template.steps?.length || 0} steps | Updated ${formatDateTime(template.updatedAt)}</div>
        </div>
      </button>
    `).join('') || '<div class="muted">No flow templates saved yet.</div>';
  }

  function collectEditor() {
    return {
      name: document.getElementById('templateName').value.trim(),
      description: document.getElementById('templateDescription').value.trim(),
      steps: builder.collectSteps(document.getElementById('steps'))
    };
  }

  async function loadTemplates() {
    const data = await apiJson('/api/interaction-flow-templates');
    state.templates = data.templates || [];
    renderList();
    setEditor(state.templates[0] || null);
  }

  async function saveTemplate() {
    const payload = collectEditor();
    if (!payload.name) return alert('Flow name is required');
    if (state.selectedId) {
      const data = await apiJson(`/api/interaction-flow-templates/${encodeURIComponent(state.selectedId)}`, { method: 'PUT', body: payload });
      state.templates = state.templates.map((template) => template.id === data.template.id ? data.template : template);
      setEditor(data.template);
      return;
    }
    const data = await apiJson('/api/interaction-flow-templates', { method: 'POST', body: payload });
    state.templates.unshift(data.template);
    setEditor(data.template);
  }

  async function deleteTemplate() {
    if (!state.selectedId) return;
    if (!confirm('Delete this flow template?')) return;
    await apiJson(`/api/interaction-flow-templates/${encodeURIComponent(state.selectedId)}`, { method: 'DELETE' });
    state.templates = state.templates.filter((template) => template.id !== state.selectedId);
    setEditor(state.templates[0] || null);
  }

  async function duplicateTemplate() {
    if (!state.selectedId) return;
    const data = await apiJson(`/api/interaction-flow-templates/${encodeURIComponent(state.selectedId)}/duplicate`, { method: 'POST', body: {} });
    state.templates.unshift(data.template);
    setEditor(data.template);
  }

  function applyToCreateAudit() {
    const template = selectedTemplate();
    if (!template) return;
    sessionStorage.setItem('freeAudit.pendingFlowTemplate', JSON.stringify({
      templateId: template.id,
      name: template.name,
      steps: template.steps || []
    }));
    window.location.href = '/?scratch=1';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addStep').addEventListener('click', () => builder.addStep(document.getElementById('steps'), { action: 'click' }));
    document.getElementById('newTemplate').addEventListener('click', () => setEditor(null));
    document.getElementById('saveTemplate').addEventListener('click', () => saveTemplate().catch((err) => alert(err.message)));
    document.getElementById('deleteTemplate').addEventListener('click', () => deleteTemplate().catch((err) => alert(err.message)));
    document.getElementById('duplicateTemplate').addEventListener('click', () => duplicateTemplate().catch((err) => alert(err.message)));
    document.getElementById('applyTemplate').addEventListener('click', applyToCreateAudit);
    document.getElementById('templateSearch').addEventListener('input', renderList);
    document.getElementById('templateList').addEventListener('click', (event) => {
      const card = event.target.closest('[data-id]');
      if (!card) return;
      setEditor(state.templates.find((template) => template.id === card.dataset.id));
    });
    loadTemplates().catch((err) => alert(err.message));
  });
})();
