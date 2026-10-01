const puppeteer = require('puppeteer');
const http = require('http');
const https = require('https');
const { normalizeUrl, sameOrigin, classifyAnalytics } = require('./utils');
const { runFlow } = require('./flow');
const { normalizeRules, evaluateRulesForPage, summarizeRuleResults } = require('./rules');
const { populateConsoleText } = require('./runnerShared');

function parseStartingUrls(startingUrls, baseUrl) {
  if (!startingUrls) return [];
  const list = Array.isArray(startingUrls)
    ? startingUrls
    : String(startingUrls)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  return list
    .map((entry) => normalizeUrl(entry, baseUrl))
    .filter(Boolean);
}

function decodeXmlEntities(input) {
  return String(input || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function truncateText(value, maxLength = 12000) {
  const text = String(value == null ? '' : value);
  if (text.length <= maxLength) {
    return { text, truncated: false, originalLength: text.length };
  }
  return {
    text: `${text.slice(0, maxLength)}\n\n...[truncated ${text.length - maxLength} chars]`,
    truncated: true,
    originalLength: text.length,
  };
}

function formatBodyPreview(raw, maxLength = 12000) {
  const source = String(raw == null ? '' : raw);
  let formatted = source;
  let format = 'text';
  try {
    const parsed = JSON.parse(source);
    formatted = JSON.stringify(parsed, null, 2);
    format = 'json';
  } catch (_) {}
  const truncated = truncateText(formatted, maxLength);
  return {
    text: truncated.text,
    truncated: truncated.truncated,
    originalLength: truncated.originalLength,
    format,
  };
}

function buildRequestPayloadPreview(request) {
  try {
    const raw = request.postData ? request.postData() : null;
    if (!raw) return null;
    return formatBodyPreview(raw, 8000);
  } catch (_) {
    return null;
  }
}

function isPreviewableResponse(contentType, resourceType) {
  const normalizedType = String(contentType || '').toLowerCase();
  const normalizedResource = String(resourceType || '').toLowerCase();
  if (normalizedType.includes('json') || normalizedType.includes('text') || normalizedType.includes('javascript') || normalizedType.includes('xml') || normalizedType.includes('html')) {
    return true;
  }
  return normalizedResource === 'xhr' || normalizedResource === 'fetch' || normalizedResource === 'document';
}

async function buildResponsePreview(response, resourceType) {
  const headers = response.headers ? response.headers() : {};
  const contentType = String(headers['content-type'] || '');
  const declaredLength = Number(headers['content-length'] || 0);

  if (!isPreviewableResponse(contentType, resourceType)) {
    return {
      omitted: true,
      reason: 'Preview omitted for this resource type',
      contentType,
      declaredLength: Number.isFinite(declaredLength) ? declaredLength : null,
    };
  }

  if (Number.isFinite(declaredLength) && declaredLength > 100000) {
    return {
      omitted: true,
      reason: 'Preview omitted because the response is large',
      contentType,
      declaredLength,
    };
  }

  try {
    const raw = await response.text();
    return {
      ...formatBodyPreview(raw, 12000),
      contentType,
      declaredLength: Number.isFinite(declaredLength) ? declaredLength : null,
    };
  } catch (err) {
    return {
      omitted: true,
      reason: String(err && err.message ? err.message : err),
      contentType,
      declaredLength: Number.isFinite(declaredLength) ? declaredLength : null,
    };
  }
}

function extractLocTags(xmlText) {
  const out = [];
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  let match = re.exec(xmlText);
  while (match) {
    const value = decodeXmlEntities(String(match[1] || '').trim());
    if (value) out.push(value);
    match = re.exec(xmlText);
  }
  return out;
}

async function fetchText(url, timeoutMs = 12000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'FreeAudit/1.0',
        'Accept': 'text/plain,text/xml,application/xml,*/*'
      }
    }, async (res) => {
      const statusCode = res.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && res.headers.location && redirectCount < 5) {
        const nextUrl = normalizeUrl(res.headers.location, url);
        res.resume();
        if (!nextUrl) {
          reject(new Error('Invalid redirect location'));
          return;
        }
        try {
          const redirectedText = await fetchText(nextUrl, timeoutMs, redirectCount + 1);
          resolve(redirectedText);
        } catch (err) {
          reject(err);
        }
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 5_000_000) {
          req.destroy(new Error('Response too large'));
        }
      });
      res.on('end', () => resolve(data));
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    req.end();
  });
}

