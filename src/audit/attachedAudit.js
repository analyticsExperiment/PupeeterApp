const { classifyAnalytics, sameOrigin } = require('./utils');
const { normalizeRules, evaluateRulesForPage, summarizeRuleResults } = require('./rules');

function httpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch (_) { return null; }
}

function startUrlForConfig(payload) {
  const raw = payload.startingUrls?.[0] || payload.domain;
  const url = httpUrl(raw) || httpUrl(`https://${String(raw || '').replace(/^\/+/, '')}`);
  if (!url) throw Object.assign(new Error('Config needs a valid HTTP(S) starting URL'), { statusCode: 400 });
  return url;
}

function short(value, limit = 2000) {
  return String(value == null ? '' : value).slice(0, limit);
}

function sanitizePage(raw, startUrl) {
  const url = httpUrl(raw?.url);
  if (!url || !sameOrigin(url, startUrl)) {
    throw Object.assign(new Error('Captured page must be on the configured origin'), { statusCode: 400 });
  }
  const pageId = short(raw.pageId, 100);
  if (!pageId) throw Object.assign(new Error('Page ID is required'), { statusCode: 400 });
  const networkRequests = (Array.isArray(raw.networkRequests) ? raw.networkRequests : []).slice(0, 500)
    .filter((entry) => httpUrl(entry?.url))
    .map((entry, index) => ({
      id: index + 1,
      url: short(entry.url, 4000),
      method: short(entry.method || 'GET', 16),
      resourceType: short(entry.resourceType, 32),
      requestHeaders: {},
      responseHeaders: {},
      status: Number.isInteger(entry.status) ? entry.status : null,
      statusText: short(entry.statusText, 120),
      failed: Boolean(entry.failed),
      failureText: short(entry.failureText, 300) || null,
      startedAt: Number(entry.startedAt) || null,
      completedAt: Number(entry.completedAt) || null,
    }));
  const analytics = networkRequests.flatMap((entry) => {
    const match = classifyAnalytics(entry.url, { method: entry.method, resourceType: entry.resourceType });
    return match ? [{
      type: 'request', vendor: match.vendor, tagName: match.tagName || match.vendor,
      id: match.id, category: match.category || null, matchType: match.matchType || null,
      confidence: match.confidence || null, aliases: match.aliases || [],
      documentation: match.documentation || [], endpoints: match.endpoints || {},
      url: entry.url, method: entry.method, resourceType: entry.resourceType, ts: entry.startedAt,
    }] : [];
  });
  const status = Number.isInteger(raw.statusCode) ? raw.statusCode : null;
  return {
    pageId,
    initialUrl: url, finalUrl: url, url,
    initialStatusCode: status, finalStatusCode: status,
    title: short(raw.title, 500), depth: 0,
    cookies: (Array.isArray(raw.cookies) ? raw.cookies : []).slice(0, 200).map((cookie) => ({
      name: short(cookie.name, 300), value: short(cookie.value, 4000),
      domain: short(cookie.domain, 300), path: short(cookie.path, 300),
      secure: Boolean(cookie.secure), httpOnly: Boolean(cookie.httpOnly),
      sameSite: short(cookie.sameSite, 40),
    })),
    analytics, networkRequests, console: [],
    vendors: [...new Set(analytics.map((item) => item.vendor).filter(Boolean))],
    dataLayer: { before: [], after: Array.isArray(raw.dataLayer) ? raw.dataLayer.slice(0, 100) : [] },
    error: status >= 400 ? `Final document returned HTTP ${status}` : null,
    preAuditError: null, onPageError: null, flowError: null,
    linksFound: Math.max(0, Number(raw.linksFound) || 0),
    captureNotes: short(raw.captureNotes, 300) || null,
    userAgent: short(raw.userAgent, 500),
  };
}

function buildAttachedResults(pages, payload, requestHeaders = {}, options = {}) {
  const rules = normalizeRules(payload.rules);
  const normalizedPages = pages.map((page) => ({ ...page, ruleResults: evaluateRulesForPage(page, rules) }));
  const ruleSummary = summarizeRuleResults(normalizedPages, rules);
  const vendors = [...new Set(normalizedPages.flatMap((page) => page.vendors || []))];
  const count = (test) => normalizedPages.filter(test).length;
  const summary = {
    total: normalizedPages.length,
    pageTarget: payload.maxPages,
    targetMet: normalizedPages.length >= payload.maxPages,
    crawlStopReason: options.stopReason || null,
    discoveredCandidateCount: Math.max(0, Number(options.discoveredCandidateCount) || 0),
    analyticsHits: normalizedPages.reduce((n, page) => n + page.analytics.length, 0),
    detectedRequests: normalizedPages.reduce((n, page) => n + page.analytics.length, 0),
    networkRequests: normalizedPages.reduce((n, page) => n + page.networkRequests.length, 0),
    pagesWithAnalytics: count((page) => page.analytics.length || page.dataLayer.after.length),
    pagesWithDetectedRequests: count((page) => page.analytics.length),
    pagesWithNetworkRequests: count((page) => page.networkRequests.length),
    errors: count((page) => page.error),
    consoleMessages: 0, consoleErrors: 0,
    ruleFailures: ruleSummary.totals.failedEvaluations,
    rulePasses: ruleSummary.totals.passedEvaluations,
    ruleSkipped: ruleSummary.totals.skippedEvaluations,
    configuredRules: rules.length,
    browserEngine: 'attached-chrome', workerCount: 0,
    uniqueVendors: vendors, uniqueVendorsCount: vendors.length,
    pagesWithFailedRules: ruleSummary.totals.pagesWithFailedRules,
    pagesWithPassedRules: ruleSummary.totals.pagesWithPassedRules,
  };
  return {
    pages: normalizedPages, summary, ruleSummary,
    captureMode: 'attached-chrome',
    captureLimitations: `${payload.autoCrawl ? 'Automatic same-origin navigation' : 'Manual navigation'}; HTTP requests, cookie snapshot and dataLayer snapshot captured. No response bodies, console messages or pre/post actions.`,
    requestHeaders: { ...requestHeaders, userAgent: normalizedPages.find((page) => page.userAgent)?.userAgent || requestHeaders.userAgent || '' },
  };
}

module.exports = { startUrlForConfig, sanitizePage, buildAttachedResults };
