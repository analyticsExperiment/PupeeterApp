const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const tagListPath = path.join(__dirname, "..", "..", "tagList.json");

let cache = null;

function normalizeList(value) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
}

function dedupeList(values) {
  return Array.from(new Set(normalizeList(values)));
}

function buildRequestPatternsFromUrlContains(urlContains) {
  const patterns = [];
  for (const fragment of normalizeList(urlContains)) {
    const token = fragment.toLowerCase();
    if (!token) continue;

    if (token.startsWith("/")) {
      patterns.push({ pathContains: [token] });
      continue;
    }

    const hasSlash = token.includes("/");
    const startsLikeUrl = token.startsWith("http://") || token.startsWith("https://");
    if (hasSlash && !startsLikeUrl) {
      const [host, ...rest] = token.split("/");
      const path = rest.length ? `/${rest.join("/")}` : "";
      const pattern = {};
      if (host) pattern.hostContains = [host];
      if (path) pattern.pathContains = [path];
      patterns.push(pattern);
      continue;
    }

    patterns.push({ urlContains: [token] });
  }
  return patterns;
}

function normalizeRequestPatterns(requestPatterns, fallbackUrlContains) {
  const sourcePatterns = Array.isArray(requestPatterns) && requestPatterns.length
    ? requestPatterns
    : buildRequestPatternsFromUrlContains(fallbackUrlContains);

  return sourcePatterns
    .map((pattern) => ({
      urlContains: dedupeList(pattern && pattern.urlContains).map((value) => value.toLowerCase()),
      hostContains: dedupeList(pattern && pattern.hostContains).map((value) => value.toLowerCase()),
      pathContains: dedupeList(pattern && pattern.pathContains).map((value) => value.toLowerCase()),
      queryParamAll: dedupeList(pattern && pattern.queryParamAll).map((value) => value.toLowerCase()),
      queryParamAny: dedupeList(pattern && pattern.queryParamAny).map((value) => value.toLowerCase()),
    }))
    .filter((pattern) => (
      pattern.urlContains.length
      || pattern.hostContains.length
      || pattern.pathContains.length
      || pattern.queryParamAll.length
      || pattern.queryParamAny.length
    ));
}

