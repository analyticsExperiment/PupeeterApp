const http = require('http');
const https = require('https');
const { normalizeUrl } = require('./utils');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
}

async function populateConsoleText(message, entry) {
  try {
    const args = message.args();
    if (!args.length) return;
    const values = await Promise.all(args.map((arg) => arg.jsonValue()));
    if (!values.some((value) => value !== null && typeof value === 'object')) return;
    entry.text = values.map((value) => typeof value === 'string'
      ? value
      : (JSON.stringify(value) ?? String(value))).join(' ');
  } catch (_) {
    // Keep the browser's text if an argument or its execution context is unavailable.
  }
}

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

function normalizePuppeteerWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle0' || normalized === 'networkidle') return 'networkidle2';
  if (normalized === 'load' || normalized === 'domcontentloaded' || normalized === 'networkidle2') return normalized;
  return 'domcontentloaded';
}

function normalizePlaywrightWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle0' || normalized === 'networkidle2' || normalized === 'networkidle') return 'networkidle';
  if (normalized === 'load' || normalized === 'domcontentloaded') return normalized;
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

module.exports = {
  sleep,
  populateConsoleText,
  parseStartingUrls,
  buildRequestPayloadPreview,
  buildResponsePreview,
  discoverSitemapUrls,
  normalizePuppeteerWaitUntil,
  normalizePlaywrightWaitUntil,
  resolveMaxDepth,
  resolveWorkerCount,
  dismissConsentBanner,
};
