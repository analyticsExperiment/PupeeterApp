const auditStore = require('../db');
const { assembleAuditPayload, buildConfigSnapshot } = require('../audit/configAssembler');

const ACTION_TYPES = [
  'click',
  'type',
  'waitForSelector',
  'waitForTimeout',
  'hover',
  'scroll',
  'navigate',
  'openUrl',
  'navigateToUrl',
  'pageRefresh',
  'switchToIFrame',
  'switchToMainFrame',
  'executeJavaScript',
  'fillFormField',
  'selectDropdownOption',
  'checkCheckbox',
  'uncheckCheckbox',
  'uploadFile',
  'pressKey',
  'waitForNavigation',
  'waitForNetworkIdle',
  'waitForRequestMatching',
  'waitForResponseMatching',
  'captureStepSnapshot',
  'assertElementExists',
  'assertElementText',
  'assertUrlContains'
];

const WAIT_UNTIL_VALUES = ['domcontentloaded', 'load', 'networkidle2'];
const BROWSER_ENGINES = ['playwright', 'puppeteer'];
const WORKER_MODES = ['ram-protected', 'custom', '5', '10'];

const RULE_SUBJECTS = [
  'initialUrl',
  'finalUrl',
  'pageTitle',
  'initialStatusCode',
  'finalStatusCode',
  'tagVendor',
  'tagName',
  'requestUrl',
  'cookieName',
  'dataLayer',
  'consoleText'
];

const RULE_ASSERTION_TYPES = [
  'tagPresence',
  'tagParam',
  'requestUrl',
  'pageField',
  'cookie',
  'dataLayer',
  'console'
];

const RULE_OPERATORS = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'matchesRegex',
  'exists',
  'notExists',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
  'countEquals',
  'countAtLeast',
  'countAtMost'
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) {
    const err = new Error(`${label} is required`);
    err.statusCode = 400;
    throw err;
  }
  return text;
}

function normalizeWaitUntil(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'networkidle' || normalized === 'networkidle0') return 'networkidle2';
  return WAIT_UNTIL_VALUES.includes(normalized) ? normalized : 'domcontentloaded';
}

function normalizeBrowserEngine(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return BROWSER_ENGINES.includes(normalized) ? normalized : 'playwright';
}

function normalizeBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return value !== false && value !== 'false' && value !== 0 && value !== '0';
}

function optionalPositiveInt(value, label, fallback, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const err = new Error(`${label} must be a non-negative number`);
    err.statusCode = 400;
    throw err;
  }
  const integer = Math.floor(numeric);
  return max ? Math.min(integer, max) : integer;
}

function requiredPositiveInt(value, label, fallback, max) {
  const numeric = optionalPositiveInt(value, label, fallback, max);
  if (!Number.isFinite(numeric) || numeric < 1) {
    const err = new Error(`${label} must be at least 1`);
    err.statusCode = 400;
    throw err;
  }
  return numeric;
}

function validateUrl(value, label) {
  const text = requiredText(value, label);
  try {
    const parsed = new URL(text);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch (_) {
    const err = new Error(`${label} must be a valid http(s) URL`);
    err.statusCode = 400;
    throw err;
  }
}

function validateOptionalDomain(value, label) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return validateUrl(text, label);
  if (!/^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(text)) {
    const err = new Error(`${label} must be a valid domain or http(s) URL`);
    err.statusCode = 400;
    throw err;
  }
  return text;
}

function normalizeUrlList(value, label) {
  return asArray(value).map((item, index) => validateUrl(item, `${label}[${index}]`));
}

function assertKnownAction(action, label) {
  if (!ACTION_TYPES.includes(action)) {
    const err = new Error(`${label} action "${action}" is not supported`);
    err.statusCode = 400;
    throw err;
  }
}

