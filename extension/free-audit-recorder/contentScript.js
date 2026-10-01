(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage || window.top !== window) return;
  const recorder = window.FreeAuditRecorder;
  let pendingSave = Promise.resolve();
  recorder.setPersistence((state) => {
    pendingSave = chrome.runtime.sendMessage({ type: 'FREE_AUDIT_SAVE_STATE', state }).catch(() => {});
  });
  const ready = chrome.runtime.sendMessage({ type: 'FREE_AUDIT_LOAD_STATE' }).then(response => {
    if (response.ok) recorder.restore(response.state);
  });
  const commands = {
    FREE_AUDIT_START: 'start', FREE_AUDIT_PAUSE: 'pause', FREE_AUDIT_RESUME: 'resume',
    FREE_AUDIT_STOP: 'stop', FREE_AUDIT_CLEAR: 'clear', FREE_AUDIT_GET: 'snapshot'
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'FREE_AUDIT_CONNECT_SESSION') {
      (async () => {
        const origin = new URL(message.baseUrl).origin;
        if (origin !== location.origin) throw new Error('Not the Free Audit app tab');
        const response = await fetch(`${origin}/api/extension/tokens`, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label: 'Chrome extension (app login)' })
        });
        if (response.status === 401) return { ok: false, needsLogin: true };
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token) throw new Error(data.error || 'Failed to connect extension');
        return { ok: true, token: data.token, user: data.tokenRecord?.username || '' };
      })().then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (!commands[message?.type]) return;
    ready.then(async () => {
      const state = recorder[commands[message.type]]();
      await pendingSave;
      sendResponse({ ok: true, state });
    }).catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  });
  chrome.runtime.sendMessage({ type: 'FREE_AUDIT_DOCUMENT_READY' }).catch(() => {});
})();
