function normalizeText(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeRules(rules) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule, index) => ({
      id: String(rule && rule.id ? rule.id : `rule-${index + 1}`),
      name: String(rule && rule.name ? rule.name : `Rule ${index + 1}`).trim(),
      whenMode: normalizeMode(rule && rule.whenMode),
      expectMode: normalizeMode(rule && rule.expectMode),
      evaluationLimit: normalizeLimit(rule && rule.evaluationLimit),
      conditions: normalizeConditionList(rule && rule.conditions),
      assertions: normalizeAssertionList(rule && rule.assertions),
    }))
    .filter((rule) => rule.name || rule.conditions.length || rule.assertions.length);
}

function normalizeMode(value) {
  return String(value || "all").toLowerCase() === "any" ? "any" : "all";
}

function normalizeLimit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 1;
}

function normalizeConditionList(conditions) {
  return (Array.isArray(conditions) ? conditions : [])
    .map((condition) => ({
      subject: String(condition && condition.subject ? condition.subject : "").trim(),
      operator: String(condition && condition.operator ? condition.operator : "contains").trim(),
      value: condition && condition.value != null ? String(condition.value) : "",
    }))
    .filter((condition) => condition.subject);
}

function normalizeAssertionList(assertions) {
  return (Array.isArray(assertions) ? assertions : [])
    .map((assertion) => ({
      type: String(assertion && assertion.type ? assertion.type : "tagPresence").trim(),
      tag: assertion && assertion.tag != null ? String(assertion.tag) : "",
      field: assertion && assertion.field != null ? String(assertion.field) : "",
      operator: String(assertion && assertion.operator ? assertion.operator : "exists").trim(),
      value: assertion && assertion.value != null ? String(assertion.value) : "",
      description: assertion && assertion.description != null ? String(assertion.description) : "",
    }))
    .filter((assertion) => assertion.type);
}

function evaluateRulesForPage(pageResult, rules) {
  const page = buildPageContext(pageResult);
  return rules.map((rule) => evaluateSingleRule(page, rule));
}

function buildPageContext(pageResult) {
  return {
    initialUrl: pageResult.initialUrl || pageResult.url || "",
    finalUrl: pageResult.finalUrl || pageResult.url || "",
    pageTitle: pageResult.title || "",
    initialStatusCode: pageResult.initialStatusCode,
    finalStatusCode: pageResult.finalStatusCode,
    analytics: Array.isArray(pageResult.analytics) ? pageResult.analytics : [],
    cookies: Array.isArray(pageResult.cookies) ? pageResult.cookies : [],
    consoleMessages: Array.isArray(pageResult.console) ? pageResult.console : [],
    dataLayerEntries: [
      ...(Array.isArray(pageResult.dataLayer && pageResult.dataLayer.before) ? pageResult.dataLayer.before : []),
      ...(Array.isArray(pageResult.dataLayer && pageResult.dataLayer.after) ? pageResult.dataLayer.after : []),
    ],
  };
}

function collectAnalyticsLabels(entries) {
  const labels = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry.vendor) labels.push(entry.vendor);
    if (entry.tagName) labels.push(entry.tagName);
    if (Array.isArray(entry.aliases)) labels.push(...entry.aliases);
  }
  return labels;
}

function evaluateSingleRule(page, rule) {
  const when = evaluateConditionGroup(page, rule.conditions, rule.whenMode, rule.evaluationLimit);
  if (!rule.assertions.length) {
    return {
      id: rule.id,
      name: rule.name,
      status: "skipped",
      applied: false,
      when,
      expect: { mode: rule.expectMode, passed: false, results: [] },
      summary: "No expectations configured",
    };
  }

  if (!when.passed) {
    return {
      id: rule.id,
      name: rule.name,
      status: "skipped",
      applied: false,
      when,
      expect: { mode: rule.expectMode, passed: false, results: [] },
      summary: "Conditions not met on this page",
    };
  }

  const expect = evaluateAssertionGroup(page, rule.assertions, rule.expectMode, rule.evaluationLimit);
  return {
    id: rule.id,
    name: rule.name,
    status: expect.passed ? "passed" : "failed",
    applied: true,
    when,
    expect,
    summary: expect.passed ? "All expectations satisfied" : "One or more expectations failed",
  };
}

function evaluateConditionGroup(page, conditions, mode, limit) {
  if (!conditions.length) {
    return { mode, passed: true, results: [] };
  }
  const results = conditions.map((condition) => evaluateCondition(page, condition, limit));
  return { mode, passed: combineResults(results, mode), results };
}