function normalizeActionStep(step = {}, index = 0) {
  const action = requiredText(step.action || 'click', `Step ${index + 1} action`);
  assertKnownAction(action, `Step ${index + 1}`);
  const selector = String(step.selector || '').trim();
  const value = step.value == null ? '' : String(step.value);
  const normalized = {
    action
  };

  if (step.id) normalized.id = String(step.id);
  if (step.name || step.stepName) normalized.name = String(step.name || step.stepName).trim();
  if (selector) normalized.selector = selector;
  if (value) normalized.value = value;

  if (step.timeout !== undefined && step.timeout !== '') {
    normalized.timeout = optionalPositiveInt(step.timeout, `Step ${index + 1} timeout`, 0, 120000);
  }
  if (step.waitAfter !== undefined && step.waitAfter !== '') {
    normalized.waitAfter = optionalPositiveInt(step.waitAfter, `Step ${index + 1} waitAfter`, 0, 120000);
  }
  if (step.iframeSelector || step.contextSelector) normalized.iframeSelector = String(step.iframeSelector || step.contextSelector).trim();
  if (step.notes || step.description) normalized.notes = String(step.notes || step.description).trim();
  if (step.enabled === false) normalized.enabled = false;
  if (step.captureStepSnapshot) normalized.captureStepSnapshot = true;

  const actionKey = action.toLowerCase();
  if (['navigate', 'openurl', 'navigatetourl'].includes(actionKey)) {
    const url = validateUrl(value || selector, `Step ${index + 1} navigation URL`);
    normalized.value = url;
    delete normalized.selector;
  }
  if (['click', 'type', 'fillformfield', 'hover', 'waitforselector', 'selectdropdownoption', 'checkcheckbox', 'uncheckcheckbox', 'uploadfile', 'assertelementexists', 'assertelementtext'].includes(actionKey) && !selector) {
    const err = new Error(`Step ${index + 1} ${action} requires selector`);
    err.statusCode = 400;
    throw err;
  }
  if (actionKey === 'executejavascript' && !value) {
    const err = new Error(`Step ${index + 1} executeJavaScript requires value`);
    err.statusCode = 400;
    throw err;
  }
  if (actionKey === 'waitfortimeout') {
    const timeout = step.timeout !== undefined ? step.timeout : (value || 1000);
    normalized.timeout = optionalPositiveInt(timeout, `Step ${index + 1} waitForTimeout`, 1000, 120000);
  }
  if (['waitforrequestmatching', 'waitforresponsematching', 'asserturlcontains'].includes(actionKey) && !value) {
    const err = new Error(`Step ${index + 1} ${action} requires value`);
    err.statusCode = 400;
    throw err;
  }

  return normalized;
}

function normalizeSteps(steps, label) {
  return asArray(steps).map((step, index) => normalizeActionStep(step, index, label));
}

function normalizeRule(rule = {}, index = 0) {
  const conditions = asArray(rule.conditions).map((condition, conditionIndex) => {
    const subject = requiredText(condition.subject, `Rule ${index + 1} condition ${conditionIndex + 1} subject`);
    if (!RULE_SUBJECTS.includes(subject)) {
      const err = new Error(`Rule ${index + 1} condition subject "${subject}" is not supported`);
      err.statusCode = 400;
      throw err;
    }
    const operator = String(condition.operator || 'contains').trim();
    if (!RULE_OPERATORS.includes(operator)) {
      const err = new Error(`Rule ${index + 1} condition operator "${operator}" is not supported`);
      err.statusCode = 400;
      throw err;
    }
    return {
      subject,
      operator,
      value: condition.value == null ? '' : String(condition.value)
    };
  });
  const assertions = asArray(rule.assertions).map((assertion, assertionIndex) => {
    const type = requiredText(assertion.type || 'tagPresence', `Rule ${index + 1} assertion ${assertionIndex + 1} type`);
    if (!RULE_ASSERTION_TYPES.includes(type)) {
      const err = new Error(`Rule ${index + 1} assertion type "${type}" is not supported`);
      err.statusCode = 400;
      throw err;
    }
    const operator = String(assertion.operator || 'exists').trim();
    if (!RULE_OPERATORS.includes(operator)) {
      const err = new Error(`Rule ${index + 1} assertion operator "${operator}" is not supported`);
      err.statusCode = 400;
      throw err;
    }
    return {
      type,
      tag: assertion.tag == null ? '' : String(assertion.tag),
      field: assertion.field == null ? '' : String(assertion.field),
      operator,
      value: assertion.value == null ? '' : String(assertion.value),
      description: assertion.description == null ? '' : String(assertion.description)
    };
  });
  if (!assertions.length) {
    const err = new Error(`Rule ${index + 1} must include at least one assertion`);
    err.statusCode = 400;
    throw err;
  }
  return {
    id: String(rule.id || `rule-${index + 1}`),
    name: String(rule.name || `Rule ${index + 1}`).trim(),
    whenMode: String(rule.whenMode || 'all').toLowerCase() === 'any' ? 'any' : 'all',
    expectMode: String(rule.expectMode || 'all').toLowerCase() === 'any' ? 'any' : 'all',
    evaluationLimit: requiredPositiveInt(rule.evaluationLimit || 1, `Rule ${index + 1} evaluationLimit`, 1, 100),
    conditions,
    assertions
  };
}