async function discoverSitemapUrls(startUrl, onLog = () => {}, maxUrlCount = 2000, fetchSitemapText = fetchText) {
  const discoveredPages = new Set();
  const seenSitemaps = new Set();
  const sitemapQueue = [];
  const maxSitemapFiles = 30;

  const start = new URL(startUrl);
  const fallbackSitemap = new URL('/sitemap.xml', start).toString();
  sitemapQueue.push(fallbackSitemap);

  const robotsUrl = new URL('/robots.txt', start).toString();
  try {
    const robotsText = await fetchSitemapText(robotsUrl, 8000);
    const lines = robotsText.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*sitemap\s*:\s*(.+)\s*$/i);
      if (!match) continue;
      const sitemapUrl = normalizeUrl(match[1], startUrl);
      if (sitemapUrl) sitemapQueue.push(sitemapUrl);
    }
  } catch (err) {
    onLog({ level: 'warn', ts: Date.now(), msg: 'Unable to read robots.txt for sitemap discovery', error: String(err.message || err) });
  }

  while (sitemapQueue.length && seenSitemaps.size < maxSitemapFiles && discoveredPages.size < maxUrlCount) {
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    try {
      const xmlText = await fetchSitemapText(sitemapUrl, 12000);
      const locs = extractLocTags(xmlText);
      if (!locs.length) continue;

      const isSitemapIndex = /<sitemapindex\b/i.test(xmlText);
      if (isSitemapIndex) {
        for (const loc of locs) {
          if (sitemapQueue.length >= maxSitemapFiles * 10) break;
          const nested = normalizeUrl(loc, sitemapUrl);
          if (nested && !seenSitemaps.has(nested)) sitemapQueue.push(nested);
        }
        continue;
      }

      for (const loc of locs) {
        if (discoveredPages.size >= maxUrlCount) break;
        const pageUrl = normalizeUrl(loc, sitemapUrl);
        if (pageUrl) discoveredPages.add(pageUrl);
      }
    } catch (err) {
      onLog({ level: 'warn', ts: Date.now(), msg: 'Unable to parse sitemap file', sitemapUrl, error: String(err.message || err) });
    }
  }

  return Array.from(discoveredPages);
}

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

const CONSENT_FRAME_URL_HINTS = ['privacy-mgmt.com', 'consent', 'onetrust', 'cookie', 'cmp'];
const CONSENT_FRAME_SELECTORS = [
  '[title="SP Consent Message"]',
  'iframe[src*="privacy-mgmt.com"]',
  'iframe[name*="sp_message"]',
  'iframe[id*="sp_message"]',
  'iframe[title*="consent" i]'
];
const CONSENT_ACCEPT_SELECTORS = [
  '[title="Accept all"]',
  '[aria-label="Accept all"]',
  '[aria-label="Accept cookies"]',
  'button[title*="Accept" i]',
  'button[aria-label*="Accept" i]',
  'button[class*="sp_choice_type_11"]'
];
const CONSENT_ACCEPT_TEXT_HINTS = [
  'accept all',
  'accept cookies',
  'allow all',
  'agree all',
  'i agree',
  'yes, i agree'
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
}

function normalizeWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle0' || normalized === 'networkidle') return 'networkidle2';
  if (normalized === 'load' || normalized === 'domcontentloaded' || normalized === 'networkidle2') return normalized;
  return 'domcontentloaded';
}

function resolveMaxDepth(rawMaxDepth, maxPages) {
  if (rawMaxDepth !== null && rawMaxDepth !== undefined && String(rawMaxDepth).trim() !== '') {
    const numericDepth = Number(rawMaxDepth);
    if (Number.isFinite(numericDepth) && numericDepth >= 0) return Math.floor(numericDepth);
  }

  const numericPages = Number(maxPages);
  if (Number.isFinite(numericPages) && numericPages > 0) {
    return Math.max(1, Math.floor(numericPages));
  }

  return Number.MAX_SAFE_INTEGER;
}

