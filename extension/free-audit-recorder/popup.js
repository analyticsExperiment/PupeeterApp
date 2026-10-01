(function () {
  const defaults = {
    baseUrl: 'http://localhost:3000',
    pairingToken: '',
    saveName: 'Recorded interaction'
  };
  let currentState = { steps: [], recording: false, paused: false };
  let manualConfigSelection = false;

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeBaseUrl(value) {
    return String(value || defaults.baseUrl).replace(/\/$/, '');
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(defaults);
    return {
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      pairingToken: stored.pairingToken || '',
      saveName: stored.saveName || defaults.saveName
    };
  }

  async function saveSettings() {
    await chrome.storage.local.set({
      baseUrl: normalizeBaseUrl($('baseUrl').value),
      saveName: $('saveName').value.trim() || defaults.saveName
    });
  }

  function renderSteps() {
    const root = $('stepPreview');
    const steps = currentState.steps || [];
    $('pauseRecording').textContent = currentState.paused ? 'Resume' : 'Pause';
    $('pauseRecording').disabled = !currentState.recording;
    $('stopRecording').disabled = !currentState.recording;
    $('startRecording').disabled = currentState.recording;
    for (const id of ['saveFlow', 'saveConfig', 'copyJson', 'exportJson']) $(id).disabled = !steps.length;
    root.innerHTML = steps.map((step) => {
      const label = step.label || `${step.action} ${step.selector || step.value || ''}`;
      const sensitive = step.sensitive ? ' <strong>(masked)</strong>' : '';
      return `<li><span>${escapeHtml(label)}${sensitive}</span></li>`;
    }).join('') || '<li class="muted">No steps recorded yet.</li>';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    return tab;
  }

  async function sendToTab(type) {
    const tab = await activeTab();
    const response = await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
    if (!response?.ok) throw new Error(response?.error || 'Recorder command failed');
    currentState = response.state || currentState;
    renderSteps();
    return currentState;
  }

  async function refreshState() {
    try {
      await sendToTab('FREE_AUDIT_GET');
    } catch (_) {
      renderSteps();
    }
  }

  async function checkConnection() {
    const settings = await getSettings();
    if (!settings.pairingToken) {
      $('connectionStatus').textContent = 'Not paired';
      $('accountName').textContent = 'Sign in through the local app to connect this extension.';
      $('connectAccount').disabled = false;
      $('disconnectAccount').disabled = true;
      return;
    }
    try {
      const response = await fetch(`${settings.baseUrl}/api/extension/status`, {
        headers: { Authorization: `Bearer ${settings.pairingToken}` }
      });
      const data = await response.json().catch(() => ({}));
      $('connectionStatus').textContent = response.ok ? 'Connected to Free Audit' : 'Pairing token rejected';
      $('accountName').textContent = response.ok ? `Signed in as ${data.user?.username || 'Free Audit user'}` : 'Reconnect through your app login.';
      $('connectAccount').disabled = response.ok;
      $('disconnectAccount').disabled = !response.ok;
    } catch (_) {
      $('connectionStatus').textContent = 'Free Audit app unreachable';
      $('accountName').textContent = 'Start the Free Audit app to reconnect.';
      $('connectAccount').disabled = false;
      $('disconnectAccount').disabled = true;
    }
  }

  async function connectAccount() {
    await saveSettings();
    const { baseUrl } = await getSettings();
    const result = await chrome.runtime.sendMessage({ type: 'FREE_AUDIT_CONNECT_START', baseUrl });
    if (!result?.ok) throw new Error(result?.error || 'Could not open Free Audit login');
    if (result.connected) {
      await checkConnection();
      await loadAuditConfigs();
      await refreshAttached();
    } else {
      $('connectionStatus').textContent = 'Waiting for Free Audit login';
      $('accountName').textContent = 'Log in in the app tab. This extension will connect automatically.';
    }
  }

  async function disconnectAccount() {
    const sessions = await chrome.storage.session.get(null);
    if (Object.keys(sessions).some((key) => key.startsWith('attached-audit-'))) {
      throw new Error('Stop all attached audits before disconnecting');
    }
    const settings = await getSettings();
    if (settings.pairingToken) {
      const response = await fetch(`${settings.baseUrl}/api/extension/current-token`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${settings.pairingToken}` }
      });
      if (!response.ok && response.status !== 401) throw new Error('Could not revoke the extension connection');
    }
    await chrome.storage.local.remove(['pairingToken', 'lastAttachedReport', 'selectedAuditConfig']);
    await chrome.storage.session.remove('pending-app-connection');
    $('pairingToken').value = '';
    $('attachedReport').hidden = true;
    await checkConnection();
    await loadAuditConfigs();
  }

  async function extensionApi(path) {
    const settings = await getSettings();
    if (!settings.pairingToken) throw new Error('Pairing token is required');
    const response = await fetch(`${settings.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${settings.pairingToken}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Free Audit returned HTTP ${response.status}`);
    return data;
  }

  async function loadAuditConfigs() {
    const select = $('attachedConfig');
    try {
      const settings = await getSettings();
      if (!settings.pairingToken) {
        select.innerHTML = '<option value="">Sign in to load configs</option>';
        renderAttached(null);
        return;
      }
      const { configs } = await extensionApi('/api/extension/audit-configs');
      const previous = select.value;
      const { state } = await attachedCommand('ATTACHED_AUDIT_STATUS').catch(() => ({ state: null }));
      const { selectedAuditConfig } = await chrome.storage.local.get('selectedAuditConfig');
      const tab = await activeTab().catch(() => null);
      const tabUrl = (() => { try { return new URL(tab?.url); } catch (_) { return null; } })();
      const matching = configs.filter((config) => {
        try {
          const raw = String(config.startingUrl || config.domain || '');
          const explicitProtocol = /^https?:\/\//i.test(raw);
          const url = new URL(explicitProtocol ? raw : `https://${raw}`);
          return tabUrl && (explicitProtocol
            ? url.origin === tabUrl.origin
            : url.hostname === tabUrl.hostname && (!url.port || url.port === tabUrl.port));
        } catch (_) { return false; }
      });
      select.innerHTML = '<option value="">Select an audit config</option>';
      for (const config of configs) {
        const option = document.createElement('option');
        option.value = config.id;
        option.textContent = `${config.name} (target ${config.maxPages || 15} pages)`;
        select.append(option);
      }
      const preferred = configs.find((config) => config.id === state?.configId)
        || (manualConfigSelection ? configs.find((config) => config.id === previous) : null)
        || matching.find((config) => config.id === selectedAuditConfig)
        || matching.find((config) => config.isDefault)
        || matching[0]
        || configs.find((config) => config.id === selectedAuditConfig)
        || configs.find((config) => config.isDefault)
        || configs[0];
      if (preferred) select.value = preferred.id;
      else $('attachedStatus').textContent = 'Create an audit config in Free Audit first.';
      renderAttached(state);
    } catch (err) {
      select.innerHTML = '<option value="">Configs unavailable</option>';
      $('attachedStatus').textContent = err.message;
    }
  }

  async function attachedCommand(type, extra = {}) {
    const tab = await activeTab();
    const response = await chrome.runtime.sendMessage({ type, tabId: tab.id, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Attached audit command failed');
    return response;
  }

  function renderAttached(state) {
    $('startAttached').disabled = Boolean(state) || !$('attachedConfig').value;
    $('stopAttached').disabled = !state;
    $('attachedConfig').disabled = Boolean(state);
    $('autoCrawl').disabled = Boolean(state);
    if (state) {
      const pages = state.pageCount + (state.currentPage ? 1 : 0);
      $('attachedStatus').textContent = `${state.configName}: ${pages}/${state.maxPages} target pages captured or in progress. ${state.autoCrawl ? 'Visiting discovered pages automatically; Stop & save is available.' : 'Browse in this tab, then Stop & save.'}`;
    } else if (!$('attachedStatus').textContent.includes('unavailable') && !$('attachedStatus').textContent.includes('Create an audit')) {
      $('attachedStatus').textContent = 'No attached audit in this tab.';
    }
  }

  async function refreshAttached() {
    const { state } = await attachedCommand('ATTACHED_AUDIT_STATUS');
    renderAttached(state);
    const { lastAttachedReport, lastAttachedOutcome } = await chrome.storage.local.get(['lastAttachedReport', 'lastAttachedOutcome']);
    if (lastAttachedReport) {
      $('attachedReport').href = lastAttachedReport;
      $('attachedReport').hidden = false;
    }
    if (!state && lastAttachedOutcome) {
      const reason = lastAttachedOutcome.stopReason === 'target-reached' ? 'Target reached'
        : lastAttachedOutcome.stopReason === 'site-denied-access' ? 'Site denied access'
          : lastAttachedOutcome.stopReason === 'no-more-discoverable-pages' ? 'No more reachable pages found' : 'Stopped manually';
      $('attachedStatus').textContent = `Last run: ${lastAttachedOutcome.pageCount}/${lastAttachedOutcome.maxPages} target pages. ${reason}.`;
    }
  }

  async function startAttached() {
    await saveSettings();
    const configId = $('attachedConfig').value;
    if (!configId) throw new Error('Select an audit config');
    const { baseUrl } = await getSettings();
    const autoCrawl = $('autoCrawl').checked;
    await chrome.storage.local.set({ autoCrawl });
    const { state } = await attachedCommand('ATTACHED_AUDIT_START', { baseUrl, configId, autoCrawl });
    renderAttached(state);
    $('attachedStatus').textContent = autoCrawl
      ? 'Automatic audit started. This tab will visit discovered pages until the target or a stop condition.'
      : 'Manual audit started. Browse the configured site in this tab, then Stop & save.';
  }

  async function stopAttached() {
    const result = await attachedCommand('ATTACHED_AUDIT_STOP');
    renderAttached(null);
    $('attachedStatus').textContent = `Saved ${result.finished.pageCount} page(s) to Audit History.`;
    $('attachedReport').href = result.reportUrl;
    $('attachedReport').hidden = false;
  }

  async function copyJson() {
    await navigator.clipboard.writeText(JSON.stringify(currentState.steps || [], null, 2));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(currentState.steps || [], null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'free-audit-recorded-steps.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function saveToFreeAudit(kind) {
    await sendToTab('FREE_AUDIT_GET');
    await saveSettings();
    const settings = await getSettings();
    if (!settings.pairingToken) throw new Error('Pairing token is required');
    const tab = await activeTab();
    const steps = currentState.steps || [];
    if (!steps.length) throw new Error('Record a journey before saving');
    const endpoint = kind === 'flow' ? '/api/extension/interaction-flow-template' : '/api/extension/interaction-config';
    const body = kind === 'flow'
      ? { name: settings.saveName, description: 'Saved from Free Audit Recorder', steps }
      : {
          name: settings.saveName,
          description: 'Saved from Free Audit Recorder',
          startingUrl: steps.find((step) => step.action === 'openUrl')?.value || tab.url || '',
          waitUntil: 'domcontentloaded',
          showBrowser: false,
          generalSettings: { browserEngine: 'playwright' },
          steps
        };
    const response = await fetch(`${settings.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.pairingToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Save failed');
    $('connectionStatus').textContent = kind === 'flow' ? 'Flow template saved' : 'Interaction config saved';
  }

  async function openApp() {
    const settings = await getSettings();
    await chrome.tabs.create({ url: settings.baseUrl });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const settings = await getSettings();
    $('baseUrl').value = settings.baseUrl;
    $('pairingToken').value = settings.pairingToken;
    $('saveName').value = settings.saveName;
    $('autoCrawl').checked = (await chrome.storage.local.get({ autoCrawl: true })).autoCrawl !== false;
    await checkConnection();
    await loadAuditConfigs();
    await refreshAttached().catch((err) => { $('attachedStatus').textContent = err.message; });
    await refreshState();
    $('baseUrl').addEventListener('change', () => saveSettings().then(async () => { await checkConnection(); await loadAuditConfigs(); }));
    $('pairingToken').addEventListener('change', () => chrome.storage.local.set({ pairingToken: $('pairingToken').value.trim() }));
    $('saveName').addEventListener('change', saveSettings);
    $('connectAccount').addEventListener('click', () => connectAccount().catch((err) => { $('accountName').textContent = err.message; }));
    $('disconnectAccount').addEventListener('click', () => disconnectAccount().catch((err) => { $('accountName').textContent = err.message; }));
    $('attachedConfig').addEventListener('change', () => {
      manualConfigSelection = true;
      chrome.storage.local.set({ selectedAuditConfig: $('attachedConfig').value });
      refreshAttached().catch(() => {});
    });
    $('startAttached').addEventListener('click', () => startAttached().catch((err) => { $('attachedStatus').textContent = err.message; }));
    $('stopAttached').addEventListener('click', () => stopAttached().catch((err) => { $('attachedStatus').textContent = err.message; }));
    $('startRecording').addEventListener('click', () => sendToTab('FREE_AUDIT_START').catch((err) => alert(err.message)));
    $('pauseRecording').addEventListener('click', () => sendToTab(currentState.paused ? 'FREE_AUDIT_RESUME' : 'FREE_AUDIT_PAUSE').catch((err) => alert(err.message)));
    $('stopRecording').addEventListener('click', () => sendToTab('FREE_AUDIT_STOP').catch((err) => alert(err.message)));
    $('clearRecording').addEventListener('click', () => sendToTab('FREE_AUDIT_CLEAR').catch((err) => alert(err.message)));
    $('copyJson').addEventListener('click', () => copyJson().catch((err) => alert(err.message)));
    $('exportJson').addEventListener('click', exportJson);
    $('saveFlow').addEventListener('click', () => saveToFreeAudit('flow').catch((err) => alert(err.message)));
    $('saveConfig').addEventListener('click', () => saveToFreeAudit('config').catch((err) => alert(err.message)));
    $('openApp').addEventListener('click', () => openApp().catch((err) => alert(err.message)));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.pairingToken) {
        $('pairingToken').value = changes.pairingToken.newValue || '';
        checkConnection().then(loadAuditConfigs).catch(() => {});
      }
    });
    const refreshConfigs = () => {
      if (document.visibilityState === 'visible') loadAuditConfigs().catch(() => {});
    };
    document.addEventListener('visibilitychange', refreshConfigs);
    setInterval(refreshConfigs, 5000);
  });
})();
