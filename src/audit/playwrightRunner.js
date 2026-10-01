const { chromium } = require('playwright');
const { normalizeUrl, sameOrigin, classifyAnalytics } = require('./utils');
const { runFlow } = require('./playwrightFlow');
const { normalizeRules, evaluateRulesForPage, summarizeRuleResults } = require('./rules');
const {
  sleep,
  populateConsoleText,
  parseStartingUrls,
  buildRequestPayloadPreview,
  buildResponsePreview,
  discoverSitemapUrls,
  normalizePlaywrightWaitUntil,
  resolveMaxDepth,
  resolveWorkerCount,
  dismissConsentBanner,
} = require('./runnerShared');

async function fetchTextInBrowser(context, url, timeoutMs) {
  if (!/^https?:$/i.test(new URL(url).protocol)) throw new Error('Only HTTP(S) sitemap URLs are supported');
  const page = await context.newPage();
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    const statusCode = response ? response.status() : 0;
    if (statusCode < 200 || statusCode >= 300) throw new Error(`HTTP ${statusCode}`);
    if (Number(response.headers()['content-length'] || 0) > 5_000_000) throw new Error('Response too large');
    const text = await response.text();
    if (text.length > 5_000_000) throw new Error('Response too large');
    return text;
  } finally {
    await page.close();
  }
}