function resolveWorkerCount(rawWorkers, rawMode, maxPages) {
  const mode = String(rawMode || '').trim().toLowerCase();
  const raw = mode === 'ram-protected' ? 2 : rawWorkers;
  const numeric = Number(raw);
  const bounded = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
  const pageLimit = Number.isFinite(Number(maxPages)) && Number(maxPages) > 0 ? Math.floor(Number(maxPages)) : bounded;
  return Math.max(1, Math.min(bounded, pageLimit, 20));
}

async function resolveConsentFrames(page) {
  const frames = [];
  const seen = new Set();
  const mainFrame = page.mainFrame ? page.mainFrame() : null;

  for (const frame of page.frames()) {
    if (mainFrame && frame === mainFrame) continue;
    const key = `${frame.name() || ''}|${frame.url() || ''}`;
    const frameUrl = String(frame.url() || '').toLowerCase();
    const frameName = String(frame.name() || '').toLowerCase();
    const hinted = CONSENT_FRAME_URL_HINTS.some((hint) => frameUrl.includes(hint) || frameName.includes(hint));
    if (hinted && !seen.has(key)) {
      frames.push(frame);
      seen.add(key);
    }
  }

  for (const selector of CONSENT_FRAME_SELECTORS) {
    let handles = [];
    try {
      handles = await page.$$(selector);
    } catch (_) {
      continue;
    }
    for (const handle of handles) {
      try {
        const frame = await handle.contentFrame();
        const key = frame ? `${frame.name() || ''}|${frame.url() || ''}` : '';
        if (frame && !seen.has(key)) {
          frames.push(frame);
          seen.add(key);
        }
      } catch (_) {
      } finally {
        try { await handle.dispose(); } catch (_) {}
      }
    }
  }

  return frames;
}

async function clickConsentInContext(context) {
  try {
    return await context.evaluate(({ selectors, textHints }) => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      };

      for (const selector of selectors) {
        const nodes = Array.from(document.querySelectorAll(selector));
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          node.click();
          return {
            clicked: true,
            strategy: 'selector',
            selector,
            text: String(node.textContent || '').trim().slice(0, 120)
          };
        }
      }

      const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]'));
      for (const node of candidates) {
        if (!isVisible(node)) continue;
        const label = [
          node.getAttribute('title') || '',
          node.getAttribute('aria-label') || '',
          node.value || '',
          node.textContent || ''
        ].join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
        const match = textHints.find((hint) => label.includes(hint));
        if (match) {
          node.click();
          return {
            clicked: true,
            strategy: 'text',
            selector: null,
            text: String(node.textContent || node.value || '').trim().slice(0, 120)
          };
        }
      }

      return { clicked: false };
    }, { selectors: CONSENT_ACCEPT_SELECTORS, textHints: CONSENT_ACCEPT_TEXT_HINTS });
  } catch (_) {
    return { clicked: false };
  }
}