function normalizeRules(rules) {
  return asArray(rules).map((rule, index) => normalizeRule(rule, index));
}

function findByName(items, name) {
  const target = String(name || '').trim().toLowerCase();
  return asArray(items).find((item) => String(item.name || '').trim().toLowerCase() === target) || null;
}

function getTemplateById(username, id, type) {
  const template = auditStore.getActionTemplate(id, username);
  if (!template || template.type !== type) {
    const err = new Error(`${type === 'pre' ? 'Pre-audit' : 'On Page'} action template not found: ${id}`);
    err.statusCode = 404;
    throw err;
  }
  return template;
}

function upsertActionTemplate(username, input = {}, type) {
  const id = input.id || input.templateId || null;
  const name = requiredText(input.name, `${type === 'pre' ? 'Pre-audit' : 'On Page'} template name`);
  const payload = {
    name,
    description: String(input.description || '').trim(),
    type,
    steps: normalizeSteps(input.steps, `${type} action template`)
  };
  if (id) {
    getTemplateById(username, id, type);
    return { template: auditStore.updateActionTemplate(id, username, payload), action: 'updated' };
  }
  const existing = findByName(auditStore.listActionTemplates(username, type), name);
  if (existing) {
    return { template: auditStore.updateActionTemplate(existing.id, username, payload), action: 'updated' };
  }
  return { template: auditStore.createActionTemplate(username, payload), action: 'created' };
}