async function auditDomain(options = {}, onProgress = () => {}, onLog = () => {}) {
  const {
    domain,
    maxPages = 25,
    maxDepth,
    sameOriginOnly = true,
    headless = true,
    waitUntil = 'domcontentloaded',
    navigationTimeoutMs = 60000,
    userAgent,
    flow = [],
    preAuditActions = [],
    postAuditActions = [],
    onPageActions = [],
    startingUrls = [],
    findPagesInSitemaps = false,
    includeHashLinks = false,
    autoDismissConsent = true,
    rules = [],
    workerMode = 'ram-protected',
    simultaneousWorkers = 1,
  } = options;

  const effectiveOnPageActions = Array.isArray(onPageActions) && onPageActions.length
    ? onPageActions
    : (Array.isArray(postAuditActions) ? postAuditActions : []);
  const effectiveMaxDepth = resolveMaxDepth(maxDepth, maxPages);
  const effectiveWaitUntil = normalizePlaywrightWaitUntil(waitUntil);
  const workerCount = resolveWorkerCount(simultaneousWorkers, workerMode, maxPages);

  const rawStartingList = Array.isArray(startingUrls)
    ? startingUrls
    : String(startingUrls || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  const firstAbsoluteStartingUrl = rawStartingList.find((entry) => /^https?:\/\//i.test(String(entry || '').trim()));
  if (!domain && !firstAbsoluteStartingUrl) {
    throw new Error('Either domain or at least one absolute starting URL is required');
  }

  const baseTarget = domain || firstAbsoluteStartingUrl;
  const startUrl = /^https?:\/\//i.test(baseTarget) ? baseTarget : `https://${baseTarget}`;
  const normalizedStartUrl = normalizeUrl(startUrl, startUrl);
  if (!normalizedStartUrl) throw new Error('Invalid domain or URL');

  const launchOptions = {
    headless: Boolean(headless),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  };
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  onLog({
    level: 'info',
    ts: Date.now(),
    msg: 'Launching browser',
    headless: Boolean(headless),
    browserEngine: 'playwright',
    executablePath: launchOptions.executablePath || null,
    workerCount
  });

  const browser = await chromium.launch(launchOptions);
  const contextOptions = {
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  };
  if (typeof userAgent === 'string' && userAgent.trim()) contextOptions.userAgent = userAgent.trim();
  const context = await browser.newContext(contextOptions);
  onLog({ level: 'info', ts: Date.now(), msg: 'Browser launched', browserEngine: 'playwright' });

  const visited = new Set();
  const seedUrls = new Set();
  const manualSeedUrls = parseStartingUrls(startingUrls, normalizedStartUrl);
  for (const url of manualSeedUrls) seedUrls.add(url);

  if (findPagesInSitemaps) {
    const sitemapCandidates = await discoverSitemapUrls(
      normalizedStartUrl,
      onLog,
      Math.max(300, maxPages * 20),
      (url, timeoutMs) => fetchTextInBrowser(context, url, timeoutMs)
    );
    for (const sitemapUrl of sitemapCandidates) seedUrls.add(sitemapUrl);
    onLog({ level: 'info', ts: Date.now(), msg: 'Sitemap discovery completed', discovered: sitemapCandidates.length });
  }

  const filteredSeeded = Array.from(seedUrls)
    .filter((url) => !sameOriginOnly || sameOrigin(url, normalizedStartUrl));
  const seededList = [normalizedStartUrl, ...filteredSeeded.filter((u) => u !== normalizedStartUrl)];
  const queue = seededList.map((url) => ({ url, depth: 0, source: 'seed' }));
  onLog({
    level: 'info',
    ts: Date.now(),
    msg: 'Seed URLs prepared',
    manualSeedCount: manualSeedUrls.length,
    usingSitemapDiscovery: Boolean(findPagesInSitemaps),
    totalSeedCount: queue.length
  });

  const normalizedRules = normalizeRules(rules);
  const results = {
    pages: [],
    summary: {
      total: 0,
      pageTarget: maxPages,
      targetMet: false,
      crawlStopReason: null,
      analyticsHits: 0,
      detectedRequests: 0,
      networkRequests: 0,
      pagesWithAnalytics: 0,
      pagesWithDetectedRequests: 0,
      pagesWithNetworkRequests: 0,
      errors: 0,
      consoleMessages: 0,
      consoleErrors: 0,
      ruleFailures: 0,
      rulePasses: 0,
      ruleSkipped: 0,
      configuredRules: normalizedRules.length,
      browserEngine: 'playwright',
      workerCount,
    },
    ruleSummary: {
      totals: {
        configuredRules: normalizedRules.length,
        passedEvaluations: 0,
        failedEvaluations: 0,
        skippedEvaluations: 0,
        pagesWithFailedRules: 0,
        pagesWithPassedRules: 0
      },
      rules: []
    },
    errors: []
  };

  let processed = 0;
  let claimed = 0;
  let preAuditActionsExecuted = false;
  let preAuditActionsStarted = false;

  function claimNextUrl() {
    if (claimed >= maxPages) return null;
    while (queue.length) {
      const item = queue.shift();
      if (!item || visited.has(item.url)) continue;
      visited.add(item.url);
      claimed += 1;
      return item;
    }
    return null;
  }

  async function createAuditPage(workerIndex) {
    const page = await context.newPage();
    page.setDefaultTimeout(navigationTimeoutMs);
    page.setDefaultNavigationTimeout(navigationTimeoutMs);
    onLog({ level: 'info', ts: Date.now(), msg: 'Worker page ready', worker: workerIndex, browserEngine: 'playwright' });
    return page;
  }

  const pages = [];
  try {
    for (let i = 0; i < workerCount; i += 1) {
      pages.push(await createAuditPage(i + 1));
    }
    onLog({ level: 'info', ts: Date.now(), msg: 'Worker pool ready', workers: pages.length, sharedBrowserContext: true, browserEngine: 'playwright' });

    async function processQueue(page, workerIndex) {
      while (true) {
        if (workerIndex > 1 && Array.isArray(preAuditActions) && preAuditActions.length && !preAuditActionsExecuted) {
          await sleep(150);
          continue;
        }

        const claim = claimNextUrl();
        if (!claim) break;
        const { url, depth } = claim;

        onProgress({ processed, totalVisited: visited.size, queue: queue.length, current: url });
        onLog({ level: 'info', ts: Date.now(), msg: 'Processing URL', url, depth, worker: workerIndex, browserEngine: 'playwright' });

        const analyticsEvents = [];
        const consoleEvents = [];
        const consoleSettlers = [];
        const networkRequests = [];
        const networkEntryByRequest = new Map();
        const networkSettlers = [];
        const navigationResponses = [];
        const earlyLinks = [];
        const earlyLinkCaptures = [];
        const domReadyListener = () => {
          const observedUrl = page.url();
          const capture = (async () => {
            for (const delay of [300, 900]) {
              await sleep(delay);
              if (page.url() !== observedUrl) break;
              const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean));
              for (const href of hrefs) earlyLinks.push({ href, baseUrl: observedUrl });
            }
          })().catch(() => {});
          earlyLinkCaptures.push(capture);
        };

        const requestListener = (req) => {
          const requestUrl = req.url();
          const method = req.method();
          const resourceType = req.resourceType ? req.resourceType() : '';
          const networkEntry = {
            id: networkRequests.length + 1,
            url: requestUrl,
            method,
            resourceType,
            requestHeaders: req.headers ? req.headers() : {},
            requestPayload: buildRequestPayloadPreview(req),
            responseHeaders: null,
            responsePreview: null,
            status: null,
            statusText: '',
            failed: false,
            failureText: null,
            fromCache: false,
            fromServiceWorker: false,
            startedAt: Date.now(),
            completedAt: null,
          };
          networkRequests.push(networkEntry);
          networkEntryByRequest.set(req, networkEntry);

          const match = classifyAnalytics(requestUrl, { method, resourceType });
          if (match) {
            analyticsEvents.push({
              type: 'request',
              vendor: match.vendor,
              tagName: match.tagName || match.vendor,
              id: match.id,
              category: match.category || null,
              matchType: match.matchType || null,
              confidence: match.confidence || null,
              aliases: Array.isArray(match.aliases) ? match.aliases : [],
              documentation: Array.isArray(match.documentation) ? match.documentation : [],
              endpoints: match.endpoints || {},
              url: requestUrl,
              method,
              resourceType,
              ts: Date.now(),
            });
          }
        };

        const responseListener = (response) => {
          const task = (async () => {
            try {
              const request = response.request();
              if (!request) return;

              if (request.isNavigationRequest && request.isNavigationRequest()) {
                let isMainFrame = false;
                try {
                  isMainFrame = request.frame() === page.mainFrame();
                } catch (_) {}
                if (isMainFrame) {
                  navigationResponses.push({
                    url: response.url(),
                    status: response.status(),
                  });
                }
              }

              let networkEntry = networkEntryByRequest.get(request);
              if (!networkEntry) {
                networkEntry = {
                  id: networkRequests.length + 1,
                  url: request.url(),
                  method: request.method ? request.method() : 'GET',
                  resourceType: request.resourceType ? request.resourceType() : '',
                  requestHeaders: request.headers ? request.headers() : {},
                  requestPayload: buildRequestPayloadPreview(request),
                  responseHeaders: null,
                  responsePreview: null,
                  status: null,
                  statusText: '',
                  failed: false,
                  failureText: null,
                  fromCache: false,
                  fromServiceWorker: false,
                  startedAt: Date.now(),
                  completedAt: null,
                };
                networkRequests.push(networkEntry);
                networkEntryByRequest.set(request, networkEntry);
              }

              networkEntry.status = response.status ? response.status() : null;
              networkEntry.statusText = response.statusText ? response.statusText() : '';
              networkEntry.responseHeaders = response.headers ? response.headers() : {};
              networkEntry.fromServiceWorker = response.fromServiceWorker ? response.fromServiceWorker() : false;
              networkEntry.completedAt = Date.now();
              networkEntry.responsePreview = await buildResponsePreview(response, networkEntry.resourceType);
            } catch (_) {}
          })();
          networkSettlers.push(task);
        };

        const consoleListener = (msg) => {
          try {
            const type = (msg.type && msg.type()) || 'log';
            const text = (() => {
              try { return msg.text(); } catch (_) { return ''; }
            })();
            const entry = { type, text, ts: Date.now() };
            consoleEvents.push(entry);
            consoleSettlers.push(populateConsoleText(msg, entry));
          } catch (_) {}
        };

        const pageErrorListener = (err) => {
          try { consoleEvents.push({ type: 'error', text: String(err && err.message ? err.message : err), ts: Date.now() }); } catch (_) {}
        };

        const requestFailedListener = (req) => {
          const networkEntry = networkEntryByRequest.get(req);
          const failure = (() => {
            try { return req.failure ? req.failure() : null; } catch (_) { return null; }
          })();
          if (networkEntry) {
            networkEntry.failed = true;
            networkEntry.failureText = failure?.errorText || null;
            networkEntry.completedAt = Date.now();
          }
          onLog({ level: 'warn', ts: Date.now(), msg: 'Request failed', url: req.url(), errorText: failure?.errorText || null });
        };

        page.on('request', requestListener);
        page.on('response', responseListener);
        page.on('console', consoleListener);
        page.on('pageerror', pageErrorListener);
        page.on('requestfailed', requestFailedListener);
        page.on('domcontentloaded', domReadyListener);

        let navError = null;
        let navigationResponse = null;
        try {
          if (effectiveWaitUntil === 'networkidle') {
            navigationResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeoutMs });
            try {
              await page.waitForLoadState('networkidle', { timeout: Math.min(navigationTimeoutMs, 15000) });
            } catch (idleErr) {
              onLog({
                level: 'warn',
                ts: Date.now(),
                msg: 'Network idle wait timed out; continuing after DOMContentLoaded',
                url,
                error: String(idleErr && idleErr.message ? idleErr.message : idleErr),
                browserEngine: 'playwright'
              });
            }
          } else {
            navigationResponse = await page.goto(url, { waitUntil: effectiveWaitUntil, timeout: navigationTimeoutMs });
          }
          onLog({ level: 'info', ts: Date.now(), msg: 'Navigation success', url, browserEngine: 'playwright' });
          await sleep(1200);
        } catch (err) {
          navError = err;
          onLog({ level: 'error', ts: Date.now(), msg: 'Navigation error', url, error: String(err && err.message ? err.message : err), browserEngine: 'playwright' });
        }

        let dataLayerBefore = [];
        try {
          dataLayerBefore = await page.evaluate(() => {
            const dl = (window.dataLayer && Array.isArray(window.dataLayer)) ? window.dataLayer : [];
            return dl.slice(0, 200);
          });
          onLog({ level: 'info', ts: Date.now(), msg: 'dataLayer snapshot before', count: dataLayerBefore.length });
        } catch (_) {}

        let preAuditError = null;
        if (!preAuditActionsExecuted && !preAuditActionsStarted && Array.isArray(preAuditActions) && preAuditActions.length) {
          try {
            preAuditActionsStarted = true;
            onLog({ level: 'info', ts: Date.now(), msg: 'Running pre-audit actions', steps: preAuditActions.length, url: page.url() || url, browserEngine: 'playwright' });
            const preAuditRun = await runFlow(page, preAuditActions, onLog, { failFast: false });
            if (Array.isArray(preAuditRun?.stepErrors) && preAuditRun.stepErrors.length) {
              preAuditError = new Error(`Pre-audit actions had ${preAuditRun.stepErrors.length} failed step(s)`);
              onLog({
                level: 'warn',
                ts: Date.now(),
                msg: 'Pre-audit actions completed with step errors',
                failedSteps: preAuditRun.stepErrors
              });
            }
            if (autoDismissConsent) {
              try {
                await dismissConsentBanner(page, onLog, { attempts: 4, settleMs: 800 });
              } catch (_) {}
            }
            await sleep(500);
            preAuditActionsExecuted = true;
            onLog({ level: 'info', ts: Date.now(), msg: 'Pre-audit actions complete', url: page.url() || url, browserEngine: 'playwright' });
          } catch (err) {
            preAuditActionsExecuted = true;
            preAuditError = err;
          }
        }

        if (autoDismissConsent) {
          try {
            await dismissConsentBanner(page, onLog, { attempts: 4, settleMs: 800 });
          } catch (_) {}
        }

        let onPageError = null;
        if (Array.isArray(effectiveOnPageActions) && effectiveOnPageActions.length) {
          try {
            onLog({ level: 'info', ts: Date.now(), msg: 'Running On Page actions', steps: effectiveOnPageActions.length, url: page.url() || url, browserEngine: 'playwright' });
            const onPageRun = await runFlow(page, effectiveOnPageActions, onLog, { failFast: false });
            if (Array.isArray(onPageRun?.stepErrors) && onPageRun.stepErrors.length) {
              onPageError = new Error(`On Page actions had ${onPageRun.stepErrors.length} failed step(s)`);
              onLog({
                level: 'warn',
                ts: Date.now(),
                msg: 'On Page actions completed with step errors',
                failedSteps: onPageRun.stepErrors
              });
            }
            if (autoDismissConsent) {
              try {
                await dismissConsentBanner(page, onLog, { attempts: 2, settleMs: 500 });
              } catch (_) {}
            }
            await sleep(300);
            onLog({ level: 'info', ts: Date.now(), msg: 'On Page actions complete', url: page.url() || url, browserEngine: 'playwright' });
          } catch (err) {
            onPageError = err;
          }
        }

        let flowError = null;
        if (flow && flow.length) {
          try {
            onLog({ level: 'info', ts: Date.now(), msg: 'Running flow', steps: flow.length, browserEngine: 'playwright' });
            await runFlow(page, flow, onLog);
            await sleep(1000);
            onLog({ level: 'info', ts: Date.now(), msg: 'Flow complete', browserEngine: 'playwright' });
          } catch (err) {
            flowError = err;
          }
        }

        let links = [];
        try {
          links = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')).filter(Boolean));
        } catch (_) {}
        await Promise.allSettled(earlyLinkCaptures);
        const currentUrl = page.url() || url;
        const normalizedLinks = Array.from(new Set([...earlyLinks, ...links.map((href) => ({ href, baseUrl: currentUrl }))]
          .map(({ href, baseUrl }) => normalizeUrl(href, baseUrl))
          .filter(Boolean)
          .filter((href) => includeHashLinks || !href.includes('#'))
          .filter((href) => {
            if (!sameOriginOnly) return true;
            return sameOrigin(href, normalizedStartUrl);
          })));
        onLog({ level: 'info', ts: Date.now(), msg: 'Links found', url: currentUrl, count: normalizedLinks.length });

        if (depth < effectiveMaxDepth) {
          for (const href of normalizedLinks) {
            if (!visited.has(href)) queue.push({ url: href, depth: depth + 1 });
          }
        }

        let cookies = [];
        try {
          cookies = await context.cookies(currentUrl);
        } catch (_) {}
        onLog({ level: 'info', ts: Date.now(), msg: 'Cookies captured', url: currentUrl, count: Array.isArray(cookies) ? cookies.length : 0 });

        let dataLayerAfter = [];
        try {
          dataLayerAfter = await page.evaluate(() => {
            const dl = (window.dataLayer && Array.isArray(window.dataLayer)) ? window.dataLayer : [];
            return dl.slice(0, 200);
          });
        } catch (_) {}

        try {
          await Promise.allSettled(networkSettlers);
          await Promise.allSettled(consoleSettlers);
        } catch (_) {}

        let title = '';
        try { title = await page.title(); } catch (_) {}
        const initialStatusCode = navigationResponses[0]?.status || (navigationResponse && navigationResponse.status ? navigationResponse.status() : null);
        const finalStatusCode = navigationResponses[navigationResponses.length - 1]?.status || (navigationResponse && navigationResponse.status ? navigationResponse.status() : null);
        const httpError = finalStatusCode >= 400 ? `Final document returned HTTP ${finalStatusCode}` : null;
        if (httpError) onLog({ level: 'warn', ts: Date.now(), msg: 'Page returned an HTTP error', url: currentUrl, status: finalStatusCode, browserEngine: 'playwright' });

        const pageHasAnalytics = analyticsEvents.length > 0 || (dataLayerBefore.length + dataLayerAfter.length) > 0;
        const pageHasDetectedRequests = analyticsEvents.length > 0;
        const vendorsSet = new Set(analyticsEvents.map((a) => a.vendor).filter(Boolean));
        const vendors = Array.from(vendorsSet);

        const pageResult = {
          initialUrl: url,
          finalUrl: currentUrl,
          initialStatusCode,
          finalStatusCode,
          url: currentUrl,
          title,
          depth,
          cookies,
          analytics: analyticsEvents,
          networkRequests,
          console: consoleEvents,
          vendors,
          dataLayer: {
            before: dataLayerBefore,
            after: dataLayerAfter,
          },
          error: navError ? String(navError.message || navError) : httpError,
          preAuditError: preAuditError ? String(preAuditError.message || preAuditError) : null,
          onPageError: onPageError ? String(onPageError.message || onPageError) : null,
          flowError: flowError ? String(flowError.message || flowError) : null,
          linksFound: normalizedLinks.length,
        };
        pageResult.ruleResults = evaluateRulesForPage(pageResult, normalizedRules);

        results.pages.push(pageResult);
        results.summary.total += 1;
        results.summary.analyticsHits += analyticsEvents.length;
        results.summary.detectedRequests += analyticsEvents.length;
        results.summary.networkRequests += networkRequests.length;
        results.summary.consoleMessages += consoleEvents.length;
        results.summary.consoleErrors += consoleEvents.filter((c) => (c.type || '').toLowerCase() === 'error').length;
        results.summary.pagesWithAnalytics += pageHasAnalytics ? 1 : 0;
        results.summary.pagesWithDetectedRequests += pageHasDetectedRequests ? 1 : 0;
        results.summary.pagesWithNetworkRequests += networkRequests.length ? 1 : 0;
        results.summary.rulePasses += pageResult.ruleResults.filter((rule) => rule.status === 'passed').length;
        results.summary.ruleFailures += pageResult.ruleResults.filter((rule) => rule.status === 'failed').length;
        results.summary.ruleSkipped += pageResult.ruleResults.filter((rule) => rule.status === 'skipped').length;
        if (navError || httpError || preAuditError || onPageError || flowError) results.summary.errors += 1;

        processed += 1;
        try { page.off('request', requestListener); } catch (_) {}
        try { page.off('response', responseListener); } catch (_) {}
        try { page.off('console', consoleListener); } catch (_) {}
        try { page.off('pageerror', pageErrorListener); } catch (_) {}
        try { page.off('requestfailed', requestFailedListener); } catch (_) {}
        try { page.off('domcontentloaded', domReadyListener); } catch (_) {}

        onProgress({ processed, totalVisited: visited.size, queue: queue.length, current: url });
        onLog({
          level: 'info',
          ts: Date.now(),
          msg: 'Page processed',
          url: currentUrl,
          analyticsHits: analyticsEvents.length,
          networkRequests: networkRequests.length,
          cookies: Array.isArray(cookies) ? cookies.length : 0,
          console: consoleEvents.length,
          worker: workerIndex,
          browserEngine: 'playwright'
        });
      }
    }

    await Promise.all(pages.map((workerPage, index) => processQueue(workerPage, index + 1)));
  } finally {
    for (const workerPage of pages) {
      try { await workerPage.close(); } catch (_) {}
    }
    try { await context.close(); } catch (_) {}
    await browser.close();
    onLog({ level: 'info', ts: Date.now(), msg: 'Browser closed', browserEngine: 'playwright' });
  }

  const allVendors = new Set();
  for (const p of results.pages) for (const v of (p.vendors || [])) allVendors.add(v);
  results.summary.uniqueVendors = Array.from(allVendors);
  results.summary.uniqueVendorsCount = results.summary.uniqueVendors.length;
  results.ruleSummary = summarizeRuleResults(results.pages, normalizedRules);
  results.summary.pagesWithFailedRules = results.ruleSummary.totals.pagesWithFailedRules;
  results.summary.pagesWithPassedRules = results.ruleSummary.totals.pagesWithPassedRules;
  results.summary.targetMet = results.summary.total >= maxPages;
  results.summary.crawlStopReason = results.summary.targetMet ? 'target-reached'
    : results.pages.some((page) => [403, 429].includes(Number(page.finalStatusCode))) ? 'site-denied-access'
      : effectiveMaxDepth === 0 ? 'depth-limit' : 'no-more-discoverable-pages';

  return results;
}

module.exports = { auditDomain };
