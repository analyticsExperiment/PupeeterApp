(function () {
  const { apiJson, escapeHtml, formatDateTime } = window.FreeAuditApi;
  const actionBuilder = window.FreeAuditActionBuilder;
  const state = {
    configs: [],
    selectedId: null,
    templates: { pre: [], post: [], rules: [] },
    assembledPayload: null,
    isDirty: false,
    suppressDirty: false,
    mode: 'list'
  };

  function selectedConfig() {
    return state.configs.find((config) => config.id === state.selectedId) || null;
  }

  function selectedValues(selectId) {
    return Array.from(document.getElementById(selectId).selectedOptions).map((option) => option.value);
  }

  function setSelectedValues(selectId, ids) {
    const values = new Set(ids || []);
    Array.from(document.getElementById(selectId).options).forEach((option) => {
      option.selected = values.has(option.value);
    });
    renderTemplateSummaries();
  }

  function fillSelect(selectId, items, labelSuffix) {
    document.getElementById(selectId).innerHTML = items.map((item) => {
      const suffix = labelSuffix ? ` (${labelSuffix(item)})` : '';
      return `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${escapeHtml(suffix)}</option>`;
    }).join('');
    renderTemplateSummaries();
  }

  function setTemplateEmptyState() {
    document.getElementById('preTemplateEmpty').classList.toggle('hidden', state.templates.pre.length > 0);
    document.getElementById('postTemplateEmpty').classList.toggle('hidden', state.templates.post.length > 0);
    document.getElementById('ruleSetEmpty').classList.toggle('hidden', state.templates.rules.length > 0);
  }

  function renderTemplateSummary(selectId, summaryId, items, itemMeta) {
    const target = document.getElementById(summaryId);
    const select = document.getElementById(selectId);
    if (!target || !select) return;
    const selectedIds = new Set(Array.from(select.selectedOptions).map((option) => option.value));
    const selected = items.filter((item) => selectedIds.has(item.id));
    target.innerHTML = selected.length
      ? selected.map((item) => `
        <span class="template-chip">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(itemMeta(item))}</small>
        </span>
      `).join('')
      : '<span class="muted">No common items selected.</span>';
  }

  function renderTemplateSummaries() {
    renderTemplateSummary('preTemplateSelect', 'preTemplateSummary', state.templates.pre, (item) => `${item.steps?.length || 0} steps`);
    renderTemplateSummary('postTemplateSelect', 'postTemplateSummary', state.templates.post, (item) => `${item.steps?.length || 0} steps`);
    renderTemplateSummary('ruleSetSelect', 'ruleSetSummary', state.templates.rules, (item) => `${item.rules?.length || 0} rules`);
  }

  function markDirty() {
    if (!state.suppressDirty) state.isDirty = true;
  }

  function markClean() {
    state.isDirty = false;
  }

  function showSiteDialog({ title, message, bodyHtml = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'site-dialog-overlay';
      overlay.innerHTML = `
        <div class="site-dialog" role="dialog" aria-modal="true" aria-labelledby="siteDialogTitle">
          <div class="site-dialog-header">
            <div>
              <h2 id="siteDialogTitle">${escapeHtml(title)}</h2>
              ${message ? `<p class="muted">${escapeHtml(message)}</p>` : ''}
            </div>
            <button class="pill site-dialog-x" type="button" aria-label="Close">X</button>
          </div>
          ${bodyHtml ? `<div class="site-dialog-body">${bodyHtml}</div>` : ''}
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
        if (event.target === overlay || event.target.closest('.site-dialog-cancel') || event.target.closest('.site-dialog-x')) {
          finish(false);
        }
        if (event.target.closest('.site-dialog-confirm')) {
          finish(true);
        }
      });
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);
      overlay.querySelector('.site-dialog-confirm')?.focus();
    });
  }

  async function confirmIfDirty() {
    if (!state.isDirty) return true;
    return showSiteDialog({
      title: 'Unsaved Config Changes',
      message: 'You have unsaved changes in this audit config. Choose Leave to discard them, or Stay to continue editing.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
      danger: true
    });
  }

  async function showItemPicker({ title, message, items, selectedIds, emptyText, manageHref, manageLabel, itemMeta }) {
    const selected = new Set(selectedIds || []);
    const bodyHtml = `
      <div class="picker-list">
        ${items.length ? items.map((item) => `
          <label class="picker-row">
            <input type="checkbox" value="${escapeHtml(item.id)}"${selected.has(item.id) ? ' checked' : ''} />
            <span>
              <strong>${escapeHtml(item.name)}</strong>
              <span>${escapeHtml(item.description || itemMeta(item))}</span>
            </span>
          </label>
        `).join('') : `<div class="template-empty">${escapeHtml(emptyText)}</div>`}
      </div>
      <div class="site-dialog-secondary">
        <a class="pill" href="${escapeHtml(manageHref)}">${escapeHtml(manageLabel)}</a>
      </div>
    `;
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'site-dialog-overlay';
      overlay.innerHTML = `
        <div class="site-dialog site-dialog-wide" role="dialog" aria-modal="true">
          <div class="site-dialog-header">
            <div>
              <h2>${escapeHtml(title)}</h2>
              <p class="muted">${escapeHtml(message)}</p>
            </div>
            <button class="pill site-dialog-x" type="button" aria-label="Close">X</button>
          </div>
          <div class="site-dialog-body">${bodyHtml}</div>
          <div class="site-dialog-actions">
            <button class="pill site-dialog-cancel" type="button">Cancel</button>
            <button class="button-style site-dialog-confirm" type="button">OK</button>
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
          finish(null);
        }
      };
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay || event.target.closest('.site-dialog-cancel') || event.target.closest('.site-dialog-x')) {
          finish(null);
          return;
        }
        if (event.target.closest('.site-dialog-confirm')) {
          const ids = Array.from(overlay.querySelectorAll('.picker-row input:checked')).map((input) => input.value);
          finish(ids);
        }
      });
      document.body.appendChild(overlay);
      document.addEventListener('keydown', onKeyDown, true);
      overlay.querySelector('.site-dialog-confirm')?.focus();
    });
  }

  function splitAdvancedOptions(options = {}) {
    const {
      preAuditActions,
      postAuditActions,
      onPageActions,
      rules,
      browserEngine,
      workerMode,
      simultaneousWorkers,
      customWorkers,
      ...advanced
    } = options || {};
    return {
      advanced,
      preAuditActions: Array.isArray(preAuditActions) ? preAuditActions : [],
      postAuditActions: Array.isArray(postAuditActions) ? postAuditActions : (Array.isArray(onPageActions) ? onPageActions : []),
      rules: Array.isArray(rules) ? rules : [],
      browserEngine: browserEngine || 'puppeteer',
      workerMode: workerMode || 'ram-protected',
      simultaneousWorkers: simultaneousWorkers || customWorkers || 2
    };
  }

  function setMode(mode) {
    state.mode = mode === 'detail' ? 'detail' : 'list';
    const page = document.querySelector('.console-page');
    page?.classList.toggle('configs-list-mode', state.mode === 'list');
    page?.classList.toggle('configs-detail-mode', state.mode === 'detail');
    document.getElementById('backToConfigs')?.classList.toggle('hidden', state.mode !== 'detail');
  }

  function updateWorkerControlState() {
    const mode = document.getElementById('configWorkerMode')?.value;
    const custom = document.getElementById('configCustomWorkers');
    if (!custom) return;
    custom.disabled = mode !== 'custom';
    custom.parentElement?.classList.toggle('is-disabled', mode !== 'custom');
  }

  function setConfigRules(rules = []) {
    const root = document.getElementById('rulesList');
    if (!root || !window.RuleBuilder) return;
    root.innerHTML = '';
    (Array.isArray(rules) ? rules : []).forEach((rule) => window.RuleBuilder.addRule(rule));
  }

  function setConfigSteps(containerId, steps = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (Array.isArray(steps) && steps.length) {
      actionBuilder.setSteps(container, steps);
    } else {
      container.innerHTML = '';
    }
  }

  function renderConfigList() {
    const query = document.getElementById('configSearch').value.trim().toLowerCase();
    const filtered = state.configs.filter((config) => !query || `${config.name} ${config.domain} ${config.description}`.toLowerCase().includes(query));
    document.getElementById('configList').innerHTML = filtered.map((config) => `
      <button class="config-card selectable ${config.id === state.selectedId ? 'selected' : ''}" data-id="${escapeHtml(config.id)}" type="button">
        <div>
          <strong>${escapeHtml(config.name)}</strong>
          <div class="muted">${escapeHtml(config.domain || 'No domain')} | Updated ${formatDateTime(config.updatedAt)}</div>
          ${state.mode === 'list' ? `<p>${escapeHtml(config.description || 'Open this config to review setup, templates, rules, and runtime settings.')}</p>` : ''}
        </div>
        <div class="config-card-actions">
          ${config.isDefault ? '<span class="pill">Default</span>' : ''}
          <span class="pill">${config.auditCount || 0} audits</span>
          ${state.mode === 'list' ? `<span class="pill">${escapeHtml(config.options?.browserEngine || 'puppeteer')}</span>` : ''}
        </div>
        ${state.mode === 'list' ? `
          <div class="config-card-footer">
            <span>${escapeHtml(config.maxPages || 15)} target pages</span>
            <span>${escapeHtml(config.waitUntil || 'domcontentloaded')}</span>
          </div>
        ` : ''}
      </button>
    `).join('') || `
      <div class="config-empty-state">
        <h2>No audit configs yet</h2>
        <p class="muted">Create a reusable setup first, then run audits from a controlled config.</p>
        <button class="button-style" type="button" data-create-empty-config>Create Audit Config</button>
      </div>
    `;
  }

  function renderSummary(config) {
    if (!config) {
      document.getElementById('configSummary').innerHTML = '<div class="muted">No config selected.</div>';
      document.getElementById('crawlPreview').innerHTML = '';
      return;
    }
    const inlinePreCount = Array.isArray(config.options?.preAuditActions) ? config.options.preAuditActions.length : 0;
    const inlinePostCount = Array.isArray(config.options?.postAuditActions) ? config.options.postAuditActions.length : 0;
    const inlineRulesCount = Array.isArray(config.options?.rules) ? config.options.rules.length : 0;
    const browserEngine = config.options?.browserEngine || 'puppeteer';
    const workerMode = config.options?.workerMode || 'ram-protected';
    const workers = config.options?.simultaneousWorkers || 2;
    document.getElementById('configSummary').innerHTML = `
      <div><strong>Status</strong><span>${config.isDefault ? 'Default' : 'Saved'}</span></div>
      <div><strong>Target Pages</strong><span>${escapeHtml(config.maxPages || 15)}</span></div>
      <div><strong>Same Origin</strong><span>${config.sameOriginOnly === false ? 'No' : 'Yes'}</span></div>
      <div><strong>Wait Until</strong><span>${escapeHtml(config.waitUntil || 'domcontentloaded')}</span></div>
      <div><strong>Engine</strong><span>${escapeHtml(browserEngine)}</span></div>
      <div><strong>Workers</strong><span>${escapeHtml(workerMode === 'custom' ? `${workers} custom` : workerMode)}</span></div>
      <div><strong>Pre-Audit Actions</strong><span>${config.preActionTemplates?.length || 0} templates, ${inlinePreCount} inline</span></div>
      <div><strong>On Page Actions</strong><span>${config.postActionTemplates?.length || 0} templates, ${inlinePostCount} inline</span></div>
      <div><strong>Rules</strong><span>${config.ruleSets?.length || 0} sets, ${inlineRulesCount} inline</span></div>
    `;
    document.getElementById('crawlPreview').innerHTML = `
      <div>1. Start URL<br><span>${escapeHtml(config.domain || config.urlSources?.[0] || 'Not set')}</span></div>
      <div>2. Pre-Audit Actions<br><span>${config.preActionTemplates?.length || 0} template(s), ${inlinePreCount} inline step(s)</span></div>
      <div>3. Crawl and Collect<br><span>Aim for ${config.maxPages || 15} pages, ${escapeHtml(String(workers))} tab worker(s)</span></div>
      <div>4. On Page Actions<br><span>${config.postActionTemplates?.length || 0} template(s), ${inlinePostCount} inline step(s)</span></div>
      <div>5. Rules Applied<br><span>${config.ruleSets?.length || 0} rule set(s), ${inlineRulesCount} inline rule(s)</span></div>
      <div>6. Generate Report<br><span>Results and exports</span></div>
    `;
  }

  async function loadConfigDetail(id) {
    const data = await apiJson(`/api/audit-configs/${encodeURIComponent(id)}`);
    state.assembledPayload = data.assembledPayload;
    return data.config;
  }

  async function setEditor(config) {
    state.suppressDirty = true;
    state.selectedId = config ? config.id : null;
    const hydrated = config?.id ? await loadConfigDetail(config.id) : null;
    const source = hydrated || config || {};
    const optionParts = splitAdvancedOptions(source.options || {});
    document.getElementById('configName').value = source.name || '';
    document.getElementById('configDescription').value = source.description || '';
    document.getElementById('configDefault').checked = Boolean(source.isDefault);
    document.getElementById('configDomain').value = source.domain || '';
    document.getElementById('configMaxPages').value = source.maxPages || 15;
    document.getElementById('configSameOrigin').value = source.sameOriginOnly === false ? 'false' : 'true';
    document.getElementById('configWaitUntil').value = source.waitUntil || 'domcontentloaded';
    document.getElementById('configShowBrowser').checked = source.showBrowser !== false;
    document.getElementById('configBrowserEngine').value = optionParts.browserEngine || 'puppeteer';
    document.getElementById('configWorkerMode').value = optionParts.workerMode || 'ram-protected';
    document.getElementById('configCustomWorkers').value = optionParts.simultaneousWorkers || 2;
    updateWorkerControlState();
    document.getElementById('configUrlSources').value = (source.urlSources || []).join('\n');
    document.getElementById('configIncludeSitemaps').checked = source.includeSitemaps !== false;
    document.getElementById('configOptions').value = JSON.stringify(optionParts.advanced || {}, null, 2);
    setConfigSteps('configPreSteps', optionParts.preAuditActions || []);
    setConfigSteps('configPostSteps', optionParts.postAuditActions || []);
    setConfigRules(optionParts.rules || []);
    setSelectedValues('preTemplateSelect', (source.preActionTemplates || []).map((item) => item.id));
    setSelectedValues('postTemplateSelect', (source.postActionTemplates || []).map((item) => item.id));
    setSelectedValues('ruleSetSelect', (source.ruleSets || []).map((item) => item.id));
    renderSummary(source.id ? source : null);
    renderConfigList();
    markClean();
    state.suppressDirty = false;
  }

  function collectEditor() {
    let options = {};
    const rawOptions = document.getElementById('configOptions').value.trim();
    if (rawOptions) {
      options = JSON.parse(rawOptions);
    }
    const inlinePre = actionBuilder.collectSteps(document.getElementById('configPreSteps'));
    const inlinePost = actionBuilder.collectSteps(document.getElementById('configPostSteps'));
    const inlineRules = window.RuleBuilder ? window.RuleBuilder.collectRules() : [];
    const workerMode = document.getElementById('configWorkerMode').value;
    const customWorkers = Number(document.getElementById('configCustomWorkers').value || 2);
    const simultaneousWorkers = workerMode === 'custom'
      ? customWorkers
      : (workerMode === 'ram-protected' ? 2 : Number(workerMode || 2));
    return {
      name: document.getElementById('configName').value.trim(),
      description: document.getElementById('configDescription').value.trim(),
      domain: document.getElementById('configDomain').value.trim(),
      maxPages: Number(document.getElementById('configMaxPages').value || 15),
      sameOriginOnly: document.getElementById('configSameOrigin').value === 'true',
      waitUntil: document.getElementById('configWaitUntil').value,
      showBrowser: document.getElementById('configShowBrowser').checked,
      urlSources: document.getElementById('configUrlSources').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      includeSitemaps: document.getElementById('configIncludeSitemaps').checked,
      options: {
        ...options,
        preAuditActions: inlinePre,
        postAuditActions: inlinePost,
        rules: inlineRules,
        browserEngine: document.getElementById('configBrowserEngine').value,
        workerMode,
        simultaneousWorkers
      },
      isDefault: document.getElementById('configDefault').checked,
      preActionTemplateIds: selectedValues('preTemplateSelect'),
      postActionTemplateIds: selectedValues('postTemplateSelect'),
      ruleSetIds: selectedValues('ruleSetSelect')
    };
  }

  async function loadAll() {
    const [configs, pre, post, rules] = await Promise.all([
      apiJson('/api/audit-configs'),
      apiJson('/api/action-templates?type=pre'),
      apiJson('/api/action-templates?type=post'),
      apiJson('/api/rule-sets')
    ]);
    state.configs = configs.configs || [];
    state.templates.pre = pre.templates || [];
    state.templates.post = post.templates || [];
    state.templates.rules = rules.ruleSets || [];
    fillSelect('preTemplateSelect', state.templates.pre, (item) => `${item.steps?.length || 0} steps`);
    fillSelect('postTemplateSelect', state.templates.post, (item) => `${item.steps?.length || 0} steps`);
    fillSelect('ruleSetSelect', state.templates.rules, (item) => `${item.rules?.length || 0} rules`);
    setTemplateEmptyState();
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');
    const shouldShowDetail = params.get('new') === '1' || Boolean(requestedId);
    setMode(shouldShowDetail ? 'detail' : 'list');
    renderConfigList();
    if (!shouldShowDetail) {
      await setEditor(null);
      setMode('list');
      return;
    }
    const initial = params.get('new') === '1'
      ? null
      : state.configs.find((config) => config.id === requestedId) || null;
    await setEditor(initial);
    setMode('detail');
  }

  async function saveConfig(asNew = false) {
    const payload = collectEditor();
    if (!payload.name) return alert('Config name is required');
    const currentId = asNew ? null : state.selectedId;
    const data = currentId
      ? await apiJson(`/api/audit-configs/${encodeURIComponent(currentId)}`, { method: 'PUT', body: payload })
      : await apiJson('/api/audit-configs', { method: 'POST', body: payload });
    const saved = data.config;
    state.assembledPayload = data.assembledPayload;
    const existingIndex = state.configs.findIndex((config) => config.id === saved.id);
    if (existingIndex >= 0) state.configs[existingIndex] = saved;
    else state.configs.unshift(saved);
    await setEditor(saved);
    markClean();
  }

  async function deleteConfig() {
    if (!state.selectedId) return;
    const confirmed = await showSiteDialog({
      title: 'Delete Audit Config',
      message: 'This removes the saved config. Existing audit history is not deleted.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true
    });
    if (!confirmed) return;
    await apiJson(`/api/audit-configs/${encodeURIComponent(state.selectedId)}`, { method: 'DELETE' });
    state.configs = state.configs.filter((config) => config.id !== state.selectedId);
    await setEditor(state.configs[0] || null);
    markClean();
  }

  async function duplicateConfig() {
    if (!state.selectedId) return;
    const data = await apiJson(`/api/audit-configs/${encodeURIComponent(state.selectedId)}/duplicate`, { method: 'POST', body: {} });
    state.configs.unshift(data.config);
    await setEditor(data.config);
  }

  async function runConfig() {
    await saveConfig(false);
    if (!state.selectedId) return alert('Select a config first');
    const data = await apiJson(`/api/audit-configs/${encodeURIComponent(state.selectedId)}/run`, { method: 'POST', body: {} });
    window.location.href = `/?auditId=${encodeURIComponent(data.id)}`;
  }

  async function chooseCommonTemplates(kind) {
    const picker = {
      pre: {
        title: 'Choose Common Pre-Audit Actions',
        message: 'Select reusable pre-audit action templates to attach to this config.',
        selectId: 'preTemplateSelect',
        items: state.templates.pre,
        emptyText: 'No common pre-audit templates exist yet.',
        manageHref: '/action-templates.html?type=pre',
        manageLabel: 'Open Pre-Audit Template Library',
        itemMeta: (item) => `${item.steps?.length || 0} steps`
      },
      post: {
        title: 'Choose Common On Page Actions',
        message: 'Select reusable On Page templates to attach to this config.',
        selectId: 'postTemplateSelect',
        items: state.templates.post,
        emptyText: 'No common On Page templates exist yet.',
        manageHref: '/action-templates.html?type=post',
        manageLabel: 'Open On Page Template Library',
        itemMeta: (item) => `${item.steps?.length || 0} steps`
      },
      rules: {
        title: 'Choose Common Rule Sets',
        message: 'Select reusable rule sets to attach to this config.',
        selectId: 'ruleSetSelect',
        items: state.templates.rules,
        emptyText: 'No common rule sets exist yet.',
        manageHref: '/rule-sets.html',
        manageLabel: 'Open Rule Set Library',
        itemMeta: (item) => `${item.rules?.length || 0} rules`
      }
    }[kind];
    if (!picker) return;
    const ids = await showItemPicker({
      title: picker.title,
      message: picker.message,
      items: picker.items,
      selectedIds: selectedValues(picker.selectId),
      emptyText: picker.emptyText,
      manageHref: picker.manageHref,
      manageLabel: picker.manageLabel,
      itemMeta: picker.itemMeta
    });
    if (!ids) return;
    setSelectedValues(picker.selectId, ids);
    markDirty();
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

  async function initRuleBuilder() {
    if (!window.RuleBuilder) return;
    const data = await apiJson('/api/tag-catalog');
    window.RuleBuilder.init({ ruleOptions: data.ruleOptions || [] });
    setConfigRules([]);
  }

  function bindDirtyGuards() {
    const editor = document.querySelector('.config-center');
    if (editor) {
      editor.addEventListener('input', markDirty);
      editor.addEventListener('change', markDirty);
      editor.addEventListener('click', (event) => {
        if (event.target.closest('.move-up, .move-down, .del, #addConfigPreStep, #addConfigPostStep, #addRule, #clearConfigRules')) {
          setTimeout(markDirty, 0);
        }
      });
    }

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

  async function guardedResetEditor() {
    if (!(await confirmIfDirty())) return;
    await setEditor(null);
    setMode('detail');
    window.history.pushState({}, '', '/audit-configs.html?new=1');
  }

  async function guardedLoadConfigIntoCreateAudit() {
    if (!state.selectedId) {
      window.location.href = '/';
      return;
    }
    if (!(await confirmIfDirty())) return;
    markClean();
    window.location.href = '/';
  }

  async function guardedSelectConfig(id) {
    if (!(await confirmIfDirty())) return;
    window.location.href = `/audit-configs.html?id=${encodeURIComponent(id)}`;
  }

  async function guardedBackToConfigs() {
    if (!(await confirmIfDirty())) return;
    markClean();
    window.location.href = '/audit-configs.html';
  }

  async function runConfigById(id) {
    if (!id) return;
    const data = await apiJson(`/api/audit-configs/${encodeURIComponent(id)}/run`, { method: 'POST', body: {} });
    window.location.href = `/?auditId=${encodeURIComponent(data.id)}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindTabs();
    bindDirtyGuards();
    document.getElementById('addConfigPreStep').addEventListener('click', () => actionBuilder.addStep(document.getElementById('configPreSteps'), { action: 'executeJavaScript' }));
    document.getElementById('addConfigPostStep').addEventListener('click', () => actionBuilder.addStep(document.getElementById('configPostSteps'), { action: 'executeJavaScript' }));
    document.getElementById('choosePreTemplates').addEventListener('click', () => chooseCommonTemplates('pre'));
    document.getElementById('choosePostTemplates').addEventListener('click', () => chooseCommonTemplates('post'));
    document.getElementById('chooseRuleSets').addEventListener('click', () => chooseCommonTemplates('rules'));
    document.getElementById('clearConfigRules').addEventListener('click', async () => {
      const confirmed = await showSiteDialog({
        title: 'Clear Config-Specific Rules',
        message: 'This clears only the rules written directly in this config. Common rule sets stay attached.',
        confirmLabel: 'Clear Rules',
        cancelLabel: 'Cancel',
        danger: true
      });
      if (!confirmed) return;
      setConfigRules([]);
      markDirty();
    });
    document.getElementById('newConfig').addEventListener('click', () => guardedResetEditor());
    document.getElementById('backToConfigs').addEventListener('click', () => guardedBackToConfigs());
    document.getElementById('saveConfig').addEventListener('click', () => saveConfig(false).catch((err) => alert(err.message)));
    document.getElementById('saveAsConfig').addEventListener('click', () => saveConfig(true).catch((err) => alert(err.message)));
    document.getElementById('deleteConfig').addEventListener('click', () => deleteConfig().catch((err) => alert(err.message)));
    document.getElementById('duplicateConfig').addEventListener('click', () => duplicateConfig().catch((err) => alert(err.message)));
    document.getElementById('runConfig').addEventListener('click', () => runConfig().catch((err) => alert(err.message)));
    document.getElementById('loadConfig').addEventListener('click', () => guardedLoadConfigIntoCreateAudit());
    document.getElementById('configSearch').addEventListener('input', renderConfigList);
    document.getElementById('configWorkerMode').addEventListener('change', updateWorkerControlState);
    document.getElementById('configList').addEventListener('click', async (event) => {
      if (event.target.closest('[data-create-empty-config]')) {
        await guardedResetEditor();
        return;
      }
      const card = event.target.closest('[data-id]');
      if (!card) return;
      await guardedSelectConfig(card.dataset.id);
    });
    initRuleBuilder()
      .then(loadAll)
      .catch((err) => alert(err.message || 'Failed to load audit configs'));
  });
})();