async function dismissConsentBanner(page, onLog = () => {}, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 3);
  const settleMs = Math.max(200, Number(options.settleMs) || 700);
  let clicked = false;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let frames = [];
    try {
      frames = await resolveConsentFrames(page);
    } catch (_) {}

    let clickedThisAttempt = false;
    for (const frame of frames) {
      const result = await clickConsentInContext(frame);
      if (result && result.clicked) {
        clicked = true;
        clickedThisAttempt = true;
        onLog({
          level: 'info',
          ts: Date.now(),
          msg: 'Consent banner interaction executed in iframe',
          attempt,
          strategy: result.strategy,
          selector: result.selector || null,
          text: result.text || null,
          frameName: frame.name() || '',
          frameUrl: frame.url() || ''
        });
        break;
      }
    }

    if (!clickedThisAttempt) {
      const mainResult = await clickConsentInContext(page);
      if (mainResult && mainResult.clicked) {
        clicked = true;
        clickedThisAttempt = true;
        onLog({
          level: 'info',
          ts: Date.now(),
          msg: 'Consent banner interaction executed in main frame',
          attempt,
          strategy: mainResult.strategy,
          selector: mainResult.selector || null,
          text: mainResult.text || null
        });
      }
    }

    if (!clickedThisAttempt) {
      if (attempt < attempts) {
        await sleep(settleMs);
        continue;
      }
      onLog({ level: 'info', ts: Date.now(), msg: 'No consent banner action target found on page' });
      break;
    }

    await sleep(settleMs);
    const remainingFrames = await resolveConsentFrames(page);
    if (!remainingFrames.length) break;
  }

  return clicked;
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
    browserEngine = 'puppeteer',
    workerMode = 'ram-protected',
    simultaneousWorkers = 1,
  } = options;

  const effectiveBrowserEngine = 'puppeteer';

  const effectiveOnPageActions = Array.isArray(onPageActions) && onPageActions.length
    ? onPageActions
    : (Array.isArray(postAuditActions) ? postAuditActions : []);
  const effectiveMaxDepth = resolveMaxDepth(maxDepth, maxPages);
  const effectiveWaitUntil = normalizeWaitUntil(waitUntil);
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

  onLog({ level: 'info', ts: Date.now(), msg: 'Launching browser', headless, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, browserEngine: effectiveBrowserEngine, workerCount });
  const launchOpts = {
    headless: headless ? 'new' : false,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOpts);
  // Create a fresh browser context (v24+: createBrowserContext; older: createIncognitoBrowserContext)
  const context = browser.createBrowserContext
    ? await browser.createBrowserContext()
    : await browser.createIncognitoBrowserContext();
  onLog({ level: 'info', ts: Date.now(), msg: 'Browser launched' });

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

  // Always begin from the primary start URL so pre-audit actions run on expected landing page.
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
      browserEngine: effectiveBrowserEngine,
      workerCount,
    },
    ruleSummary: { totals: { configuredRules: normalizedRules.length, passedEvaluations: 0, failedEvaluations: 0, skippedEvaluations: 0, pagesWithFailedRules: 0, pagesWithPassedRules: 0 }, rules: [] },
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
    if (typeof userAgent === 'string' && userAgent.trim()) {
      await page.setUserAgent(userAgent.trim());
    }
    try { await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' }); } catch (_) {}
    await page.setViewport({ width: 1366, height: 768 });
    await page.setRequestInterception(false);

    onLog({ level: 'info', ts: Date.now(), msg: 'Worker page ready', worker: workerIndex });
    return page;
  }

  const pages = [];
  try {
    for (let i = 0; i < workerCount; i += 1) {
      pages.push(await createAuditPage(i + 1));
    }
    onLog({ level: 'info', ts: Date.now(), msg: 'Worker pool ready', workers: pages.length, sharedBrowserContext: true });

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
        onLog({ level: 'info', ts: Date.now(), msg: 'Processing URL', url, depth, worker: workerIndex });

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
        const u = req.url();
        const method = req.method();
        const resourceType = req.resourceType && req.resourceType();
        const networkEntry = {
          id: networkRequests.length + 1,
          url: u,
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
        const match = classifyAnalytics(u, { method, resourceType });
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
            url: u,
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

            if (request.isNavigationRequest && request.isNavigationRequest() && response.frame() === page.mainFrame()) {
              navigationResponses.push({
                url: response.url(),
                status: response.status(),
              });
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
            networkEntry.fromCache = response.fromCache ? response.fromCache() : false;
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
        if (networkEntry) {
          networkEntry.failed = true;
          networkEntry.failureText = req.failure()?.errorText || null;
          networkEntry.completedAt = Date.now();
        }
        onLog({ level: 'warn', ts: Date.now(), msg: 'Request failed', url: req.url(), errorText: req.failure()?.errorText || null });
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
        navigationResponse = await page.goto(url, { waitUntil: effectiveWaitUntil, timeout: navigationTimeoutMs });
        onLog({ level: 'info', ts: Date.now(), msg: 'Navigation success', url });
        // Give the page a moment to emit console messages and fire tags
        try { await sleep(1200); } catch (_) {}
      } catch (err) {
        navError = err;
        onLog({ level: 'error', ts: Date.now(), msg: 'Navigation error', url, error: String(err && err.message ? err.message : err) });
      }

      // Collect initial dataLayer snapshot (if available)
      let dataLayerBefore = [];
      try {
        dataLayerBefore = await page.evaluate(() => {
          const dl = (window.dataLayer && Array.isArray(window.dataLayer)) ? window.dataLayer : [];
          return dl.slice(0, 200);
        });
        onLog({ level: 'info', ts: Date.now(), msg: 'dataLayer snapshot before', count: dataLayerBefore.length });
      } catch (_) {}

      // Run pre-audit actions once (on first loaded page only)
      let preAuditError = null;
      if (!preAuditActionsExecuted && !preAuditActionsStarted && Array.isArray(preAuditActions) && preAuditActions.length) {
        try {
          preAuditActionsStarted = true;
          onLog({ level: 'info', ts: Date.now(), msg: 'Running pre-audit actions', steps: preAuditActions.length, url: page.url() || url });
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
          try { await sleep(500); } catch (_) {}
          preAuditActionsExecuted = true;
          onLog({ level: 'info', ts: Date.now(), msg: 'Pre-audit actions complete', url: page.url() || url });
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

      // Run on-page actions on every page
      let onPageError = null;
      if (Array.isArray(effectiveOnPageActions) && effectiveOnPageActions.length) {
        try {
          onLog({ level: 'info', ts: Date.now(), msg: 'Running On Page actions', steps: effectiveOnPageActions.length, url: page.url() || url });
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
          try { await sleep(300); } catch (_) {}
          onLog({ level: 'info', ts: Date.now(), msg: 'On Page actions complete', url: page.url() || url });
        } catch (err) {
          onPageError = err;
        }
      }

      // Run user flow (optional)
      let flowError = null;
      if (flow && flow.length) {
        try {
          onLog({ level: 'info', ts: Date.now(), msg: 'Running flow', steps: flow.length });
          await runFlow(page, flow, onLog);
          // Small wait to allow any tags to fire
          await sleep(1000);
          onLog({ level: 'info', ts: Date.now(), msg: 'Flow complete' });
        } catch (err) {
          flowError = err;
        }
      }

      // Collect links for crawl
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

      // Add to queue respecting depth
      if (depth < effectiveMaxDepth) {
        for (const href of normalizedLinks) {
          if (!visited.has(href)) queue.push({ url: href, depth: depth + 1 });
        }
      }

      // Collect cookies
      let cookies = [];
      try {
        // Prefer context cookies for modern Puppeteer versions
        cookies = await context.cookies(currentUrl);
      } catch (e) {
        try { cookies = await page.cookies(); } catch (_) {}
      }
      onLog({ level: 'info', ts: Date.now(), msg: 'Cookies captured', url: currentUrl, count: Array.isArray(cookies) ? cookies.length : 0 });

      // Collect dataLayer after
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

      // Page title
      let title = '';
      try { title = await page.title(); } catch (_) {}
      const initialStatusCode = navigationResponses[0]?.status || (navigationResponse && navigationResponse.status ? navigationResponse.status() : null);
      const finalStatusCode = navigationResponses[navigationResponses.length - 1]?.status || (navigationResponse && navigationResponse.status ? navigationResponse.status() : null);
      const httpError = finalStatusCode >= 400 ? `Final document returned HTTP ${finalStatusCode}` : null;
      if (httpError) onLog({ level: 'warn', ts: Date.now(), msg: 'Page returned an HTTP error', url: currentUrl, status: finalStatusCode });

      // Mark analytics presence
      const pageHasAnalytics = analyticsEvents.length > 0 || (dataLayerBefore.length + dataLayerAfter.length) > 0;
      const pageHasDetectedRequests = analyticsEvents.length > 0;

      // Vendors summary
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
      onLog({ level: 'info', ts: Date.now(), msg: 'Page processed', url: currentUrl, analyticsHits: analyticsEvents.length, networkRequests: networkRequests.length, cookies: Array.isArray(cookies) ? cookies.length : 0, console: consoleEvents.length, worker: workerIndex });
      }
    }
    await Promise.all(pages.map((workerPage, index) => processQueue(workerPage, index + 1)));
  } finally {
    for (const workerPage of pages) {
      try { await workerPage.close(); } catch (_) {}
    }
    try { await context.close(); } catch (_) {}
    await browser.close();
    onLog({ level: 'info', ts: Date.now(), msg: 'Browser closed' });
  }

  // Global unique vendors
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