function evaluateAssertionGroup(page, assertions, mode, limit) {
  const results = assertions.map((assertion) => evaluateAssertion(page, assertion, limit));
  return { mode, passed: combineResults(results, mode), results };
}

function combineResults(results, mode) {
  if (!results.length) return true;
  if (mode === "any") return results.some((result) => result.passed);
  return results.every((result) => result.passed);
}

function evaluateCondition(page, condition, limit) {
  const subject = String(condition.subject || "");
  const operator = String(condition.operator || "contains");
  const expected = String(condition.value || "");

  switch (subject) {
    case "initialUrl":
      return makeCheck(condition, compareScalar(page.initialUrl, operator, expected), page.initialUrl);
    case "finalUrl":
      return makeCheck(condition, compareScalar(page.finalUrl, operator, expected), page.finalUrl);
    case "pageTitle":
      return makeCheck(condition, compareScalar(page.pageTitle, operator, expected), page.pageTitle);
    case "initialStatusCode":
      return makeCheck(condition, compareNumeric(page.initialStatusCode, operator, expected), page.initialStatusCode);
    case "finalStatusCode":
      return makeCheck(condition, compareNumeric(page.finalStatusCode, operator, expected), page.finalStatusCode);
    case "tagVendor":
      return compareCollectionCheck(condition, collectAnalyticsLabels(page.analytics), operator, expected);
    case "tagName":
      return compareCollectionCheck(condition, collectAnalyticsLabels(page.analytics), operator, expected);
    case "requestUrl":
      return compareCollectionCheck(condition, page.analytics.map((entry) => entry.url), operator, expected, limit);
    case "cookieName":
      return compareCollectionCheck(condition, page.cookies.map((entry) => entry.name), operator, expected);
    case "dataLayer":
      return compareCollectionCheck(condition, collectDataLayerText(page.dataLayerEntries), operator, expected, limit);
    case "consoleText":
      return compareCollectionCheck(condition, page.consoleMessages.map((entry) => entry.text), operator, expected, limit);
    default:
      return makeCheck(condition, false, "", `Unsupported condition subject: ${subject || "unknown"}`);
  }
}

function evaluateAssertion(page, assertion, limit) {
  const type = String(assertion.type || "tagPresence");
  const operator = String(assertion.operator || "exists");
  const tagMatches = collectMatchingAnalytics(page.analytics, assertion.tag, limit);

  switch (type) {
    case "tagPresence":
      return compareCollectionCheck(assertion, tagMatches.map((entry) => entry.tagName || entry.vendor), operator, assertion.value, limit, {
        fallbackLabel: assertion.tag || "Any tag",
      });
    case "tagParam":
      return evaluateTagParameterAssertion(assertion, tagMatches, limit);
    case "requestUrl":
      return compareCollectionCheck(assertion, tagMatches.map((entry) => entry.url), operator, assertion.value, limit, {
        fallbackLabel: assertion.tag || "Any request",
      });
    case "pageField":
      return evaluatePageFieldAssertion(assertion, page);
    case "cookie":
      return evaluateCookieAssertion(assertion, page.cookies);
    case "dataLayer":
      return evaluateDataLayerAssertion(assertion, page.dataLayerEntries, limit);
    case "console":
      return evaluateConsoleAssertion(assertion, page.consoleMessages, limit);
    default:
      return makeCheck(assertion, false, "", `Unsupported expectation type: ${type}`);
  }
}

function evaluateTagParameterAssertion(assertion, tagMatches, limit) {
  const field = String(assertion.field || "").trim();
  const values = [];

  for (const match of tagMatches.slice(0, limit)) {
    const params = parseUrlParams(match.url);
    if (!field) {
      values.push(JSON.stringify(params));
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(params, field)) {
      values.push(params[field]);
    }
  }

  return compareCollectionCheck(assertion, values, assertion.operator, assertion.value, limit, {
    fallbackLabel: field || assertion.tag || "Tag parameter",
  });
}

function evaluatePageFieldAssertion(assertion, page) {
  const field = String(assertion.field || "finalUrl");
  const value = page[field];
  if (field === "initialStatusCode" || field === "finalStatusCode") {
    return makeCheck(assertion, compareNumeric(value, assertion.operator, assertion.value), value);
  }
  return makeCheck(assertion, compareScalar(value, assertion.operator, assertion.value), value);
}