function loadTagCatalog(forceReload = false) {
  if (!forceReload && cache) return cache;

  const raw = fs.readFileSync(tagListPath, "utf8");
  const tags = JSON.parse(raw);
  const detectable = tags
    .filter((entry) => entry && entry.detection && (
      Array.isArray(entry.detection.urlContains)
      || Array.isArray(entry.detection.requestPatterns)
    ))
    .map((entry) => ({
      ...entry,
      detection: {
        ...entry.detection,
        urlContains: normalizeList(entry.detection.urlContains).map((part) => part.toLowerCase()),
        requestPatterns: normalizeRequestPatterns(entry.detection.requestPatterns, entry.detection.urlContains),
        aliases: dedupeList(entry.detection.aliases),
        resourceTypes: normalizeList(entry.detection.resourceTypes).map((part) => part.toLowerCase()),
        methods: normalizeList(entry.detection.methods).map((part) => part.toUpperCase()),
        priority: Number(entry.detection.priority || 0),
      },
    }))
    .sort((a, b) => (b.detection.priority || 0) - (a.detection.priority || 0));

  const ruleTags = Array.from(
    new Map(
      detectable.flatMap((entry) => {
        const values = dedupeList([
          entry.detection.vendor,
          entry.name,
          ...(Array.isArray(entry.detection.aliases) ? entry.detection.aliases : []),
        ]);
        return values.map((value) => ([
          value.toLowerCase(),
          {
            name: value,
            tagName: entry.name,
            category: entry.category || "Unknown",
          },
        ]));
      })
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  cache = { tags, detectable, ruleTags };
  return cache;
}

function patternMatches(pattern, parsedUrl, normalizedUrl) {
  if (!pattern) return false;
  const queryParamNames = parsedUrl
    ? new Set(Array.from(parsedUrl.searchParams.keys(), (key) => String(key || "").toLowerCase()))
    : null;

  if (pattern.urlContains.length && !pattern.urlContains.every((needle) => normalizedUrl.includes(needle))) {
    return false;
  }

  if (pattern.hostContains.length) {
    const host = parsedUrl ? String(parsedUrl.host || "").toLowerCase() : "";
    if (!pattern.hostContains.every((needle) => host.includes(needle))) {
      return false;
    }
  }

  if (pattern.pathContains.length) {
    const pathname = parsedUrl ? String(parsedUrl.pathname || "").toLowerCase() : normalizedUrl;
    if (!pattern.pathContains.every((needle) => pathname.includes(needle))) {
      return false;
    }
  }

  if (pattern.queryParamAll.length) {
    if (!queryParamNames || !pattern.queryParamAll.every((param) => queryParamNames.has(param))) {
      return false;
    }
  }

  if (pattern.queryParamAny.length) {
    if (!queryParamNames || !pattern.queryParamAny.some((param) => queryParamNames.has(param))) {
      return false;
    }
  }

  return true;
}

function entryMatches(entry, requestUrl, resourceType, method) {
  const normalizedUrl = String(requestUrl || "").toLowerCase();
  const normalizedResourceType = String(resourceType || "").toLowerCase();
  const normalizedMethod = String(method || "").toUpperCase();
  const detection = entry.detection || {};
  let parsedUrl = null;

  try {
    parsedUrl = new URL(requestUrl);
  } catch (_) {}

  const matchedPattern = Array.isArray(detection.requestPatterns) && detection.requestPatterns.length
    ? detection.requestPatterns.some((pattern) => patternMatches(pattern, parsedUrl, normalizedUrl))
    : detection.urlContains.some((needle) => normalizedUrl.includes(needle));

  if (!matchedPattern) {
    return false;
  }
  if (detection.resourceTypes.length && !detection.resourceTypes.includes(normalizedResourceType)) {
    return false;
  }
  if (detection.methods.length && !detection.methods.includes(normalizedMethod)) {
    return false;
  }

  return true;
}

function classifyWithCatalog(requestUrl, options = {}) {
  const { detectable } = loadTagCatalog();
  for (const entry of detectable) {
    if (!entryMatches(entry, requestUrl, options.resourceType, options.method)) continue;

    return {
      id: entry.detection.id || entry.vendorKey || entry.name,
      vendor: entry.detection.vendor || entry.name,
      tagName: entry.name,
      category: entry.category || entry.detection.category || null,
      matchType: entry.detection.matchType || "request",
      confidence: entry.detection.confidence || null,
      aliases: Array.isArray(entry.detection.aliases) ? entry.detection.aliases : [],
      documentation: Array.isArray(entry.vendorDocs) ? entry.vendorDocs : [],
      endpoints: entry.endpoints || {},
    };
  }
  return null;
}

function classifyWithFallbacks(requestUrl) {
  const url = String(requestUrl || "").toLowerCase();
  if (url.includes("googleadservices.com/pagead/conversion") || url.includes("googleads.g.doubleclick.net")) {
    return { vendor: "Google Ads", tagName: "Google Ads", id: "google-ads", category: "Advertising", matchType: "event", documentation: [], endpoints: {} };
  }
  if (url.includes("mixpanel.com")) {
    return { vendor: "Mixpanel", tagName: "MixPanel", id: "mixpanel", category: "Web Analytics", matchType: "event", documentation: [], endpoints: {} };
  }
  if (url.includes("criteo.com") || url.includes("measurement-api.criteo.com")) {
    return { vendor: "Criteo", tagName: "Criteo OneTag", id: "criteo", category: "Advertising", matchType: "event", documentation: [], endpoints: {} };
  }
  if (url.includes("widgets.outbrain.com/outbrain.js")) {
    return { vendor: "Outbrain", tagName: "Outbrain Loader", id: "outbrain-loader", category: "Advertising", matchType: "library", documentation: [], endpoints: {} };
  }
  if (url.includes("tr.outbrain.com")) {
    return { vendor: "Outbrain", tagName: "Outbrain Analytics", id: "outbrain", category: "Advertising", matchType: "event", documentation: [], endpoints: {} };
  }
  if (url.includes("trc.taboola.com") || url.includes("cdn.taboola.com")) {
    return { vendor: "Taboola", tagName: "Taboola", id: "taboola", category: "Advertising", matchType: "event", documentation: [], endpoints: {} };
  }
  if (url.includes("appboy.com") || url.includes("braze.com")) {
    return { vendor: "Braze", tagName: "Braze", id: "braze", category: "Digital Measurement", matchType: "event", documentation: [], endpoints: {} };
  }
  return null;
}

function classifyTagRequest(requestUrl, options = {}) {
  return classifyWithCatalog(requestUrl, options) || classifyWithFallbacks(requestUrl);
}

function getPublicTagCatalog() {
  return loadTagCatalog().tags;
}

function getRuleTagOptions() {
  return loadTagCatalog().ruleTags;
}

module.exports = {
  loadTagCatalog,
  classifyTagRequest,
  getPublicTagCatalog,
  getRuleTagOptions,
};
