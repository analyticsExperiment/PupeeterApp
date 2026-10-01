const { chromium } = require('playwright');
const { classifyAnalytics } = require('../audit/utils');
const { normalizeRules, evaluateRulesForPage, summarizeRuleResults } = require('../audit/rules');
const {
  sleep,
  buildRequestPayloadPreview,
  buildResponsePreview,
  normalizePlaywrightWaitUntil,
} = require('../audit/runnerShared');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeStepAction(action) {
  const raw = String(action || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'openurl' || lower === 'navigatetourl') return 'navigate';
  if (lower === 'pagerefresh' || lower === 'refresh' || lower === 'reload') return 'pageRefresh';
  if (lower === 'fillformfield') return 'type';
  if (lower === 'selectdropdownoption') return 'selectDropdownOption';
  if (lower === 'checkcheckbox') return 'checkCheckbox';
  if (lower === 'uncheckcheckbox') return 'uncheckCheckbox';
  return raw || 'click';
}

function timeoutWarning(label, timeout) {
  return `${label} did not finish within ${timeout}ms. The page load event fired, but background requests can keep modern sites from becoming network idle; continuing with captured evidence.`;
}

function isTimeoutError(error) {
  return /timeout/i.test(String(error && error.message ? error.message : error));
}

async function waitForNetworkIdleBestEffort(page, timeout) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
    return null;
  } catch (err) {
    if (isTimeoutError(err)) return timeoutWarning('Network idle wait', timeout);
    throw err;
  }
}

function normalizeSteps(steps) {
  return asArray(steps)
    .map((step, index) => ({
      id: step.id || `step-${index + 1}`,
      name: String(step.name || step.stepName || `Step ${index + 1}`).trim(),
      action: normalizeStepAction(step.action),
      selector: String(step.selector || '').trim(),
      value: step.value == null ? '' : String(step.value),
      timeout: Number(step.timeout) > 0 ? Number(step.timeout) : 10000,
      waitAfter: Number(step.waitAfter) >= 0 ? Number(step.waitAfter) : 300,
      iframeSelector: String(step.iframeSelector || step.contextSelector || '').trim(),
      notes: String(step.notes || step.description || '').trim(),
      enabled: step.enabled !== false,
      captureStepSnapshot: Boolean(step.captureStepSnapshot),
    }));
}

function isDefaultStartingStep(step) {
  return step
    && step.action === 'navigate'
    && !step.selector
    && !step.value
    && String(step.name || '').trim().toLowerCase() === 'open starting page';
}

function normalizeConfig(config = {}) {
  const generalSettings = config.generalSettings && typeof config.generalSettings === 'object' ? config.generalSettings : {};
  const flowTemplateSteps = normalizeSteps(asArray(config.flowTemplates).flatMap((template) => asArray(template.steps)));
  const inlineSteps = normalizeSteps(config.steps).filter((step) => !isDefaultStartingStep(step));
  const executionSteps = inlineSteps.length ? inlineSteps : flowTemplateSteps;
  const rules = [
    ...asArray(config.ruleSets).flatMap((set) => asArray(set.rules)),
    ...asArray(generalSettings.rules)
  ];
  return {
    id: config.id || null,
    name: String(config.name || 'Untitled Interaction').trim(),
    description: String(config.description || '').trim(),
    startingUrl: String(config.startingUrl || config.starting_url || '').trim(),
    waitUntil: normalizePlaywrightWaitUntil(config.waitUntil || config.wait_until || generalSettings.waitUntil),
    browserEngine: String(generalSettings.browserEngine || config.browserEngine || 'playwright').trim().toLowerCase() || 'playwright',
    headless: config.showBrowser === false,
    generalSettings,
    steps: executionSteps,
    ruleSets: asArray(config.ruleSets),
    flowTemplates: asArray(config.flowTemplates),
    rules: normalizeRules(rules),
  };
}

function safeUrl(value) {
  try {
    return new URL(value).toString();
  } catch (_) {
    return null;
  }
}

function getCookieKey(cookie) {
  return `${cookie.name || ''}|${cookie.domain || ''}|${cookie.path || ''}`;
}

function diffCookies(before, after) {
  const beforeMap = new Map(asArray(before).map((cookie) => [getCookieKey(cookie), cookie]));
  const added = [];
  const changed = [];
  for (const cookie of asArray(after)) {
    const key = getCookieKey(cookie);
    const previous = beforeMap.get(key);
    if (!previous) {
      added.push(cookie);
    } else if (String(previous.value || '') !== String(cookie.value || '')) {
      changed.push(cookie);
    }
  }
  return { added, changed };
}

