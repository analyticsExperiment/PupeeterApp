(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const ACTION_OPTIONS = [
    'openUrl',
    'navigateToUrl',
    'pageRefresh',
    'click',
    'fillFormField',
    'type',
    'selectDropdownOption',
    'checkCheckbox',
    'uncheckCheckbox',
    'uploadFile',
    'pressKey',
    'waitForSelector',
    'waitForTimeout',
    'hover',
    'scroll',
    'switchToIFrame',
    'switchToMainFrame',
    'executeJavaScript',
    'waitForNavigation',
    'waitForNetworkIdle',
    'waitForRequestMatching',
    'waitForResponseMatching',
    'captureStepSnapshot',
    'assertElementExists',
    'assertElementText',
    'assertUrlContains'
  ];

  const state = {
    configs: [],
    templates: [],
    ruleSets: [],
    selectedId: null,
    isDirty: false,
    suppressDirty: false,
    mode: 'list',
    eventSource: null
  };

  function selectedConfig() {
    return state.configs.find((config) => config.id === state.selectedId) || null;
  }

  function markDirty() {
    if (!state.suppressDirty) state.isDirty = true;
  }

  function markClean() {
    state.isDirty = false;
  }

  function setMode(mode) {
    state.mode = mode === 'detail' ? 'detail' : 'list';
    const page = document.querySelector('.console-page');
    page?.classList.toggle('configs-list-mode', state.mode === 'list');
    page?.classList.toggle('configs-detail-mode', state.mode === 'detail');
    document.getElementById('backToInteractionConfigs')?.classList.toggle('hidden', state.mode !== 'detail');
  }

  function showSiteDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'site-dialog-overlay';
      overlay.innerHTML = `
        <div class="site-dialog" role="dialog" aria-modal="true">
          <div class="site-dialog-header">
            <div>
              <h2>${escapeHtml(title)}</h2>
              ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
            </div>
            <button class="pill site-dialog-x" type="button" aria-label="Close">X</button>
          </div>
          <div class="site-dialog-actions">
            <button class="pill site-dialog-cancel" type="button">${escapeHtml(cancelLabel)}</button>
            <button class="${danger ? 'danger-button' : 'button-style'} site-dialog-confirm" type="button">${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      `;
      const finish = (value) => {
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        resolve(value);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      };
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay || event.target.closest('.site-dialog-cancel') || event.target.closest('.site-dialog-x')) finish(false);
        if (event.target.closest('.site-dialog-confirm')) finish(true);
      });
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);
      overlay.querySelector('.site-dialog-confirm')?.focus();
    });
  }

  async function confirmIfDirty() {
    if (!state.isDirty) return true;
    return showSiteDialog({
      title: 'Unsaved Interaction Changes',
      message: 'You have unsaved changes. Leave to discard them, or stay and save first.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: true
    });
  }

  function parseJsonTextarea(id, fallback = {}) {
    const raw = document.getElementById(id).value.trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  }

  function actionOptionsHtml(selected) {
    return ACTION_OPTIONS.map((action) => `<option value="${escapeHtml(action)}"${action === selected ? ' selected' : ''}>${escapeHtml(action)}</option>`).join('');
  }

  function actionHelp(action) {
    const normalized = String(action || '').toLowerCase();
    if (['openurl', 'navigatetourl', 'navigate'].includes(normalized)) return ['URL', 'Optional notes'];
    if (['pagerefresh', 'refresh', 'reload'].includes(normalized)) return ['Not required', 'Not required'];
    if (normalized === 'presskey') return ['Optional selector', 'Key, e.g. Enter'];
    if (normalized === 'selectdropdownoption') return ['Select selector', 'Option value'];
    if (normalized === 'uploadfile') return ['File input selector', 'Local file path'];
    if (normalized === 'waitforrequestmatching' || normalized === 'waitforresponsematching' || normalized === 'asserturlcontains') return ['Not required', 'URL fragment'];
    if (normalized === 'executejavascript') return ['Optional selector/context', 'JavaScript code'];
    if (normalized === 'assertelementtext') return ['Selector', 'Expected text fragment'];
    if (['waitfortimeout', 'waitfornavigation', 'waitfornetworkidle', 'capturestepsnapshot', 'switchtomainframe'].includes(normalized)) return ['Not required', 'Not required'];
    return ['Selector', 'Value if needed'];
  }

  function updateStepPlaceholders(card) {
    const action = card.querySelector('.journey-action')?.value || 'click';
    const normalized = String(action || '').toLowerCase();
    card.dataset.action = normalized;
    const [selectorPlaceholder, valuePlaceholder] = actionHelp(action);
    card.querySelector('.journey-selector').placeholder = selectorPlaceholder;
    card.querySelector('.journey-value').placeholder = valuePlaceholder;
  }

  function updateStepOrder() {
    const cards = Array.from(document.querySelectorAll('#interactionSteps .journey-step-card'));
    cards.forEach((card, index) => {
      card.querySelector('.journey-step-number').textContent = String(index + 1);
      card.querySelector('.move-up').disabled = index === 0;
      card.querySelector('.move-down').disabled = index === cards.length - 1;
    });
    renderSummary(selectedConfig());
  }

  function buildStepCard(step = {}) {
    const card = document.createElement('div');
    card.className = 'journey-step-card is-open';
    card.innerHTML = `
      <div class="journey-step-top">
        <div class="journey-step-title">
          <span class="journey-step-index journey-step-number">1</span>
          <input class="journey-step-name" placeholder="Step name" value="${escapeHtml(step.name || '')}" />
          <label class="check-label compact"><input class="journey-enabled" type="checkbox"${step.enabled === false ? '' : ' checked'} /> Enabled</label>
        </div>
        <div class="journey-step-actions">
          <button class="journey-toggle" type="button" aria-expanded="true">Collapse</button>
          <button class="move-up" type="button">Up</button>
          <button class="move-down" type="button">Dn</button>
          <button class="danger-button remove-step" type="button">X</button>
        </div>
      </div>
      <div class="journey-step-body">
        <div class="journey-step-grid">
          <select class="journey-action">${actionOptionsHtml(step.action || 'click')}</select>
          <input class="journey-selector" placeholder="selector" value="${escapeHtml(step.selector || '')}" />
          <textarea class="journey-value" rows="2" placeholder="value">${escapeHtml(step.value || '')}</textarea>
          <input class="journey-timeout" type="number" min="0" placeholder="timeout ms" value="${escapeHtml(step.timeout || '')}" />
          <input class="journey-wait-after" type="number" min="0" placeholder="wait after ms" value="${escapeHtml(step.waitAfter || '')}" />
          <input class="journey-iframe" placeholder="optional iframe selector/context" value="${escapeHtml(step.iframeSelector || '')}" />
        </div>
        <div class="journey-step-extra">
          <input class="journey-notes" placeholder="notes/description" value="${escapeHtml(step.notes || step.description || '')}" />
          <label class="check-label compact"><input class="journey-snapshot" type="checkbox"${step.captureStepSnapshot ? ' checked' : ''} /> Capture snapshot after this step</label>
        </div>
      </div>
    `;
    card.querySelector('.journey-action').addEventListener('change', () => {
      updateStepPlaceholders(card);
      markDirty();
    });
    card.querySelector('.move-up').addEventListener('click', () => {
      const previous = card.previousElementSibling;
      if (previous) card.parentElement.insertBefore(card, previous);
      updateStepOrder();
      markDirty();
    });
    card.querySelector('.move-down').addEventListener('click', () => {
      const next = card.nextElementSibling;
      if (next) card.parentElement.insertBefore(next, card);
      updateStepOrder();
      markDirty();
    });
    card.querySelector('.journey-toggle').addEventListener('click', () => {
      const shouldOpen = card.classList.contains('is-collapsed');
      card.classList.toggle('is-collapsed', !shouldOpen);
      card.classList.toggle('is-open', shouldOpen);
      const toggle = card.querySelector('.journey-toggle');
      toggle.textContent = shouldOpen ? 'Collapse' : 'Open';
      toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    });
    card.querySelector('.remove-step').addEventListener('click', () => {
      card.remove();
      updateStepOrder();
      markDirty();
    });
    updateStepPlaceholders(card);
    return card;
  }

  function addStep(step = {}) {
    document.getElementById('interactionSteps').appendChild(buildStepCard(step));
    updateStepOrder();
  }

  function setSteps(steps = []) {
    const root = document.getElementById('interactionSteps');
    root.innerHTML = '';
    (Array.isArray(steps) && steps.length ? steps : [{ action: 'openUrl', name: 'Open starting page' }]).forEach(addStep);
    updateStepOrder();
  }

  function isDefaultStartingStepCard(card) {
    const action = String(card.querySelector('.journey-action')?.value || '').toLowerCase();
    const name = String(card.querySelector('.journey-step-name')?.value || '').trim().toLowerCase();
    const selector = String(card.querySelector('.journey-selector')?.value || '').trim();
    const value = String(card.querySelector('.journey-value')?.value || '').trim();
    const notes = String(card.querySelector('.journey-notes')?.value || '').trim();
    return name === 'open starting page'
      && (action === 'openurl' || action === 'navigatetourl' || action === 'navigate')
      && !selector
      && !value
      && !notes;
  }

  function removeDefaultStartingStepIfUnused() {
    const cards = Array.from(document.querySelectorAll('#interactionSteps .journey-step-card'));
    if (cards.length === 1 && isDefaultStartingStepCard(cards[0])) {
      cards[0].remove();
      updateStepOrder();
    }
  }

  function collectSteps() {
    return Array.from(document.querySelectorAll('#interactionSteps .journey-step-card')).map((card, index) => ({
      name: card.querySelector('.journey-step-name').value.trim() || `Step ${index + 1}`,
      action: card.querySelector('.journey-action').value,
      selector: card.querySelector('.journey-selector').value.trim(),
      value: card.querySelector('.journey-value').value,
      timeout: Number(card.querySelector('.journey-timeout').value || 0) || undefined,
      waitAfter: Number(card.querySelector('.journey-wait-after').value || 0) || undefined,
      iframeSelector: card.querySelector('.journey-iframe').value.trim(),
      notes: card.querySelector('.journey-notes').value.trim(),
      enabled: card.querySelector('.journey-enabled').checked,
      captureStepSnapshot: card.querySelector('.journey-snapshot').checked
    }));
  }

  function selectedCheckboxIds(selector) {
    return Array.from(document.querySelectorAll(`${selector}:checked`)).map((input) => input.value);
  }

  function renderTemplatePicker(selectedIds = []) {
    const selected = new Set(selectedIds);
    document.getElementById('templateImportList').innerHTML = state.templates.map((template) => `
      <label class="picker-row">
        <input type="checkbox" value="${escapeHtml(template.id)}"${selected.has(template.id) ? ' checked' : ''} />
        <span>
          <strong>${escapeHtml(template.name)}</strong>
          <span>${template.steps?.length || 0} steps | Updated ${formatDateTime(template.updatedAt)}</span>
        </span>
      </label>
    `).join('') || '<div class="template-empty">No Interaction Flow Templates saved yet.</div>';
  }

  function renderRuleSetPicker(selectedIds = []) {
    const selected = new Set(selectedIds);
    document.getElementById('ruleSetImportList').innerHTML = state.ruleSets.map((set) => `
      <label class="picker-row">
        <input type="checkbox" value="${escapeHtml(set.id)}"${selected.has(set.id) ? ' checked' : ''} />
        <span>
          <strong>${escapeHtml(set.name)}</strong>
          <span>${set.rules?.length || 0} rules | Updated ${formatDateTime(set.updatedAt)}</span>
        </span>
      </label>
    `).join('') || '<div class="template-empty">No Rule Sets saved yet.</div>';
  }

  function renderConfigList() {
    const query = document.getElementById('interactionSearch').value.trim().toLowerCase();
    const filtered = state.configs.filter((config) => !query || `${config.name} ${config.startingUrl} ${config.description}`.toLowerCase().includes(query));
    document.getElementById('interactionConfigList').innerHTML = filtered.map((config) => `
      <button class="config-card selectable ${config.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(config.id)}" type="button">
        <div>
          <strong>${escapeHtml(config.name)}</strong>
          <div class="muted">${escapeHtml(config.startingUrl || 'No starting URL')} | Updated ${formatDateTime(config.updatedAt)}</div>
          ${state.mode === 'list' ? `<p>${escapeHtml(config.description || 'Open this interaction config to review the guided journey.')}</p>` : ''}
        </div>
        <div class="config-card-actions">
          <span class="pill">${config.steps?.length || 0} steps</span>
          <span class="pill">${config.runCount || 0} runs</span>
          ${config.lastRunStatus ? `<span class="pill">${escapeHtml(config.lastRunStatus)}</span>` : ''}
        </div>
      </button>
    `).join('') || `
      <div class="config-empty-state">
        <h2>No interaction configs yet</h2>
        <p class="muted">Create a guided journey to test clicks, forms, iframes, requests, console logs, and rules step-by-step.</p>
        <button class="button-style" type="button" data-create-empty-interaction>Create Interaction Config</button>
      </div>
    `;
  }

  function renderSummary(config) {
    const steps = collectSteps();
    const templateIds = selectedCheckboxIds('#templateImportList input');
    const ruleIds = selectedCheckboxIds('#ruleSetImportList input');
    document.getElementById('interactionSummary').innerHTML = `
      <div><strong>Status</strong><span>${config?.id ? 'Saved' : 'Draft'}</span></div>
      <div><strong>Starting URL</strong><span>${escapeHtml(document.getElementById('interactionStartingUrl').value || '-')}</span></div>
      <div><strong>Module</strong><span>${escapeHtml(document.getElementById('interactionBrowserEngine').value || 'playwright')}</span></div>
      <div><strong>Steps</strong><span>${steps.length}</span></div>
      <div><strong>Linked Templates</strong><span>${templateIds.length}</span></div>
      <div><strong>Linked Rules</strong><span>${ruleIds.length}</span></div>
      <div><strong>Wait Until</strong><span>${escapeHtml(document.getElementById('interactionWaitUntil').value)}</span></div>
      <div><strong>Last Run</strong><span>${escapeHtml(config?.lastRunStatus || '-')}</span></div>
    `;
    document.getElementById('journeyPreview').innerHTML = [
      `<div>1. Open Starting URL<br><span>${escapeHtml(document.getElementById('interactionStartingUrl').value || 'Not set')}</span></div>`,
      `<div>2. Execute Journey<br><span>${steps.length} ordered step(s)</span></div>`,
      `<div>3. Capture Evidence<br><span>Network, console, cookies, dataLayer, rules</span></div>`,
      `<div>4. Generate Interaction Report<br><span>Step-level results and exports</span></div>`
    ].join('');
  }

  async function loadConfigDetail(id) {
    const data = await apiJson(`/api/interaction-configs/${encodeURIComponent(id)}`);
    return data.config;
  }

  async function setEditor(config) {
    state.suppressDirty = true;
    state.selectedId = config?.id || null;
    const hydrated = config?.id ? await loadConfigDetail(config.id) : null;
    const source = hydrated || config || {};
    const settings = source.generalSettings || {};
    document.getElementById('interactionName').value = source.name || '';
    document.getElementById('interactionDescription').value = source.description || '';
    document.getElementById('interactionStartingUrl').value = source.startingUrl || '';
    document.getElementById('interactionWaitUntil').value = source.waitUntil || 'domcontentloaded';
    document.getElementById('interactionBrowserEngine').value = settings.browserEngine || source.browserEngine || 'playwright';
    document.getElementById('interactionShowBrowser').checked = source.showBrowser !== false;
    document.getElementById('interactionStopOnFailure').checked = settings.stopOnStepFailure !== false;
    document.getElementById('interactionAdvanced').value = JSON.stringify({
      userAgent: settings.userAgent || '',
      acceptLanguage: settings.acceptLanguage || 'en-US,en;q=0.9',
      navigationTimeoutMs: settings.navigationTimeoutMs || 60000,
      defaultTimeoutMs: settings.defaultTimeoutMs || 30000
    }, null, 2);
    setSteps(source.steps || []);
    renderTemplatePicker((source.flowTemplates || []).map((item) => item.id));
    renderRuleSetPicker((source.ruleSets || []).map((item) => item.id));
    renderConfigList();
    renderSummary(source.id ? source : null);
    markClean();
    state.suppressDirty = false;
  }

  function collectEditor() {
    const advanced = parseJsonTextarea('interactionAdvanced', {});
    return {
      name: document.getElementById('interactionName').value.trim(),
      description: document.getElementById('interactionDescription').value.trim(),
      startingUrl: document.getElementById('interactionStartingUrl').value.trim(),
      waitUntil: document.getElementById('interactionWaitUntil').value,
      showBrowser: document.getElementById('interactionShowBrowser').checked,
      generalSettings: {
        ...advanced,
        browserEngine: document.getElementById('interactionBrowserEngine').value,
        stopOnStepFailure: document.getElementById('interactionStopOnFailure').checked
      },
      steps: collectSteps(),
      flowTemplateIds: selectedCheckboxIds('#templateImportList input'),
      ruleSetIds: selectedCheckboxIds('#ruleSetImportList input')
    };
  }

  async function loadAll() {
    const [configs, templates, ruleSets] = await Promise.all([
      apiJson('/api/interaction-configs'),
      apiJson('/api/interaction-flow-templates'),
      apiJson('/api/rule-sets')
    ]);
    state.configs = configs.configs || [];
    state.templates = templates.templates || [];
    state.ruleSets = ruleSets.ruleSets || [];
    renderTemplatePicker();
    renderRuleSetPicker();
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');
    const shouldShowDetail = params.get('new') === '1' || Boolean(requestedId);
    setMode(shouldShowDetail ? 'detail' : 'list');
    renderConfigList();
    await setEditor(shouldShowDetail && requestedId ? state.configs.find((config) => config.id === requestedId) : null);
  }

  async function saveConfig(asNew = false) {
    const payload = collectEditor();
    if (!payload.name) return alert('Interaction config name is required');
    if (!payload.startingUrl) return alert('Starting URL is required');
    const currentId = asNew ? null : state.selectedId;
    const data = currentId
      ? await apiJson(`/api/interaction-configs/${encodeURIComponent(currentId)}`, { method: 'PUT', body: payload })
      : await apiJson('/api/interaction-configs', { method: 'POST', body: payload });
    const saved = data.config;
    const index = state.configs.findIndex((config) => config.id === saved.id);
    if (index >= 0) state.configs[index] = saved;
    else state.configs.unshift(saved);
    await setEditor(saved);
    setMode('detail');
    window.history.replaceState({}, '', `/interaction-configs.html?id=${encodeURIComponent(saved.id)}`);
    markClean();
    return saved;
  }

  async function deleteConfig() {
    if (!state.selectedId) return;
    const confirmed = await showSiteDialog({
      title: 'Delete Interaction Config',
      message: 'This removes the saved interaction config. Existing interaction run history is preserved.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true
    });
    if (!confirmed) return;
    await apiJson(`/api/interaction-configs/${encodeURIComponent(state.selectedId)}`, { method: 'DELETE' });
    state.configs = state.configs.filter((config) => config.id !== state.selectedId);
    await setEditor(null);
    setMode('list');
    window.history.replaceState({}, '', '/interaction-configs.html');
  }

  async function duplicateConfig() {
    if (!state.selectedId) return;
    const data = await apiJson(`/api/interaction-configs/${encodeURIComponent(state.selectedId)}/duplicate`, { method: 'POST', body: {} });
    state.configs.unshift(data.config);
    await setEditor(data.config);
    setMode('detail');
    window.history.replaceState({}, '', `/interaction-configs.html?id=${encodeURIComponent(data.config.id)}`);
  }

  function appendSelectedTemplateSteps(replace = false) {
    const ids = new Set(selectedCheckboxIds('#templateImportList input'));
    const steps = state.templates.filter((template) => ids.has(template.id)).flatMap((template) => template.steps || []);
    if (!steps.length) return alert('Select at least one template with steps');
    if (replace) setSteps(steps);
    else {
      removeDefaultStartingStepIfUnused();
      steps.forEach((step) => addStep({ ...step, name: step.name || step.action || 'Imported step' }));
    }
    markDirty();
  }

  function connectInteractionLogs(runId) {
    if (state.eventSource) state.eventSource.close();
    const stream = document.getElementById('interactionLogStream');
    stream.innerHTML = '';
    state.eventSource = new EventSource(`/api/interaction-runs/${encodeURIComponent(runId)}/logs`);
    state.eventSource.addEventListener('log', (event) => {
      const log = JSON.parse(event.data);
      const row = document.createElement('div');
      row.className = `log-line ${log.level || 'info'}`;
      row.textContent = `[${new Date(log.ts || Date.now()).toLocaleTimeString()}] ${log.level || 'info'} ${log.msg || ''}${log.error ? ` - ${log.error}` : ''}`;
      stream.appendChild(row);
      stream.scrollTop = stream.scrollHeight;
    });
    state.eventSource.addEventListener('done', () => {
      state.eventSource.close();
      state.eventSource = null;
      window.location.href = `/interaction-report.html?id=${encodeURIComponent(runId)}`;
    });
  }

  async function runConfig() {
    const saved = await saveConfig(false);
    if (!saved?.id) return;
    const data = await apiJson(`/api/interaction-configs/${encodeURIComponent(saved.id)}/run`, { method: 'POST', body: {} });
    document.getElementById('interactionRunStatus').classList.remove('hidden');
    document.getElementById('interactionRunContext').textContent = `Running ${saved.name}`;
    document.getElementById('interactionStatusText').textContent = 'Interaction is running...';
    connectInteractionLogs(data.id);
    const poll = setInterval(async () => {
      try {
        const status = await apiJson(`/api/interaction-runs/${encodeURIComponent(data.id)}/status`);
        const progress = status.progress?.progress || status.progress?.processed || 0;
        document.getElementById('interactionProgressBar').style.width = `${Math.min(100, Number(progress) || 0)}%`;
        document.getElementById('interactionStatusText').textContent = `${status.status} ${status.progress?.current || ''}`;
        if (status.status === 'completed' || status.status === 'failed') clearInterval(poll);
      } catch (_) {
        clearInterval(poll);
      }
    }, 1500);
  }

  function bindTabs() {
    document.querySelectorAll('.tab').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
        button.classList.add('active');
        document.querySelector(`[data-panel="${button.dataset.tab}"]`)?.classList.add('active');
      });
    });
  }

  function bindDirtyGuards() {
    const editor = document.querySelector('.config-center');
    editor?.addEventListener('input', () => {
      markDirty();
      renderSummary(selectedConfig());
    });
    editor?.addEventListener('change', () => {
      markDirty();
      renderSummary(selectedConfig());
    });
    document.addEventListener('click', async (event) => {
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const href = link.getAttribute('href') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      event.preventDefault();
      event.stopPropagation();
      if (!(await confirmIfDirty())) return;
      markClean();
      window.location.href = link.href;
    }, true);
  }

  async function newConfig() {
    if (!(await confirmIfDirty())) return;
    await setEditor(null);
    setMode('detail');
    window.history.pushState({}, '', '/interaction-configs.html?new=1');
  }

  async function selectConfig(id) {
    if (!(await confirmIfDirty())) return;
    const config = state.configs.find((item) => item.id === id);
    await setEditor(config);
    setMode('detail');
    window.history.pushState({}, '', `/interaction-configs.html?id=${encodeURIComponent(id)}`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindDirtyGuards();
    document.getElementById('newInteractionConfig').addEventListener('click', newConfig);
    document.getElementById('backToInteractionConfigs').addEventListener('click', async () => {
      if (!(await confirmIfDirty())) return;
      markClean();
      setMode('list');
      window.history.pushState({}, '', '/interaction-configs.html');
    });
    document.getElementById('addInteractionStep').addEventListener('click', () => {
      addStep({ action: 'click', name: 'New step' });
      markDirty();
    });
    document.getElementById('appendTemplateSteps').addEventListener('click', () => appendSelectedTemplateSteps(false));
    document.getElementById('replaceTemplateSteps').addEventListener('click', () => appendSelectedTemplateSteps(true));
    document.getElementById('saveInteractionConfig').addEventListener('click', () => saveConfig(false).catch((err) => alert(err.message)));
    document.getElementById('saveInteractionAsNew').addEventListener('click', () => saveConfig(true).catch((err) => alert(err.message)));
    document.getElementById('deleteInteractionConfig').addEventListener('click', () => deleteConfig().catch((err) => alert(err.message)));
    document.getElementById('duplicateInteractionConfig').addEventListener('click', () => duplicateConfig().catch((err) => alert(err.message)));
    document.getElementById('runInteractionConfig').addEventListener('click', () => runConfig().catch((err) => alert(err.message)));
    document.getElementById('interactionSearch').addEventListener('input', renderConfigList);
    document.getElementById('interactionConfigList').addEventListener('click', async (event) => {
      if (event.target.closest('[data-create-empty-interaction]')) return newConfig();
      const card = event.target.closest('[data-id]');
      if (!card) return;
      await selectConfig(card.dataset.id);
    });
    loadAll().catch((err) => alert(err.message || 'Failed to load interaction configs'));
  });
})();
