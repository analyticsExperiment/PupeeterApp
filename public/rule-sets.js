(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const state = {
    ruleSets: [],
    selectedId: null,
    mode: 'list'
  };

  function selectedRuleSet() {
    return state.ruleSets.find((ruleSet) => ruleSet.id === state.selectedId) || null;
  }

  function detailUrl(id) {
    const params = new URLSearchParams();
    if (id) params.set('id', id);
    else params.set('new', '1');
    return `/rule-sets.html?${params.toString()}`;
  }

  function setMode(mode) {
    state.mode = mode === 'detail' ? 'detail' : 'list';
    const page = document.querySelector('.console-page');
    page?.classList.toggle('library-list-mode', state.mode === 'list');
    page?.classList.toggle('library-detail-mode', state.mode === 'detail');
    document.getElementById('backToRuleSets')?.classList.toggle('hidden', state.mode !== 'detail');
  }

  function setRules(rules) {
    const root = document.getElementById('rulesList');
    root.innerHTML = '';
    const list = Array.isArray(rules) && rules.length ? rules : [{}];
    list.forEach((rule) => window.RuleBuilder.addRule(rule));
  }

  function setEditor(ruleSet) {
    state.selectedId = ruleSet ? ruleSet.id : null;
    document.getElementById('ruleSetName').value = ruleSet?.name || '';
    document.getElementById('ruleSetDescription').value = ruleSet?.description || '';
    setRules(ruleSet?.rules || []);
    renderList();
  }

  function renderList() {
    const query = document.getElementById('ruleSetSearch').value.trim().toLowerCase();
    const filtered = state.ruleSets.filter((ruleSet) => !query || `${ruleSet.name} ${ruleSet.description}`.toLowerCase().includes(query));
    document.getElementById('ruleSetList').innerHTML = filtered.map((ruleSet) => `
      <button class="config-card selectable ${ruleSet.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(ruleSet.id)}" type="button">
        <div>
          <strong>${escapeHtml(ruleSet.name)}</strong>
          <div class="muted">${ruleSet.rules?.length || 0} rules | Updated ${formatDateTime(ruleSet.updatedAt)}</div>
          ${state.mode === 'list' ? `<p>${escapeHtml(ruleSet.description || 'Open this rule set to inspect and edit its validation rule stack.')}</p>` : ''}
        </div>
        ${state.mode === 'list' ? `<div class="config-card-footer"><span>${ruleSet.rules?.length || 0} rules</span><span>Validation set</span></div>` : ''}
      </button>
    `).join('') || `
      <div class="config-empty-state">
        <h2>No rule sets saved yet</h2>
        <p class="muted">Create reusable validation rules, then attach them to audit configs.</p>
        <button class="button-style" type="button" data-create-empty-rule-set>Create Rule Set</button>
      </div>
    `;
  }

  function collectEditor() {
    return {
      name: document.getElementById('ruleSetName').value.trim(),
      description: document.getElementById('ruleSetDescription').value.trim(),
      rules: window.RuleBuilder.collectRules()
    };
  }

  async function loadCatalog() {
    const data = await apiJson('/api/tag-catalog');
    window.RuleBuilder.init({ ruleOptions: data.ruleOptions || [] });
  }

  async function loadRuleSets() {
    const data = await apiJson('/api/rule-sets');
    state.ruleSets = data.ruleSets || [];
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
    const selected = requestedId ? state.ruleSets.find((ruleSet) => ruleSet.id === requestedId) || null : null;
    setEditor(selected);
    setMode('detail');
  }

  async function saveRuleSet() {
    const payload = collectEditor();
    if (!payload.name) return alert('Rule set name is required');
    if (state.selectedId) {
      const data = await apiJson(`/api/rule-sets/${encodeURIComponent(state.selectedId)}`, { method: 'PUT', body: payload });
      state.ruleSets = state.ruleSets.map((ruleSet) => ruleSet.id === data.ruleSet.id ? data.ruleSet : ruleSet);
      setEditor(data.ruleSet);
      return;
    }
    const data = await apiJson('/api/rule-sets', { method: 'POST', body: payload });
    state.ruleSets.unshift(data.ruleSet);
    setEditor(data.ruleSet);
    window.history.pushState({}, '', detailUrl(data.ruleSet.id));
  }

  async function deleteRuleSet() {
    if (!state.selectedId) return;
    if (!confirm('Delete this rule set?')) return;
    await apiJson(`/api/rule-sets/${encodeURIComponent(state.selectedId)}`, { method: 'DELETE' });
    state.ruleSets = state.ruleSets.filter((ruleSet) => ruleSet.id !== state.selectedId);
    setEditor(null);
    setMode('list');
    window.history.pushState({}, '', '/rule-sets.html');
  }

  async function duplicateRuleSet() {
    if (!state.selectedId) return;
    const data = await apiJson(`/api/rule-sets/${encodeURIComponent(state.selectedId)}/duplicate`, { method: 'POST', body: {} });
    state.ruleSets.unshift(data.ruleSet);
    setEditor(data.ruleSet);
    window.history.pushState({}, '', detailUrl(data.ruleSet.id));
  }

  function applyRuleSet() {
    const ruleSet = selectedRuleSet();
    if (!ruleSet) return;
    sessionStorage.setItem('freeAudit.pendingRuleSet', JSON.stringify({
      ruleSetId: ruleSet.id,
      name: ruleSet.name,
      rules: ruleSet.rules || []
    }));
    window.location.href = '/?scratch=1';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await loadCatalog();
      await loadRuleSets();
      document.getElementById('newRuleSet').addEventListener('click', () => {
        setEditor(null);
        setMode('detail');
        window.history.pushState({}, '', detailUrl(null));
      });
      document.getElementById('backToRuleSets').addEventListener('click', () => {
        setEditor(null);
        setMode('list');
        window.history.pushState({}, '', '/rule-sets.html');
      });
      document.getElementById('saveRuleSet').addEventListener('click', () => saveRuleSet().catch((err) => alert(err.message)));
      document.getElementById('deleteRuleSet').addEventListener('click', () => deleteRuleSet().catch((err) => alert(err.message)));
      document.getElementById('duplicateRuleSet').addEventListener('click', () => duplicateRuleSet().catch((err) => alert(err.message)));
      document.getElementById('applyRuleSet').addEventListener('click', applyRuleSet);
      document.getElementById('ruleSetSearch').addEventListener('input', renderList);
      document.getElementById('ruleSetList').addEventListener('click', (event) => {
        if (event.target.closest('[data-create-empty-rule-set]')) {
          setEditor(null);
          setMode('detail');
          window.history.pushState({}, '', detailUrl(null));
          return;
        }
        const card = event.target.closest('[data-id]');
        if (!card) return;
        window.location.href = detailUrl(card.dataset.id);
      });
    } catch (err) {
      alert(err.message || 'Failed to initialize rule sets');
    }
  });
})();