function collectDataLayerText(entries) {
  return asArray(entries).map((entry) => {
    try {
      return JSON.stringify(entry);
    } catch (_) {
      return String(entry);
    }
  });
}

function diffDataLayer(before, after) {
  const previous = new Set(collectDataLayerText(before));
  return asArray(after).filter((entry) => {
    try {
      return !previous.has(JSON.stringify(entry));
    } catch (_) {
      return true;
    }
  });
}

async function resolveContext(page, activeContext, iframeSelector, timeout) {
  if (!iframeSelector) return activeContext || page;
  const handle = await page.waitForSelector(iframeSelector, { timeout });
  try {
    const frame = await handle.contentFrame();
    return frame || activeContext || page;
  } finally {
    try { await handle.dispose(); } catch (_) {}
  }
}

async function executeInContext(page, activeContext, step, waitUntil) {
  const action = normalizeStepAction(step.action);
  const timeout = step.timeout || 10000;
  const context = await resolveContext(page, activeContext, step.iframeSelector, timeout);

  switch (String(action).toLowerCase()) {
    case 'navigate':
      if (!step.value && !step.selector) throw new Error('navigate/openUrl requires a URL');
      await page.goto(step.value || step.selector, { waitUntil: waitUntil === 'networkidle' ? 'domcontentloaded' : waitUntil, timeout });
      if (waitUntil === 'networkidle') {
        const warning = await waitForNetworkIdleBestEffort(page, Math.min(timeout, 15000));
        if (warning) return { activeContext: page, warning };
      }
      return { activeContext: page };
    case 'pagerefresh':
    case 'refresh':
    case 'reload':
      await page.reload({ waitUntil: waitUntil === 'networkidle' ? 'domcontentloaded' : waitUntil, timeout });
      if (waitUntil === 'networkidle') {
        const warning = await waitForNetworkIdleBestEffort(page, Math.min(timeout, 15000));
        if (warning) return { activeContext: page, warning };
      }
      return { activeContext: page };
    case 'waitforselector':
      if (!step.selector) throw new Error('waitForSelector requires selector');
      await context.waitForSelector(step.selector, { timeout });
      break;
    case 'click':
      if (!step.selector) throw new Error('click requires selector');
      await context.click(step.selector, { timeout });
      break;
    case 'type':
      if (!step.selector) throw new Error('type/fillFormField requires selector');
      await context.fill(step.selector, step.value || '', { timeout });
      break;
    case 'hover':
      if (!step.selector) throw new Error('hover requires selector');
      await context.hover(step.selector, { timeout });
      break;
    case 'waitfortimeout':
      await sleep(Number(step.value) || timeout || 1000);
      break;
    case 'scroll':
      if (step.selector) {
        await context.locator(step.selector).scrollIntoViewIfNeeded({ timeout });
      } else {
        await context.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      }
      break;
    case 'switchtoiframe': {
      const selector = step.selector || step.value || step.iframeSelector;
      if (!selector) throw new Error('switchToIFrame requires iframe selector');
      const handle = await page.waitForSelector(selector, { timeout });
      try {
        const frame = await handle.contentFrame();
        if (!frame) throw new Error('selector did not resolve to an iframe');
        return { activeContext: frame };
      } finally {
        try { await handle.dispose(); } catch (_) {}
      }
    }
    case 'switchtomainframe':
      return { activeContext: page };
    case 'executejavascript':
    case 'executejs':
    case 'javascript':
    case 'evaluate':
      if (!step.value) throw new Error('executeJavaScript requires JavaScript code');
      await context.evaluate((code) => (0, eval)(code), step.value);
      break;
    case 'selectdropdownoption':
      if (!step.selector) throw new Error('selectDropdownOption requires selector');
      await context.selectOption(step.selector, step.value, { timeout });
      break;
    case 'checkcheckbox':
      if (!step.selector) throw new Error('checkCheckbox requires selector');
      await context.check(step.selector, { timeout });
      break;
    case 'uncheckcheckbox':
      if (!step.selector) throw new Error('uncheckCheckbox requires selector');
      await context.uncheck(step.selector, { timeout });
      break;
    case 'uploadfile':
      if (!step.selector || !step.value) throw new Error('uploadFile requires selector and local file path');
      await context.setInputFiles(step.selector, step.value, { timeout });
      break;
    case 'presskey':
      if (step.selector) await context.click(step.selector, { timeout });
      await page.keyboard.press(step.value || 'Enter');
      break;
    case 'waitfornavigation':
      await page.waitForLoadState('load', { timeout });
      break;
    case 'waitfornetworkidle':
      {
        const warning = await waitForNetworkIdleBestEffort(page, timeout);
        if (warning) return { activeContext, warning };
      }
      break;
    case 'waitforrequestmatching':
      if (!step.value) throw new Error('waitForRequestMatching requires URL fragment or regex text in value');
      await page.waitForRequest((request) => request.url().includes(step.value), { timeout });
      break;
    case 'waitforresponsematching':
      if (!step.value) throw new Error('waitForResponseMatching requires URL fragment or regex text in value');
      await page.waitForResponse((response) => response.url().includes(step.value), { timeout });
      break;
    case 'capturestepsnapshot':
      break;
    case 'assertelementexists':
      if (!step.selector) throw new Error('assertElementExists requires selector');
      await context.waitForSelector(step.selector, { timeout });
      break;
    case 'assertelementtext': {
      if (!step.selector) throw new Error('assertElementText requires selector');
      const text = await context.locator(step.selector).first().textContent({ timeout });
      if (!String(text || '').includes(step.value || '')) {
        throw new Error(`Expected element text to contain "${step.value}" but found "${String(text || '').trim()}"`);
      }
      break;
    }
    case 'asserturlcontains':
      if (!page.url().includes(step.value || '')) {
        throw new Error(`Expected URL to contain "${step.value}" but found "${page.url()}"`);
      }
      break;
    default:
      throw new Error(`Unsupported interaction action: ${action}`);
  }

  return { activeContext };
}

