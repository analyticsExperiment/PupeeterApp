function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function normalizeWaitUntil(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "networkidle0" || normalized === "networkidle") return "networkidle2";
  if (["domcontentloaded", "load", "networkidle2"].includes(normalized)) return normalized;
  return "domcontentloaded";
}

function normalizeBrowserEngine(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "playwright" ? "playwright" : "puppeteer";
}

function normalizeWorkers(options = {}) {
  const mode = String(options.workerMode || "").trim().toLowerCase();
  const raw = mode === "custom" ? options.simultaneousWorkers : (mode === "5" || mode === "10" ? mode : options.simultaneousWorkers);
  const numeric = Number.parseInt(raw, 10);
  if (Number.isFinite(numeric) && numeric > 0) return Math.min(numeric, 20);
  return 2;
}

function collectTemplateSteps(templates) {
  return asArray(templates).flatMap((template) => asArray(template.steps));
}

function collectRuleSetRules(ruleSets) {
  return asArray(ruleSets).flatMap((ruleSet) => asArray(ruleSet.rules));
}

function assembleAuditPayload(config) {
  if (!config) {
    throw new Error("Audit config is required");
  }

  const options = config.options && typeof config.options === "object" ? config.options : {};
  const preAuditActions = [
    ...collectTemplateSteps(config.preActionTemplates),
    ...asArray(options.preAuditActions)
  ];
  const postAuditActions = [
    ...collectTemplateSteps(config.postActionTemplates),
    ...asArray(options.postAuditActions || options.onPageActions)
  ];
  const rules = [
    ...collectRuleSetRules(config.ruleSets),
    ...asArray(options.rules)
  ];
  const payload = {
    domain: config.domain || options.domain || "",
    maxPages: Number(config.maxPages || options.maxPages || 15),
    sameOriginOnly: config.sameOriginOnly !== false,
    waitUntil: normalizeWaitUntil(config.waitUntil || options.waitUntil),
    headless: config.showBrowser === false,
    browserEngine: normalizeBrowserEngine(options.browserEngine),
    workerMode: options.workerMode || "ram-protected",
    simultaneousWorkers: normalizeWorkers(options),
    startingUrls: uniqueStrings([
      ...asArray(config.urlSources),
      ...asArray(options.startingUrls)
    ]),
    findPagesInSitemaps: config.includeSitemaps !== false,
    preAuditActions,
    postAuditActions,
    onPageActions: postAuditActions,
    rules,
    flow: asArray(options.flow)
  };

  if (config.maxDepth !== null && config.maxDepth !== undefined && config.maxDepth !== "") {
    payload.maxDepth = Number(config.maxDepth);
  }

  for (const key of ["navigationTimeoutMs", "userAgent", "includeHashLinks", "autoDismissConsent"]) {
    if (options[key] !== undefined) payload[key] = options[key];
  }

  return payload;
}

function buildConfigSnapshot(config, payload) {
  return {
    id: config.id,
    name: config.name,
    description: config.description || "",
    domain: config.domain || "",
    maxPages: config.maxPages,
    maxDepth: config.maxDepth == null ? null : config.maxDepth,
    sameOriginOnly: config.sameOriginOnly !== false,
    waitUntil: normalizeWaitUntil(config.waitUntil),
    showBrowser: config.showBrowser !== false,
    browserEngine: normalizeBrowserEngine(config.options?.browserEngine),
    workerMode: config.options?.workerMode || "ram-protected",
    simultaneousWorkers: normalizeWorkers(config.options || {}),
    urlSources: asArray(config.urlSources),
    includeSitemaps: config.includeSitemaps !== false,
    preActionTemplates: asArray(config.preActionTemplates).map((item) => ({ id: item.id, name: item.name, steps: asArray(item.steps) })),
    postActionTemplates: asArray(config.postActionTemplates).map((item) => ({ id: item.id, name: item.name, steps: asArray(item.steps) })),
    ruleSets: asArray(config.ruleSets).map((item) => ({ id: item.id, name: item.name, rules: asArray(item.rules) })),
    options: config.options || {},
    assembledPayload: payload || assembleAuditPayload(config)
  };
}

module.exports = {
  assembleAuditPayload,
  buildConfigSnapshot
};