function evaluateCookieAssertion(assertion, cookies) {
  const field = String(assertion.field || "").trim();
  const matches = field
    ? cookies.filter((cookie) => normalizeText(cookie.name) === normalizeText(field))
    : cookies;
  const values = field ? matches.map((cookie) => cookie.value) : matches.map((cookie) => cookie.name);
  return compareCollectionCheck(assertion, values, assertion.operator, assertion.value, 0, {
    fallbackLabel: field || "Cookie",
  });
}

function evaluateDataLayerAssertion(assertion, entries, limit) {
  const field = String(assertion.field || "").trim();
  const values = field ? collectValuesByPath(entries, field, limit) : collectDataLayerText(entries, limit);
  return compareCollectionCheck(assertion, values, assertion.operator, assertion.value, limit, {
    fallbackLabel: field || "dataLayer",
  });
}

function evaluateConsoleAssertion(assertion, messages, limit) {
  const level = normalizeText(assertion.field);
  const values = messages
    .filter((message) => !level || normalizeText(message.type) === level)
    .slice(0, limit || undefined)
    .map((message) => message.text);
  return compareCollectionCheck(assertion, values, assertion.operator, assertion.value, limit, {
    fallbackLabel: level || "Console",
  });
}

function compareCollectionCheck(definition, values, operator, expected, limit, extras = {}) {
  const list = Array.isArray(values) ? values.filter((value) => value != null) : [];
  const truncated = limit > 0 ? list.slice(0, limit) : list.slice();
  const passed = compareCollection(truncated, operator, expected);
  const actual = formatCollectionPreview(selectPreviewValues(truncated, operator, expected));
  return makeCheck(definition, passed, actual, null, extras.fallbackLabel || "");
}

function makeCheck(definition, passed, actual, note, fallbackLabel) {
  return {
    subject: definition.subject || definition.type || fallbackLabel || "",
    operator: definition.operator || "",
    expected: definition.value != null ? String(definition.value) : "",
    field: definition.field != null ? String(definition.field) : "",
    tag: definition.tag != null ? String(definition.tag) : "",
    description: definition.description != null ? String(definition.description) : "",
    passed,
    actual: actual == null ? "" : String(actual),
    note: note || "",
  };
}

function compareCollection(values, operator, expected) {
  if (operator === "exists") return values.length > 0;
  if (operator === "notExists") return values.length === 0;
  if (operator === "countEquals") return values.length === (toNumber(expected) || 0);
  if (operator === "countAtLeast") return values.length >= (toNumber(expected) || 0);
  if (operator === "countAtMost") return values.length <= (toNumber(expected) || 0);
  if (operator === "notContains" || operator === "notEquals") {
    return values.every((value) => compareScalar(value, operator, expected));
  }
  return values.some((value) => compareScalar(value, operator, expected));
}

function compareNumeric(actual, operator, expected) {
  const left = toNumber(actual);
  const right = toNumber(expected);
  if (operator === "exists") return left != null;
  if (operator === "notExists") return left == null;
  if (left == null || right == null) return false;
  switch (operator) {
    case "equals":
      return left === right;
    case "notEquals":
      return left !== right;
    case "greaterThan":
      return left > right;
    case "greaterThanOrEqual":
      return left >= right;
    case "lessThan":
      return left < right;
    case "lessThanOrEqual":
      return left <= right;
    default:
      return compareScalar(String(actual), operator, String(expected));
  }
}

function compareScalar(actual, operator, expected) {
  const left = String(actual == null ? "" : actual);
  const right = String(expected == null ? "" : expected);
  const leftNormalized = left.toLowerCase();
  const rightNormalized = right.toLowerCase();

  switch (operator) {
    case "exists":
      return left.trim() !== "";
    case "notExists":
      return left.trim() === "";
    case "equals":
      return leftNormalized === rightNormalized;
    case "notEquals":
      return leftNormalized !== rightNormalized;
    case "contains":
      return rightNormalized ? leftNormalized.includes(rightNormalized) : leftNormalized !== "";
    case "notContains":
      return rightNormalized ? !leftNormalized.includes(rightNormalized) : leftNormalized === "";
    case "startsWith":
      return rightNormalized ? leftNormalized.startsWith(rightNormalized) : false;
    case "endsWith":
      return rightNormalized ? leftNormalized.endsWith(rightNormalized) : false;
    case "matchesRegex":
      try {
        return new RegExp(right || escapeRegex(right), "i").test(left);
      } catch (_) {
        return false;
      }
    default:
      return false;
  }
}