async function snapshotDataLayer(page) {
  try {
    return await page.evaluate(() => {
      const dl = (window.dataLayer && Array.isArray(window.dataLayer)) ? window.dataLayer : [];
      return dl.slice(0, 300);
    });
  } catch (_) {
    return [];
  }
}

async function runInteraction(configInput = {}, onProgress = () => {}, onLog = () => {}) {
  const config = normalizeConfig(configInput);
  if (!config.startingUrl || !safeUrl(config.startingUrl)) {
    throw new Error('A valid starting URL is required for interaction runs');
  }

  const launchOptions = {
    headless: Boolean(config.headless),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-http2', '--disable-quic'],
  };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }

  const startedAt = Date.now();
  if (config.browserEngine !== 'playwright') {
    onLog({
      level: 'warn',
      ts: Date.now(),
      msg: 'Interaction journeys currently execute through the Playwright module; selected module is stored with the config for visibility.',
      selectedModule: config.browserEngine
    });
  }
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: {
      width: Number(config.generalSettings.viewportWidth) || 1366,
      height: Number(config.generalSettings.viewportHeight) || 768,
    },
    userAgent: config.generalSettings.userAgent || undefined,
    extraHTTPHeaders: { 'Accept-Language': config.generalSettings.acceptLanguage || 'en-US,en;q=0.9' },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(Number(config.generalSettings.defaultTimeoutMs) || 30000);
  page.setDefaultNavigationTimeout(Number(config.generalSettings.navigationTimeoutMs) || 60000);

  const allNetworkRequests = [];
  const networkEntryByRequest = new Map();
  const networkSettlers = [];
  const allConsoleMessages = [];
  const analyticsEvents = [];

  page.on('request', (request) => {
    const url = request.url();
    const method = request.method();
    const resourceType = request.resourceType();
    const entry = {
      id: allNetworkRequests.length + 1,
      url,
      method,
      resourceType,
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
    allNetworkRequests.push(entry);
    networkEntryByRequest.set(request, entry);
    const match = classifyAnalytics(url, { method, resourceType });
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
        url,
        method,
        resourceType,
        ts: Date.now(),
      });
    }
  });

  page.on('response', (response) => {
    const task = (async () => {
      try {
        const request = response.request();
        const entry = networkEntryByRequest.get(request);
        if (!entry) return;
        entry.status = response.status();
        entry.statusText = response.statusText();
        entry.responseHeaders = response.headers();
        entry.fromServiceWorker = response.fromServiceWorker ? response.fromServiceWorker() : false;
        entry.completedAt = Date.now();
        entry.responsePreview = await buildResponsePreview(response, entry.resourceType);
      } catch (_) {}
    })();
    networkSettlers.push(task);
  });

  page.on('requestfailed', (request) => {
    const entry = networkEntryByRequest.get(request);
    const failure = (() => {
      try { return request.failure ? request.failure() : null; } catch (_) { return null; }
    })();
    if (entry) {
      entry.failed = true;
      entry.failureText = failure?.errorText || null;
      entry.completedAt = Date.now();
    }
  });

  page.on('console', (message) => {
    allConsoleMessages.push({
      type: message.type ? message.type() : 'log',
      text: (() => { try { return message.text(); } catch (_) { return ''; } })(),
      ts: Date.now()
    });
  });
  page.on('pageerror', (error) => {
    allConsoleMessages.push({ type: 'error', text: String(error && error.message ? error.message : error), ts: Date.now() });
  });

  const stepResults = [];
  let activeContext = page;
  let overallStatus = 'passed';
  let finalUrl = config.startingUrl;

  try {
    onLog({ level: 'info', ts: Date.now(), msg: 'Launching interaction browser', headless: config.headless, steps: config.steps.length });
    const initialStarted = Date.now();
    await page.goto(config.startingUrl, { waitUntil: config.waitUntil === 'networkidle' ? 'domcontentloaded' : config.waitUntil, timeout: Number(config.generalSettings.navigationTimeoutMs) || 60000 });
    if (config.waitUntil === 'networkidle') {
      const warning = await waitForNetworkIdleBestEffort(page, 15000);
      if (warning) onLog({ level: 'warn', ts: Date.now(), msg: warning, url: page.url() });
    }
    onLog({ level: 'info', ts: Date.now(), msg: 'Starting URL loaded', url: page.url(), durationMs: Date.now() - initialStarted });

    const totalSteps = config.steps.length;
    for (const [index, step] of config.steps.entries()) {
      const stepNumber = index + 1;
      const started = Date.now();
      const beforeRequestIndex = allNetworkRequests.length;
      const beforeConsoleIndex = allConsoleMessages.length;
      const beforeAnalyticsIndex = analyticsEvents.length;
      const beforeUrl = page.url();
      const cookiesBefore = await context.cookies();
      const dataLayerBefore = await snapshotDataLayer(page);
      const result = {
        stepNumber,
        stepName: step.name || `Step ${stepNumber}`,
        action: step.action,
        notes: step.notes || '',
        startedAt: started,
        endedAt: null,
        durationMs: null,
        status: step.enabled ? 'passed' : 'skipped',
        error: null,
        urlBefore: beforeUrl,
        urlAfter: beforeUrl,
        networkRequests: [],
        console: [],
        analytics: [],
        cookies: { before: cookiesBefore, after: [], added: [], changed: [] },
        dataLayer: { before: dataLayerBefore, after: [], added: [] },
        ruleResults: [],
        screenshotBase64: null,
        warning: null,
      };

      try {
        if (!step.enabled) {
          onLog({ level: 'info', ts: Date.now(), msg: 'Interaction step skipped', step: stepNumber, name: result.stepName });
        } else {
          onLog({ level: 'info', ts: Date.now(), msg: 'Interaction step started', step: stepNumber, name: result.stepName, action: step.action });
          const execution = await executeInContext(page, activeContext, step, config.waitUntil);
          activeContext = execution.activeContext || activeContext || page;
          if (execution.warning) {
            result.warning = execution.warning;
            onLog({ level: 'warn', ts: Date.now(), msg: execution.warning, step: stepNumber, name: result.stepName });
          }
          if (step.waitAfter) await sleep(step.waitAfter);
          if (step.captureStepSnapshot || String(step.action).toLowerCase() === 'capturestepsnapshot') {
            result.screenshotBase64 = await page.screenshot({ encoding: 'base64', fullPage: false });
          }
          onLog({ level: 'info', ts: Date.now(), msg: 'Interaction step passed', step: stepNumber, name: result.stepName });
        }
      } catch (err) {
        result.status = 'failed';
        result.error = String(err && err.message ? err.message : err);
        overallStatus = 'failed';
        onLog({ level: 'error', ts: Date.now(), msg: 'Interaction step failed', step: stepNumber, name: result.stepName, error: result.error });
        if (config.generalSettings.stopOnStepFailure !== false) {
          // Capture deltas below before ending the run.
        }
      }

      try { await Promise.allSettled(networkSettlers); } catch (_) {}
      const cookiesAfter = await context.cookies();
      const dataLayerAfter = await snapshotDataLayer(page);
      const ended = Date.now();
      result.endedAt = ended;
      result.durationMs = ended - started;
      result.urlAfter = page.url();
      result.networkRequests = allNetworkRequests.slice(beforeRequestIndex);
      result.console = allConsoleMessages.slice(beforeConsoleIndex);
      result.analytics = analyticsEvents.slice(beforeAnalyticsIndex);
      result.cookies.after = cookiesAfter;
      Object.assign(result.cookies, diffCookies(cookiesBefore, cookiesAfter));
      result.dataLayer.after = dataLayerAfter;
      result.dataLayer.added = diffDataLayer(dataLayerBefore, dataLayerAfter);

      let title = '';
      try { title = await page.title(); } catch (_) {}
      const pseudoPage = {
        initialUrl: result.urlBefore,
        finalUrl: result.urlAfter,
        url: result.urlAfter,
        title,
        analytics: result.analytics,
        cookies: result.cookies.after,
        console: result.console,
        dataLayer: { before: result.dataLayer.before, after: result.dataLayer.after },
        initialStatusCode: null,
        finalStatusCode: null,
      };
      result.ruleResults = evaluateRulesForPage(pseudoPage, config.rules);
      if (result.ruleResults.some((rule) => rule.status === 'failed')) overallStatus = 'failed';
      stepResults.push(result);
      onProgress({ processed: stepNumber, total: totalSteps, current: result.stepName, progress: Math.round((stepNumber / Math.max(totalSteps, 1)) * 100) });

      if (result.status === 'failed' && config.generalSettings.stopOnStepFailure !== false) {
        break;
      }
    }

    await Promise.allSettled(networkSettlers);
    try { finalUrl = page.url(); } catch (_) {}
  } finally {
    try { await context.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
  }

  const completedAt = Date.now();
  const pagesForRules = stepResults.map((step) => ({
    initialUrl: step.urlBefore,
    finalUrl: step.urlAfter,
    url: step.urlAfter,
    title: step.stepName,
    analytics: step.analytics,
    cookies: step.cookies.after,
    console: step.console,
    dataLayer: step.dataLayer,
    ruleResults: step.ruleResults,
  }));
  const ruleSummary = summarizeRuleResults(pagesForRules, config.rules);

  return {
    type: 'interaction',
    config: {
      id: config.id,
      name: config.name,
      description: config.description,
      startingUrl: config.startingUrl,
      waitUntil: config.waitUntil,
      browserEngine: config.browserEngine,
      generalSettings: config.generalSettings,
      flowTemplates: config.flowTemplates.map((template) => ({ id: template.id, name: template.name })),
      ruleSets: config.ruleSets.map((set) => ({ id: set.id, name: set.name })),
    },
    startedAt,
    completedAt,
    durationMs: completedAt - startedAt,
    status: overallStatus,
    steps: stepResults,
    networkRequests: allNetworkRequests,
    console: allConsoleMessages,
    analytics: analyticsEvents,
    cookies: stepResults.length ? stepResults[stepResults.length - 1].cookies.after : [],
    dataLayer: stepResults.length ? stepResults[stepResults.length - 1].dataLayer.after : [],
    ruleSummary,
    finalUrl,
    summary: {
      status: overallStatus,
      totalSteps: config.steps.length,
      passedSteps: stepResults.filter((step) => step.status === 'passed').length,
      failedSteps: stepResults.filter((step) => step.status === 'failed').length,
      skippedSteps: stepResults.filter((step) => step.status === 'skipped').length,
      totalRequests: allNetworkRequests.length,
      detectedRequests: analyticsEvents.length,
      consoleMessages: allConsoleMessages.length,
      failedRules: stepResults.reduce((sum, step) => sum + step.ruleResults.filter((rule) => rule.status === 'failed').length, 0),
      passedRules: stepResults.reduce((sum, step) => sum + step.ruleResults.filter((rule) => rule.status === 'passed').length, 0),
      configuredRules: config.rules.length,
      durationMs: completedAt - startedAt,
      finalUrl,
    }
  };
}

module.exports = {
  runInteraction,
  normalizeConfig
};
