// A user-initiated connection uses the app's existing login session in an app tab.
// The password stays in the app; only the resulting extension token is saved locally.
(() => {
  const pendingKey = 'pending-app-connection';
  let inFlight = null;

  function normalizeAppUrl(value) {
    const url = new URL(String(value || ''));
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      throw new Error('Use HTTPS or a localhost Free Audit URL');
    }
    return url.origin;
  }

  function isAppTab(tab, origin) {
    try { return new URL(tab.url || '').origin === origin; } catch (_) { return false; }
  }

  async function attempt(tabId) {
    const pending = (await chrome.storage.session.get(pendingKey))[pendingKey];
    if (!pending) return { connected: false };
    if (Date.now() - pending.createdAt > 15 * 60 * 1000) {
      await chrome.storage.session.remove(pendingKey);
      return { connected: false, expired: true };
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isAppTab(tab, pending.origin)) return { connected: false };
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let response;
      try {
        response = await chrome.tabs.sendMessage(tabId, {
          type: 'FREE_AUDIT_CONNECT_SESSION', baseUrl: pending.origin
        }, { frameId: 0 });
      } catch (_) { return { connected: false }; }
      if (!response?.ok || !response.token) return { connected: false };
      await chrome.storage.local.set({ baseUrl: pending.origin, pairingToken: response.token });
      await chrome.storage.session.remove(pendingKey);
      return { connected: true, user: response.user };
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'FREE_AUDIT_CONNECT_START') {
      (async () => {
        const origin = normalizeAppUrl(message.baseUrl);
        await chrome.storage.session.set({ [pendingKey]: { origin, createdAt: Date.now() } });
        const tabs = await chrome.tabs.query({});
        const existing = tabs.find((tab) => isAppTab(tab, origin));
        if (existing) {
          const result = await attempt(existing.id);
          if (result.connected) return { ok: true, ...result };
          await chrome.tabs.update(existing.id, { active: true });
          return { ok: true, connected: false, openedTab: false };
        }
        await chrome.tabs.create({ url: `${origin}/login` });
        return { ok: true, connected: false, openedTab: true };
      })().then(respond, (err) => respond({ ok: false, error: err.message }));
      return true;
    }
    if (message?.type === 'FREE_AUDIT_DOCUMENT_READY' && sender.tab?.id != null && sender.frameId === 0) {
      attempt(sender.tab.id).catch(() => {});
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'complete') attempt(tabId).catch(() => {});
  });
})();