function collectMatchingAnalytics(analytics, tag, limit) {
  const normalizedTag = normalizeText(tag);
  const matches = (Array.isArray(analytics) ? analytics : []).filter((entry) => {
    if (!normalizedTag) return true;
    const vendor = normalizeText(entry.vendor);
    const tagName = normalizeText(entry.tagName);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases.map(normalizeText) : [];
    return vendor === normalizedTag
      || tagName === normalizedTag
      || aliases.includes(normalizedTag)
      || vendor.includes(normalizedTag)
      || tagName.includes(normalizedTag)
      || aliases.some((alias) => alias.includes(normalizedTag));
  });
  return limit > 0 ? matches.slice(0, limit) : matches;
}

function parseUrlParams(url) {
  try {
    return Object.fromEntries(new URL(url).searchParams.entries());
  } catch (_) {
    return {};
  }
}

function collectDataLayerText(entries, limit = 0) {
  const list = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    try {
      list.push(JSON.stringify(entry));
    } catch (_) {
      list.push(String(entry));
    }
    if (limit > 0 && list.length >= limit) break;
  }
  return list;
}

function collectValuesByPath(entries, path, limit = 0) {
  const keys = String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  const list = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const value = readPath(entry, keys);
    if (Array.isArray(value)) {
      for (const child of value) {
        list.push(child);
        if (limit > 0 && list.length >= limit) return list;
      }
      continue;
    }
    if (value != null) {
      list.push(value);
      if (limit > 0 && list.length >= limit) return list;
    }
  }
  return list;
}

function readPath(value, keys, index = 0) {
  if (value == null) return null;
  if (index >= keys.length) return value;

  if (Array.isArray(value)) {
    const nested = [];
    for (const item of value) {
      const child = readPath(item, keys, index);
      if (child == null) continue;
      if (Array.isArray(child)) nested.push(...child);
      else nested.push(child);
    }
    return nested.length ? nested : null;
  }

  return readPath(value[keys[index]], keys, index + 1);
}

function formatCollectionPreview(values) {
  if (!values.length) return "";
  return values
    .slice(0, 3)
    .map((value) => String(value))
    .join(" | ");
}

function selectPreviewValues(values, operator, expected) {
  if (!Array.isArray(values) || !values.length) return [];
  if (["contains", "equals", "startsWith", "endsWith", "matchesRegex"].includes(operator)) {
    const matched = values.filter((value) => compareScalar(value, operator, expected));
    if (matched.length) return matched;
  }
  if (["notContains", "notEquals"].includes(operator)) {
    const unmatched = values.filter((value) => !compareScalar(value, operator === "notContains" ? "contains" : "equals", expected));
    if (unmatched.length) return unmatched;
  }
  return values;
}

function summarizeRuleResults(pages, rules) {
  const ruleMap = new Map();
  for (const rule of rules) {
    ruleMap.set(rule.id, {
      id: rule.id,
      name: rule.name,
      passedPages: 0,
      failedPages: 0,
      skippedPages: 0,
    });
  }

  const totals = {
    configuredRules: rules.length,
    passedEvaluations: 0,
    failedEvaluations: 0,
    skippedEvaluations: 0,
    pagesWithFailedRules: 0,
    pagesWithPassedRules: 0,
  };

  for (const page of pages) {
    let pageHasFailure = false;
    let pageHasPass = false;
    for (const result of Array.isArray(page.ruleResults) ? page.ruleResults : []) {
      const summary = ruleMap.get(result.id);
      if (!summary) continue;
      if (result.status === "passed") {
        summary.passedPages += 1;
        totals.passedEvaluations += 1;
        pageHasPass = true;
      } else if (result.status === "failed") {
        summary.failedPages += 1;
        totals.failedEvaluations += 1;
        pageHasFailure = true;
      } else {
        summary.skippedPages += 1;
        totals.skippedEvaluations += 1;
      }
    }
    if (pageHasFailure) totals.pagesWithFailedRules += 1;
    if (pageHasPass) totals.pagesWithPassedRules += 1;
  }

  return {
    totals,
    rules: Array.from(ruleMap.values()),
  };
}

module.exports = {
  normalizeRules,
  evaluateRulesForPage,
  summarizeRuleResults,
};
