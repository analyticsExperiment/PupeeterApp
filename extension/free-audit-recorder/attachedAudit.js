// Per-tab audit capture with optional same-origin navigation in the attached Chrome tab.
(() => {
  const prefix = 'attached-audit-';
  const states = new Map();
  const queues = new Map();
  const stopRequested = new Set();
  const ready = chrome.storage.session.get(null).then((items) => {
    for (const [key, value] of Object.entries(items)) {
      if (key.startsWith(prefix) && value?.id) states.set(Number(key.slice(prefix.length)), value);
    }
  });

  function enqueue(tabId, operation) {
    const previous = queues.get(tabId) || Promise.resolve();
    const next = previous.catch(() => {}).then(ready).then(operation);
    queues.set(tabId, next);
    next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); }).catch(() => {});
    return next;
  }

  async function persist(tabId, state) {
    states.set(tabId, state);
    await chrome.storage.session.set({ [`${prefix}${tabId}`]: state });
  }

  async function clear(tabId) {
    states.delete(tabId);
    await chrome.storage.session.remove(`${prefix}${tabId}`);
  }

  function sameOrigin(url, startUrl) {
    try { return new URL(url).origin === new URL(startUrl).origin; } catch (_) { return false; }
  }

  function candidateUrl(raw, base, startUrl) {
    try {
      const url = new URL(raw, base);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(startUrl).origin) return null;
      if (url.username || url.password || /\/(?:logout|signout|cart|checkout)(?:\/|$)/i.test(url.pathname)) return null;
      if (/\.(?:pdf|xml|json|zip|png|jpe?g|gif|svg|webp)(?:$)/i.test(url.pathname)) return null;
      url.hash = '';
      return url.href;
    } catch (_) { return null; }
  }

  function addCandidate(state, raw, base = state.startUrl) {
    const url = candidateUrl(raw, base, state.startUrl);
    if (!url) return;
    state.candidates ||= [];
    state.visited ||= [];
    if (state.visited.includes(url) || state.candidates.includes(url)) return;
    if (state.candidates.length + state.visited.length >= Math.min(1000, Math.max(100, state.maxPages * 30))) return;
    state.candidates.push(url);
    state.discoveredCandidateCount = (state.discoveredCandidateCount || 0) + 1;
  }

  function decodeXml(value) {
    return String(value || '').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity) => {
      const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
      const lower = entity.toLowerCase();
      if (named[lower]) return named[lower];
      const numeric = lower.startsWith('&#x') ? parseInt(lower.slice(3, -1), 16) : parseInt(lower.slice(2, -1), 10);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : entity;
    });
  }

  async function fetchDiscoveryText(url, startUrl) {
    if (!sameOrigin(url, startUrl)) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(url, { credentials: 'include', signal: controller.signal });
      if (!response.ok || !sameOrigin(response.url, startUrl)) return '';
      if (Number(response.headers.get('content-length') || 0) > 1_000_000) return '';
      return (await response.text()).slice(0, 1_000_000);
    } catch (_) { return ''; } finally { clearTimeout(timer); }
  }

  async function discoverSitemaps(state) {
    if (!state.includeSitemaps || state.sitemapDiscoveryDone) return;
    state.sitemapDiscoveryDone = true;
    const root = new URL(state.startUrl).origin;
    const robots = await fetchDiscoveryText(`${root}/robots.txt`, state.startUrl);
    const sitemapQueue = [`${root}/sitemap.xml`];
    for (const line of robots.split(/\r?\n/)) {
      const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
      if (match && sameOrigin(match[1], state.startUrl)) sitemapQueue.push(match[1]);
    }
    const seen = new Set();
    while (sitemapQueue.length && seen.size < 8 && (state.candidates?.length || 0) < Math.max(50, state.maxPages * 20)) {
      const sitemapUrl = sitemapQueue.shift();
      if (!sitemapUrl || seen.has(sitemapUrl)) continue;
      seen.add(sitemapUrl);
      const xml = await fetchDiscoveryText(sitemapUrl, state.startUrl);
      const locs = [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)].map((match) => decodeXml(match[1].trim()));
      if (/<sitemapindex\b/i.test(xml)) {
        for (const loc of locs) if (sameOrigin(loc, state.startUrl)) sitemapQueue.push(loc);
      } else {
        for (const loc of locs) addCandidate(state, loc, sitemapUrl);
      }
    }
    await persist(state.tabId, state);
  }

  function watchdogName(tabId) { return `attached-audit-watchdog-${tabId}`; }
  async function scheduleWatchdog(tabId) {
    await chrome.alarms.create(watchdogName(tabId), { when: Date.now() + 30000 });
  }
  async function clearWatchdog(tabId) {
    await chrome.alarms.clear(watchdogName(tabId));
  }

  function auditResourceType(type) {
    if (type === 'main_frame' || type === 'sub_frame') return 'document';
    if (type === 'xmlhttprequest') return 'xhr';
    return type || '';
  }

  async function api(state, route, method = 'GET', body) {
    const { pairingToken } = await chrome.storage.local.get('pairingToken');
    if (!pairingToken) throw new Error('Pairing token is required');
    const response = await fetch(`${state.baseUrl}${route}`, {
      method,
      headers: { Authorization: `Bearer ${pairingToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Free Audit returned HTTP ${response.status}`);
    return data;
  }

  async function snapshot(tabId, state) {
    const page = state.currentPage;
    if (!page) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || new URL(tab.url).href.split('#')[0] !== new URL(page.url).href.split('#')[0]) return;
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN',
        func: () => {
          const entries = Array.isArray(window.dataLayer) ? window.dataLayer.slice(-30) : [];
          return {
            title: document.title,
            linksFound: document.querySelectorAll('a[href]').length,
            candidateLinks: Array.from(document.querySelectorAll('a[href]')).slice(0, 500).map((link) => link.href),
            userAgent: navigator.userAgent,
            dataLayer: entries.map((entry) => {
              try {
                const json = JSON.stringify(entry);
                return json && json.length <= 2000 ? JSON.parse(json) : { truncated: true };
              } catch (_) { return { unreadable: true }; }
            })
          };
        }
      });
      if (result) {
        const { candidateLinks = [], ...capture } = result;
        Object.assign(page, capture);
        if (state.autoCrawl) for (const url of candidateLinks) addCandidate(state, url, page.url);
      }
    } catch (_) { /* Restricted pages cannot be inspected. Network evidence is retained. */ }
    try {
      page.cookies = (await chrome.cookies.getAll({ url: page.url })).slice(0, 100).map((cookie) => ({
        name: cookie.name.slice(0, 300), value: cookie.value.slice(0, 1000),
        domain: cookie.domain, path: cookie.path,
        secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite
      }));
    } catch (_) { page.cookies = []; }
    await persist(tabId, state);
  }

  async function flush(tabId, state) {
    if (!state.currentPage) return;
    if (!state.currentPage.snapshotAt) await snapshot(tabId, state);
    const page = state.currentPage;
    if (page.droppedRequests) page.captureNotes = `${page.droppedRequests} requests omitted after the 300-request per-page cap`;
    const response = await api(state, `/api/extension/attached-audits/${encodeURIComponent(state.id)}/pages`, 'POST', page);
    state.pageCount = response.pageCount;
    state.currentPage = null;
    await persist(tabId, state);
  }

  async function start(tabId, baseUrl, configId, autoCrawl = false) {
    if (states.has(tabId)) throw new Error('This tab already has a running attached audit');
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('Enter a valid Free Audit app URL');
    const draft = { baseUrl: baseUrl.replace(/\/$/, '') };
    const run = await api(draft, '/api/extension/attached-audits', 'POST', { configId, autoCrawl });
    const state = {
      id: run.id, tabId, baseUrl: draft.baseUrl, startUrl: run.startUrl, configId,
      configName: run.configName, maxPages: run.maxPages, pageCount: 0, currentPage: null,
      autoCrawl: run.autoCrawl === true, includeSitemaps: run.includeSitemaps !== false,
      sitemapDiscoveryDone: false, candidates: [], visited: [], discoveredCandidateCount: 0
    };
    state.visited.push(candidateUrl(state.startUrl, state.startUrl, state.startUrl));
    for (const url of run.startingUrls || []) addCandidate(state, url);
    await persist(tabId, state);
    const tab = await chrome.tabs.get(tabId);
    if (sameOrigin(tab.url, state.startUrl)) await chrome.tabs.reload(tabId);
    else await chrome.tabs.update(tabId, { url: state.startUrl });
    return { ok: true, state: { ...state, currentPage: undefined } };
  }

  async function finish(tabId, stopReason = 'manual-stop') {
    const state = states.get(tabId);
    if (!state) throw new Error('No attached audit is running in this tab');
    await clearWatchdog(tabId);
    if (state.currentPage) await snapshot(tabId, state);
    await flush(tabId, state);
    const finished = await api(state, `/api/extension/attached-audits/${encodeURIComponent(state.id)}/finish`, 'POST', {
      stopReason, discoveredCandidateCount: state.discoveredCandidateCount || 0
    });
    await chrome.storage.local.set({
      lastAttachedReport: `${state.baseUrl}${finished.reportUrl}`,
      lastAttachedOutcome: { pageCount: finished.pageCount, maxPages: state.maxPages, stopReason }
    });
    await clear(tabId);
    stopRequested.delete(tabId);
    return { ok: true, finished, reportUrl: `${state.baseUrl}${finished.reportUrl}` };
  }

  async function advance(tabId, state) {
    if (!state.autoCrawl || !state.currentPage || stopRequested.has(tabId)) return;
    const completedUrl = state.currentPage.url;
    if ([403, 429].includes(state.currentPage.statusCode)
      || /access denied|too many requests/i.test(state.currentPage.title || '')) {
      await finish(tabId, 'site-denied-access');
      return;
    }
    // Many sites populate navigation after the load event. Give late same-origin links
    // a short, bounded opportunity to appear before declaring the crawl exhausted.
    if (!(state.candidates || []).some((url) => !(state.visited || []).includes(url))) {
      for (const delayMs of [700, 1500]) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (stopRequested.has(tabId)) return;
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab || candidateUrl(tab.url, tab.url, state.startUrl)
          !== candidateUrl(completedUrl, completedUrl, state.startUrl)) return;
        await snapshot(tabId, state);
        if ((state.candidates || []).some((url) => !(state.visited || []).includes(url))) break;
      }
    }
    await flush(tabId, state);
    if (state.pageCount >= state.maxPages) {
      await finish(tabId, 'target-reached');
      return;
    }
    if (stopRequested.has(tabId)) return;
    await discoverSitemaps(state);
    if (stopRequested.has(tabId)) return;
    const next = (state.candidates || []).find((url) => !(state.visited || []).includes(url));
    if (!next) {
      await finish(tabId, 'no-more-discoverable-pages');
      return;
    }
    state.candidates = state.candidates.filter((url) => url !== next);
    state.visited.push(next);
    await persist(tabId, state);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    if (stopRequested.has(tabId) || states.get(tabId) !== state) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !sameOrigin(tab.url || '', state.startUrl)) {
      await finish(tabId, 'manual-stop');
      return;
    }
    if (candidateUrl(tab.url, tab.url, state.startUrl) !== candidateUrl(completedUrl, completedUrl, state.startUrl)) return;
    await chrome.tabs.update(tabId, { url: next });
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!['ATTACHED_AUDIT_START', 'ATTACHED_AUDIT_STOP', 'ATTACHED_AUDIT_STATUS'].includes(message?.type)) return;
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) { respond({ ok: false, error: 'Select a normal web tab' }); return; }
    if (message.type === 'ATTACHED_AUDIT_STOP') stopRequested.add(tabId);
    const operation = message.type === 'ATTACHED_AUDIT_STATUS'
      ? ready.then(() => ({ ok: true, state: states.get(tabId) || null }))
      : enqueue(tabId, () => message.type === 'ATTACHED_AUDIT_START'
        ? start(tabId, message.baseUrl, message.configId, message.autoCrawl)
        : finish(tabId, 'manual-stop'));
    operation.then(respond, (err) => respond({ ok: false, error: err.message }));
    return true;
  });

  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (details.tabId < 0) return;
    enqueue(details.tabId, async () => {
      const state = states.get(details.tabId);
      if (!state) return;
      if (details.type === 'main_frame') {
        await flush(details.tabId, state);
        if (state.pageCount >= state.maxPages || !sameOrigin(details.url, state.startUrl)) {
          if (state.autoCrawl) await finish(details.tabId, state.pageCount >= state.maxPages ? 'target-reached' : 'manual-stop');
          return;
        }
        state.currentPage = {
          pageId: crypto.randomUUID(), url: details.url, statusCode: null,
          title: '', linksFound: 0, dataLayer: [], cookies: [], networkRequests: [],
          startedAt: Date.now()
        };
        state.visited ||= [];
        const visitedUrl = candidateUrl(details.url, details.url, state.startUrl);
        if (visitedUrl && !state.visited.includes(visitedUrl)) state.visited.push(visitedUrl);
        if (state.autoCrawl) await scheduleWatchdog(details.tabId);
      }
      const page = state.currentPage;
      if (!page) return;
      if (page.networkRequests.length >= 300) { page.droppedRequests = (page.droppedRequests || 0) + 1; return; }
      page.networkRequests.push({
        requestId: details.requestId, url: details.url.slice(0, 1500), method: details.method,
        resourceType: auditResourceType(details.type), status: null, startedAt: Date.now()
      });
      await persist(details.tabId, state);
    }).catch(() => {});
  }, { urls: ['<all_urls>'] });

  chrome.webRequest.onCompleted.addListener((details) => {
    if (details.tabId < 0) return;
    enqueue(details.tabId, async () => {
      const state = states.get(details.tabId);
      const page = state?.currentPage;
      if (!page) return;
      const entry = page.networkRequests.find((item) => item.requestId === details.requestId);
      if (entry) {
        entry.status = details.statusCode;
        entry.completedAt = Date.now();
      }
      if (details.type === 'main_frame') {
        page.statusCode = details.statusCode;
        if (sameOrigin(details.url, state.startUrl)) page.url = details.url;
      }
      await persist(details.tabId, state);
    }).catch(() => {});
  }, { urls: ['<all_urls>'] });

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    if (details.tabId < 0) return;
    enqueue(details.tabId, async () => {
      const state = states.get(details.tabId);
      const page = state?.currentPage;
      if (!page) return;
      const entry = page.networkRequests.find((item) => item.requestId === details.requestId);
      if (entry) { entry.failed = true; entry.failureText = details.error; entry.completedAt = Date.now(); }
      await persist(details.tabId, state);
    }).catch(() => {});
  }, { urls: ['<all_urls>'] });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== 'complete') return;
    enqueue(tabId, async () => {
      const state = states.get(tabId);
      if (!state?.currentPage || state.currentPage.snapshotAt) return;
      await clearWatchdog(tabId);
      await snapshot(tabId, state);
      state.currentPage.snapshotAt = Date.now();
      await persist(tabId, state);
      await advance(tabId, state);
    }).catch(() => {});
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    const match = alarm.name.match(/^attached-audit-watchdog-(\d+)$/);
    if (!match) return;
    const tabId = Number(match[1]);
    enqueue(tabId, async () => {
      const state = states.get(tabId);
      if (!state?.autoCrawl || !state.currentPage || state.currentPage.snapshotAt) return;
      await snapshot(tabId, state);
      state.currentPage.snapshotAt = Date.now();
      await persist(tabId, state);
      await advance(tabId, state);
    }).catch(() => {});
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    enqueue(tabId, async () => {
      if (states.has(tabId)) await finish(tabId, 'manual-stop');
    }).catch(() => {});
  });
})();
