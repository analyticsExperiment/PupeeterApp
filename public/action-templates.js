(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const builder = window.FreeAuditActionBuilder;
  const state = {
    type: new URLSearchParams(window.location.search).get('type') === 'post' ? 'post' : 'pre',
    templates: [],
    selectedId: null,
    mode: 'list'
  };

  const labels = {
    pre: {
      title: 'Pre-Audit Action Templates',
      sub: 'Reusable steps that run once on the first loaded page before crawling continues.'
    },
    post: {
      title: 'On Page Action Templates',
      sub: 'Reusable steps that run on every scanned page after navigation.'
    }
  };

  function selectedTemplate() {
    return state.templates.find((template) => template.id === state.selectedId) || null;
  }

  function detailUrl(id) {
    const params = new URLSearchParams({ type: state.type });
    if (id) params.set('id', id);
    else params.set('new', '1');
    return `/action-templates.html?${params.toString()}`;
  }

  function setMode(mode) {
    state.mode = mode === 'detail' ? 'detail' : 'list';
    const page = document.querySelector('.console-page');
    page?.classList.toggle('library-list-mode', state.mode === 'list');
    page?.classList.toggle('library-detail-mode', state.mode === 'detail');
    document.getElementById('backToTemplates')?.classList.toggle('hidden', state.mode !== 'detail');
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
    const html = filtered.map((template) => `
      <button class="config-card selectable ${template.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(template.id)}" type="button">
        <div>
          <strong>${escapeHtml(template.name)}</strong>
          <div class="muted">${template.steps?.length || 0} steps | Updated ${formatDateTime(template.updatedAt)}</div>
          ${state.mode === 'list' ? `<p>${escapeHtml(template.description || 'Open this template to review and edit its ordered action steps.')}</p>` : ''}
        </div>
        ${state.mode === 'list' ? `<div class="config-card-footer"><span>${template.steps?.length || 0} steps</span><span>${escapeHtml(state.type === 'post' ? 'On Page' : 'Pre-audit')}</span></div>` : ''}
      </button>
    `).join('');
    document.getElementById('templateList').innerHTML = html || `
      <div class="config-empty-state">
        <h2>No templates saved yet</h2>
        <p class="muted">Create reusable ordered steps, then attach them to audit configs.</p>
        <button class="button-style" type="button" data-create-empty-template>Create Template</button>
      </div>
    `;
  }

  function collectEditor() {
    return {
      name: document.getElementById('templateName').value.trim(),
      description: document.getElementById('templateDescription').value.trim(),
      type: state.type,
      steps: builder.collectSteps(document.getElementById('steps'))
    };
  }

  async function loadTemplates() {
    const data = await apiJson(`/api/action-templates?type=${encodeURIComponent(state.type)}`);
    state.templates = data.templates || [];
    renderList();
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');
    const shouldShowDetail = params.get('new') === '1' || Boolean(requestedId);
    setMode(shouldShowDetail ? 'detail' : 'list');
    if (!shouldShowDetail) {
      setEditor(null);
      setMode('list');
      return;
    }
    const selected = requestedId ? state.templates.find((template) => template.id === requestedId) || null : null;
    setEditor(selected);
    setMode('detail');
  }

  async function saveTemplate() {
    const payload = collectEditor();
    if (!payload.name) return alert('Template name is required');
    if (state.selectedId) {
      const data = await apiJson(`/api/action-templates/${encodeURIComponent(state.selectedId)}`, { method: 'PUT', body: payload });
      state.templates = state.templates.map((template) => template.id === data.template.id ? data.template : template);
      setEditor(data.template);
      return;
    }
    const data = await apiJson('/api/action-templates', { method: 'POST', body: payload });
    state.templates.unshift(data.template);
    setEditor(data.template);
    window.history.pushState({}, '', detailUrl(data.template.id));
  }

  async function deleteTemplate() {
    if (!state.selectedId) return;
    if (!confirm('Delete this template?')) return;
    await apiJson(`/api/action-templates/${encodeURIComponent(state.selectedId)}`, { method: 'DELETE' });
    state.templates = state.templates.filter((template) => template.id !== state.selectedId);
    setEditor(null);
    setMode('list');
    window.history.pushState({}, '', `/action-templates.html?type=${encodeURIComponent(state.type)}`);
  }

  async function duplicateTemplate() {
    if (!state.selectedId) return;
    const data = await apiJson(`/api/action-templates/${encodeURIComponent(state.selectedId)}/duplicate`, { method: 'POST', body: {} });
    state.templates.unshift(data.template);
    setEditor(data.template);
    window.history.pushState({}, '', detailUrl(data.template.id));
  }

  function applyToCreateAudit() {
    const template = selectedTemplate();
    if (!template) return;
    sessionStorage.setItem('freeAudit.pendingActionTemplate', JSON.stringify({
      type: state.type,
      templateId: template.id,
      name: template.name,
      steps: template.steps || []
    }));
    window.location.href = '/?scratch=1';
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('pageTitle').textContent = labels[state.type].title;
    document.getElementById('pageSub').textContent = labels[state.type].sub;
    document.getElementById('addStep').addEventListener('click', () => builder.addStep(document.getElementById('steps'), { action: 'click' }));
    document.getElementById('newTemplate').addEventListener('click', () => {
      setEditor(null);
      setMode('detail');
      window.history.pushState({}, '', detailUrl(null));
    });
    document.getElementById('backToTemplates').addEventListener('click', () => {
      setEditor(null);
      setMode('list');
      window.history.pushState({}, '', `/action-templates.html?type=${encodeURIComponent(state.type)}`);
    });
    document.getElementById('saveTemplate').addEventListener('click', () => saveTemplate().catch((err) => alert(err.message)));
    document.getElementById('deleteTemplate').addEventListener('click', () => deleteTemplate().catch((err) => alert(err.message)));
    document.getElementById('duplicateTemplate').addEventListener('click', () => duplicateTemplate().catch((err) => alert(err.message)));
    document.getElementById('applyTemplate').addEventListener('click', applyToCreateAudit);
    document.getElementById('templateSearch').addEventListener('input', renderList);
    document.getElementById('templateList').addEventListener('click', (event) => {
      if (event.target.closest('[data-create-empty-template]')) {
        setEditor(null);
        setMode('detail');
        window.history.pushState({}, '', detailUrl(null));
        return;
      }
      const card = event.target.closest('[data-id]');
      if (!card) return;
      window.location.href = detailUrl(card.dataset.id);
    });
    loadTemplates().catch((err) => alert(err.message));
  });
})();