function upsertRuleSet(username, input = {}) {
  const id = input.id || input.ruleSetId || null;
  const payload = {
    name: requiredText(input.name, 'Rule set name'),
    description: String(input.description || '').trim(),
    rules: normalizeRules(input.rules)
  };
  if (id) {
    if (!auditStore.getRuleSet(id, username)) {
      const err = new Error(`Rule set not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return { ruleSet: auditStore.updateRuleSet(id, username, payload), action: 'updated' };
  }
  const existing = findByName(auditStore.listRuleSets(username), payload.name);
  if (existing) {
    return { ruleSet: auditStore.updateRuleSet(existing.id, username, payload), action: 'updated' };
  }
  return { ruleSet: auditStore.createRuleSet(username, payload), action: 'created' };
}

function upsertFlowTemplate(username, input = {}) {
  const id = input.id || input.templateId || input.flowTemplateId || null;
  const payload = {
    name: requiredText(input.name, 'Interaction flow template name'),
    description: String(input.description || '').trim(),
    steps: normalizeSteps(input.steps, 'interaction flow template')
  };
  if (id) {
    if (!auditStore.getFlowTemplate(id, username)) {
      const err = new Error(`Interaction flow template not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return { template: auditStore.updateFlowTemplate(id, username, payload), action: 'updated' };
  }
  const existing = findByName(auditStore.listFlowTemplates(username), payload.name);
  if (existing) {
    return { template: auditStore.updateFlowTemplate(existing.id, username, payload), action: 'updated' };
  }
  return { template: auditStore.createFlowTemplate(username, payload), action: 'created' };
}

function validateActionTemplateIds(username, ids, type) {
  return asArray(ids).map((id) => getTemplateById(username, id, type).id);
}

function validateRuleSetIds(username, ids) {
  return asArray(ids).map((id) => {
    const ruleSet = auditStore.getRuleSet(id, username);
    if (!ruleSet) {
      const err = new Error(`Rule set not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return ruleSet.id;
  });
}

function validateFlowTemplateIds(username, ids) {
  return asArray(ids).map((id) => {
    const template = auditStore.getFlowTemplate(id, username);
    if (!template) {
      const err = new Error(`Interaction flow template not found: ${id}`);
      err.statusCode = 404;
      throw err;
    }
    return template.id;
  });
}

function buildAgentSchema() {
  return {
    ok: true,
    schema: {
      waitUntilValues: WAIT_UNTIL_VALUES,
      browserEngines: BROWSER_ENGINES,
      workerModes: WORKER_MODES,
      actionTypes: ACTION_TYPES,
      ruleSubjects: RULE_SUBJECTS,
      ruleAssertionTypes: RULE_ASSERTION_TYPES,
      ruleOperators: RULE_OPERATORS,
      endpoints: {
        buildAudit: 'POST /api/agent/audits',
        buildInteraction: 'POST /api/agent/interactions',
        runAuditConfig: 'POST /api/agent/audits/:id/run',
        runInteractionConfig: 'POST /api/agent/interactions/:id/run'
      },
      auditExample: {
        name: 'Example API Audit',
        run: true,
        config: {
          domain: 'https://example.com',
          urlSources: ['https://example.com'],
          maxPages: 1,
          sameOriginOnly: true,
          waitUntil: 'domcontentloaded',
          showBrowser: false,
          options: { browserEngine: 'playwright' }
        },
        preActionTemplates: [{ name: 'Accept Consent', steps: [{ action: 'click', selector: '#accept' }] }],
        ruleSets: [{ name: 'URL Rules', rules: [{ name: 'Final URL exists', assertions: [{ type: 'pageField', field: 'finalUrl', operator: 'exists' }] }] }]
      },
      interactionExample: {
        name: 'Example Journey',
        run: true,
        config: {
          startingUrl: 'https://example.com',
          steps: [{ action: 'openUrl', value: 'https://example.com' }]
        }
      }
    }
  };
}

function createAgentAudit(username, input = {}) {
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const created = {
    preActionTemplateIds: [],
    postActionTemplateIds: [],
    ruleSetIds: [],
    upserts: []
  };

  const preActionTemplateIds = [
    ...validateActionTemplateIds(username, input.preActionTemplateIds || config.preActionTemplateIds, 'pre')
  ];
  for (const templateInput of asArray(input.preActionTemplates || config.preActionTemplates)) {
    const result = upsertActionTemplate(username, templateInput, 'pre');
    preActionTemplateIds.push(result.template.id);
    created.preActionTemplateIds.push(result.template.id);
    created.upserts.push({ type: 'preActionTemplate', action: result.action, id: result.template.id, name: result.template.name });
  }

  const postActionTemplateIds = [
    ...validateActionTemplateIds(username, input.postActionTemplateIds || config.postActionTemplateIds, 'post')
  ];
  for (const templateInput of asArray(input.postActionTemplates || input.onPageActionTemplates || config.postActionTemplates)) {
    const result = upsertActionTemplate(username, templateInput, 'post');
    postActionTemplateIds.push(result.template.id);
    created.postActionTemplateIds.push(result.template.id);
    created.upserts.push({ type: 'postActionTemplate', action: result.action, id: result.template.id, name: result.template.name });
  }

  const ruleSetIds = [
    ...validateRuleSetIds(username, input.ruleSetIds || config.ruleSetIds)
  ];
  for (const ruleSetInput of asArray(input.ruleSets || config.ruleSets)) {
    const result = upsertRuleSet(username, ruleSetInput);
    ruleSetIds.push(result.ruleSet.id);
    created.ruleSetIds.push(result.ruleSet.id);
    created.upserts.push({ type: 'ruleSet', action: result.action, id: result.ruleSet.id, name: result.ruleSet.name });
  }

  const urlSources = normalizeUrlList(config.urlSources || input.urlSources || [], 'urlSources');
  const domain = validateOptionalDomain(config.domain || input.domain || urlSources[0] || '', 'Audit domain');
  if (!domain && !urlSources.length) {
    const err = new Error('Audit domain or at least one urlSources item is required');
    err.statusCode = 400;
    throw err;
  }
  const options = {
    ...(config.options && typeof config.options === 'object' ? config.options : {}),
    ...(input.options && typeof input.options === 'object' ? input.options : {})
  };
  if (config.browserEngine || input.browserEngine || options.browserEngine) {
    options.browserEngine = normalizeBrowserEngine(config.browserEngine || input.browserEngine || options.browserEngine);
  }
  if (config.workerMode || input.workerMode || options.workerMode) options.workerMode = String(config.workerMode || input.workerMode || options.workerMode);
  const requestedWorkers = config.simultaneousWorkers ?? input.simultaneousWorkers ?? options.simultaneousWorkers;
  if (requestedWorkers !== undefined && requestedWorkers !== null && requestedWorkers !== '') {
    options.simultaneousWorkers = requiredPositiveInt(requestedWorkers, 'simultaneousWorkers', 1, 20);
  }

  const inlinePreActions = normalizeSteps(input.preAuditActions || config.preAuditActions || options.preAuditActions, 'inline pre-audit actions');
  const inlinePostActions = normalizeSteps(input.postAuditActions || input.onPageActions || config.postAuditActions || config.onPageActions || options.postAuditActions || options.onPageActions, 'inline On Page actions');
  const inlineRules = normalizeRules(input.rules || config.rules || options.rules);
  if (inlinePreActions.length) options.preAuditActions = inlinePreActions;
  if (inlinePostActions.length) {
    options.postAuditActions = inlinePostActions;
    options.onPageActions = inlinePostActions;
  }
  if (inlineRules.length) options.rules = inlineRules;

  const configInput = {
    name: requiredText(input.name || config.name, 'Audit config name'),
    description: String(input.description || config.description || '').trim(),
    domain,
    maxPages: requiredPositiveInt(config.maxPages ?? input.maxPages, 'maxPages', 15, 500),
    maxDepth: config.maxDepth === undefined && input.maxDepth === undefined ? null : optionalPositiveInt(config.maxDepth ?? input.maxDepth, 'maxDepth', 0, 50),
    sameOriginOnly: normalizeBool(config.sameOriginOnly ?? input.sameOriginOnly, true),
    waitUntil: normalizeWaitUntil(config.waitUntil || input.waitUntil),
    showBrowser: normalizeBool(config.showBrowser ?? input.showBrowser, true),
    urlSources,
    includeSitemaps: normalizeBool(config.includeSitemaps ?? input.includeSitemaps, true),
    options,
    isDefault: Boolean(config.isDefault || input.isDefault),
    preActionTemplateIds,
    postActionTemplateIds,
    ruleSetIds
  };

  const auditConfig = auditStore.createAuditConfig(username, configInput);
  const assembledPayload = assembleAuditPayload(auditConfig);
  const configSnapshot = buildConfigSnapshot(auditConfig, assembledPayload);
  return { auditConfig, assembledPayload, configSnapshot, created };
}

function createAgentInteraction(username, input = {}) {
  const config = input.config && typeof input.config === 'object' ? input.config : {};
  const created = {
    flowTemplateIds: [],
    ruleSetIds: [],
    upserts: []
  };

  const flowTemplateIds = [
    ...validateFlowTemplateIds(username, input.flowTemplateIds || input.templateIds || config.flowTemplateIds || config.templateIds)
  ];
  for (const templateInput of asArray(input.flowTemplates || config.flowTemplates)) {
    const result = upsertFlowTemplate(username, templateInput);
    flowTemplateIds.push(result.template.id);
    created.flowTemplateIds.push(result.template.id);
    created.upserts.push({ type: 'interactionFlowTemplate', action: result.action, id: result.template.id, name: result.template.name });
  }

  const ruleSetIds = [
    ...validateRuleSetIds(username, input.ruleSetIds || config.ruleSetIds)
  ];
  for (const ruleSetInput of asArray(input.ruleSets || config.ruleSets)) {
    const result = upsertRuleSet(username, ruleSetInput);
    ruleSetIds.push(result.ruleSet.id);
    created.ruleSetIds.push(result.ruleSet.id);
    created.upserts.push({ type: 'ruleSet', action: result.action, id: result.ruleSet.id, name: result.ruleSet.name });
  }

  const generalSettings = {
    ...(config.generalSettings && typeof config.generalSettings === 'object' ? config.generalSettings : {}),
    ...(input.generalSettings && typeof input.generalSettings === 'object' ? input.generalSettings : {})
  };
  if (generalSettings.browserEngine || config.browserEngine || input.browserEngine) {
    generalSettings.browserEngine = normalizeBrowserEngine(generalSettings.browserEngine || config.browserEngine || input.browserEngine);
  }
  const inlineRules = normalizeRules(input.rules || config.rules || generalSettings.rules);
  if (inlineRules.length) generalSettings.rules = inlineRules;

  const interactionConfigInput = {
    name: requiredText(input.name || config.name, 'Interaction config name'),
    description: String(input.description || config.description || '').trim(),
    startingUrl: validateUrl(config.startingUrl || config.starting_url || input.startingUrl || input.starting_url, 'Interaction startingUrl'),
    waitUntil: normalizeWaitUntil(config.waitUntil || input.waitUntil),
    showBrowser: normalizeBool(config.showBrowser ?? input.showBrowser, true),
    generalSettings,
    steps: normalizeSteps(config.steps || input.steps || [], 'interaction steps'),
    flowTemplateIds,
    ruleSetIds
  };

  const interactionConfig = auditStore.createInteractionConfig(username, interactionConfigInput);
  return { interactionConfig, created };
}

module.exports = {
  ACTION_TYPES,
  WAIT_UNTIL_VALUES,
  BROWSER_ENGINES,
  RULE_SUBJECTS,
  RULE_ASSERTION_TYPES,
  RULE_OPERATORS,
  buildAgentSchema,
  createAgentAudit,
  createAgentInteraction
};
