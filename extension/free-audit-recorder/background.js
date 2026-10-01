// Serialize storage access so a new document restores the previous document's final steps.
let queue = Promise.resolve();
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!['FREE_AUDIT_LOAD_STATE', 'FREE_AUDIT_SAVE_STATE'].includes(message?.type)) return;
  if (!sender.tab || sender.frameId !== 0) { respond({ ok: false }); return; }
  const key = `recorder-tab-${sender.tab.id}`;
  const operation = queue.then(async () => {
    if (message.type === 'FREE_AUDIT_SAVE_STATE') {
      await chrome.storage.session.set({ [key]: message.state });
      return { ok: true };
    }
    const data = await chrome.storage.session.get(key);
    return { ok: true, state: data[key] || { steps: [], recording: false, paused: false } };
  });
  queue = operation.catch(() => {});
  operation.then(respond, err => respond({ ok: false, error: err.message }));
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  queue = queue.then(() => chrome.storage.session.remove(`recorder-tab-${tabId}`)).catch(() => {});
});
importScripts('attachedAudit.js');
importScripts('accountConnection.js');
