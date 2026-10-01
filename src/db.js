const fs = require("fs");
const path = require("path");
const { randomUUID, randomBytes, createHash } = require("crypto");
const Database = require("better-sqlite3");

const dbPath = process.env.FREE_AUDIT_DB_PATH
  ? path.resolve(process.env.FREE_AUDIT_DB_PATH)
  : path.join(__dirname, "..", "data", "audits.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  username TEXT,
  domain TEXT,
  status TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  payload_json TEXT,
  request_headers_json TEXT,
  summary_json TEXT,
  results_json TEXT,
  error_text TEXT
);`);

db.exec(`CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL
);`);

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function addColumnIfMissing(tableName, columnName, ddl) {
  if (hasColumn(tableName, columnName)) return;
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
  } catch (err) {
    if (!String(err.message || err).includes("duplicate column")) {
      throw err;
    }
  }
}

addColumnIfMissing("audits", "username", "username TEXT");
addColumnIfMissing("audits", "config_id", "config_id TEXT");
addColumnIfMissing("audits", "config_snapshot_json", "config_snapshot_json TEXT");
db.exec("UPDATE audits SET username = COALESCE(username, 'guest') WHERE username IS NULL OR username = ''");

db.exec(`
CREATE TABLE IF NOT EXISTS audit_configs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  domain TEXT,
  max_pages INTEGER,
  max_depth INTEGER,
  same_origin_only INTEGER,
  wait_until TEXT,
  show_browser INTEGER,
  url_sources_json TEXT,
  include_sitemaps INTEGER,
  options_json TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS action_templates (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  steps_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_sets (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  rules_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction_flow_templates (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  steps_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_config_action_templates (
  id TEXT PRIMARY KEY,
  audit_config_id TEXT NOT NULL,
  action_template_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (audit_config_id) REFERENCES audit_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (action_template_id) REFERENCES action_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_config_rule_sets (
  id TEXT PRIMARY KEY,
  audit_config_id TEXT NOT NULL,
  rule_set_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (audit_config_id) REFERENCES audit_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_config_flow_templates (
  id TEXT PRIMARY KEY,
  audit_config_id TEXT NOT NULL,
  flow_template_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (audit_config_id) REFERENCES audit_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (flow_template_id) REFERENCES interaction_flow_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interaction_configs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  starting_url TEXT,
  wait_until TEXT,
  show_browser INTEGER,
  general_settings_json TEXT,
  steps_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS interaction_config_templates (
  id TEXT PRIMARY KEY,
  interaction_config_id TEXT NOT NULL,
  interaction_flow_template_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (interaction_config_id) REFERENCES interaction_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (interaction_flow_template_id) REFERENCES interaction_flow_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interaction_config_rule_sets (
  id TEXT PRIMARY KEY,
  interaction_config_id TEXT NOT NULL,
  rule_set_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (interaction_config_id) REFERENCES interaction_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_set_id) REFERENCES rule_sets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS interaction_runs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  interaction_config_id TEXT,
  config_snapshot_json TEXT,
  status TEXT,
  progress INTEGER,
  results_json TEXT,
  error_text TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audits_username_started ON audits(username, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_config_id ON audits(config_id);
CREATE INDEX IF NOT EXISTS idx_audit_configs_username_updated ON audit_configs(username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_templates_username_type ON action_templates(username, type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rule_sets_username_updated ON rule_sets(username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_templates_username_updated ON interaction_flow_templates(username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_configs_username_updated ON interaction_configs(username, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_runs_username_created ON interaction_runs(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_runs_config ON interaction_runs(interaction_config_id);

CREATE TABLE IF NOT EXISTS extension_tokens (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_extension_tokens_username_created ON extension_tokens(username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extension_tokens_hash ON extension_tokens(token_hash);
`);

function normalizeAuditUsername(username) {
  return typeof username === "string" && username.trim() ? username.trim() : "guest";
}

function normalizeAccountUsername(username) {
  if (typeof username !== "string") return "";
  return username.trim().toLowerCase();
}

function toJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch (err) {
    return null;
  }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function boolToInt(value) {
  return value ? 1 : 0;
}

function intToBool(value, fallback = false) {
  if (value === null || value === undefined) return fallback;
  return Boolean(value);
}

function now() {
  return Date.now();
}

function ensureId(id) {
  return id || randomUUID();
}

function normalizeTemplateType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return normalized === "post" ? "post" : "pre";
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

const insertAuditStmt = db.prepare(`INSERT INTO audits (
  id, username, domain, status, started_at, completed_at, payload_json, request_headers_json, summary_json, results_json, error_text, config_id, config_snapshot_json
) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?)`);
const updateAuditStmt = db.prepare(`UPDATE audits SET status = ?, completed_at = ?, summary_json = ?, request_headers_json = ?, results_json = ?, error_text = ? WHERE id = ?`);
const updateAuditProgressStmt = db.prepare("UPDATE audits SET summary_json = ?, results_json = ? WHERE id = ? AND status = 'running'");
const updateHeadersStmt = db.prepare(`UPDATE audits SET request_headers_json = ? WHERE id = ?`);
const selectAuditStmt = db.prepare("SELECT * FROM audits WHERE id = ? AND username = ?");
const listAuditsStmt = db.prepare(`
  SELECT a.id, a.domain, a.status, a.started_at, a.completed_at, a.summary_json, a.error_text,
         a.config_id, a.config_snapshot_json, c.name AS config_name
  FROM audits a
  LEFT JOIN audit_configs c ON c.id = a.config_id AND c.username = a.username
  WHERE a.username = ?
  ORDER BY a.started_at DESC
  LIMIT ?
`);
const selectUserStmt = db.prepare("SELECT username, password_hash, display_name, created_at FROM users WHERE username = ?");
const insertUserStmt = db.prepare("INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)");

function recordAuditStart({ id, username, domain, startedAt, payload, requestHeaders, configId, configSnapshot }) {
  insertAuditStmt.run(
    id,
    normalizeAuditUsername(username),
    domain || "",
    "running",
    startedAt || now(),
    toJson(payload || {}),
    toJson(requestHeaders || {}),
    configId || null,
    toJson(configSnapshot || null)
  );
}

function recordAuditCompletion({ id, completedAt, results }) {
  updateAuditStmt.run(
    "completed",
    completedAt || now(),
    toJson(results?.summary || null),
    toJson(results?.requestHeaders || null),
    toJson(results || null),
    null,
    id
  );
}

function recordAuditProgress({ id, results }) {
  return updateAuditProgressStmt.run(toJson(results?.summary || null), toJson(results || null), id).changes;
}

function recordAuditFailure({ id, completedAt, error, requestHeaders }) {
  updateAuditStmt.run(
    "failed",
    completedAt || now(),
    null,
    toJson(requestHeaders || null),
    null,
    error ? String(error) : null,
    id
  );
}

function updateAuditHeaders(id, headers) {
  updateHeadersStmt.run(toJson(headers || null), id);
}

function listAudits(username, limit = 50) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 500) : 50;
  const user = normalizeAuditUsername(username);
  return listAuditsStmt.all(user, safeLimit).map((row) => ({
    id: row.id,
    domain: row.domain,
    status: row.status,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    summary: parseJson(row.summary_json),
    error: row.error_text || null,
    configId: row.config_id || null,
    configName: row.config_name || parseJson(row.config_snapshot_json, {})?.name || null,
    configSnapshot: parseJson(row.config_snapshot_json)
  }));
}

function getAudit(id, username) {
  const row = selectAuditStmt.get(id, normalizeAuditUsername(username));
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    status: row.status,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    payload: parseJson(row.payload_json),
    requestHeaders: parseJson(row.request_headers_json),
    summary: parseJson(row.summary_json),
    results: parseJson(row.results_json),
    error: row.error_text || null,
    configId: row.config_id || null,
    configSnapshot: parseJson(row.config_snapshot_json),
    configName: parseJson(row.config_snapshot_json, {})?.name || null
  };
}

function getUser(username) {
  const normalized = normalizeAccountUsername(username);
  if (!normalized) return null;
  const row = selectUserStmt.get(normalized);
  if (!row) return null;
  return {
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name || row.username,
    createdAt: row.created_at
  };
}

function createUser({ username, passwordHash, displayName }) {
  const normalized = normalizeAccountUsername(username);
  if (!normalized) {
    throw new Error("Username is required");
  }
  if (!passwordHash || typeof passwordHash !== "string") {
    throw new Error("passwordHash is required");
  }

  const createdAt = now();
  insertUserStmt.run(normalized, passwordHash, displayName || normalized, createdAt);
  return {
    username: normalized,
    displayName: displayName || normalized,
    createdAt
  };
}

function hashExtensionToken(token) {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function mapExtensionTokenRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    label: row.label || "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    active: !row.revoked_at
  };
}

const insertExtensionTokenStmt = db.prepare(`
  INSERT INTO extension_tokens (id, username, token_hash, label, created_at, last_used_at, revoked_at)
  VALUES (?, ?, ?, ?, ?, NULL, NULL)
`);
const listExtensionTokensStmt = db.prepare(`
  SELECT id, username, label, created_at, last_used_at, revoked_at
  FROM extension_tokens
  WHERE username = ?
  ORDER BY created_at DESC
`);
const revokeExtensionTokenStmt = db.prepare(`
  UPDATE extension_tokens SET revoked_at = ? WHERE id = ? AND username = ? AND revoked_at IS NULL
`);
const selectExtensionTokenByHashStmt = db.prepare(`
  SELECT id, username, label, created_at, last_used_at, revoked_at
  FROM extension_tokens
  WHERE token_hash = ? AND revoked_at IS NULL
`);
const updateExtensionTokenLastUsedStmt = db.prepare("UPDATE extension_tokens SET last_used_at = ? WHERE id = ?");

function createExtensionToken(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const id = ensureId(input.id);
  const token = `fat_${randomBytes(32).toString("base64url")}`;
  const label = String(input.label || "Chrome Recorder").trim().slice(0, 120);
  const createdAt = now();
  insertExtensionTokenStmt.run(id, user, hashExtensionToken(token), label, createdAt);
  return {
    id,
    username: user,
    label,
    createdAt,
    lastUsedAt: null,
    revokedAt: null,
    active: true,
    token
  };
}

function listExtensionTokens(username) {
  return listExtensionTokensStmt.all(normalizeAuditUsername(username)).map(mapExtensionTokenRow);
}

function revokeExtensionToken(id, username) {
  return revokeExtensionTokenStmt.run(now(), id, normalizeAuditUsername(username)).changes > 0;
}

function getUserForExtensionToken(token) {
  const tokenText = String(token || "").trim();
  if (!tokenText) return null;
  const row = selectExtensionTokenByHashStmt.get(hashExtensionToken(tokenText));
  if (!row) return null;
  updateExtensionTokenLastUsedStmt.run(now(), row.id);
  return {
    username: row.username,
    token: mapExtensionTokenRow({ ...row, last_used_at: now() })
  };
}

function mapConfigRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description || "",
    domain: row.domain || "",
    maxPages: row.max_pages || 15,
    maxDepth: row.max_depth == null ? null : row.max_depth,
    sameOriginOnly: intToBool(row.same_origin_only, true),
    waitUntil: row.wait_until || "domcontentloaded",
    showBrowser: intToBool(row.show_browser, true),
    urlSources: parseJson(row.url_sources_json, []),
    includeSitemaps: intToBool(row.include_sitemaps, true),
    options: parseJson(row.options_json, {}),
    isDefault: Boolean(row.is_default),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    auditCount: row.audit_count || 0
  };
}

function mapActionTemplateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description || "",
    type: row.type,
    steps: parseJson(row.steps_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order == null ? null : row.sort_order
  };
}

function mapRuleSetRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description || "",
    rules: parseJson(row.rules_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order == null ? null : row.sort_order
  };
}

function mapFlowTemplateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description || "",
    steps: parseJson(row.steps_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order == null ? null : row.sort_order
  };
}

function mapInteractionConfigRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    description: row.description || "",
    startingUrl: row.starting_url || "",
    waitUntil: row.wait_until || "domcontentloaded",
    showBrowser: intToBool(row.show_browser, true),
    generalSettings: parseJson(row.general_settings_json, {}),
    steps: parseJson(row.steps_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    runCount: row.run_count || 0,
    lastRunStatus: row.last_run_status || null,
    lastRunAt: row.last_run_at || null
  };
}

function mapInteractionRunRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    interactionConfigId: row.interaction_config_id || null,
    configSnapshot: parseJson(row.config_snapshot_json),
    status: row.status || "unknown",
    progress: row.progress || 0,
    results: parseJson(row.results_json),
    error: row.error_text || null,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    configName: row.config_name || parseJson(row.config_snapshot_json, {})?.name || null
  };
}

const listConfigStmt = db.prepare(`
  SELECT c.*, (SELECT COUNT(1) FROM audits a WHERE a.username = c.username AND a.config_id = c.id) AS audit_count
  FROM audit_configs c
  WHERE c.username = ?
  ORDER BY c.is_default DESC, c.updated_at DESC
`);
const selectConfigStmt = db.prepare(`
  SELECT c.*, (SELECT COUNT(1) FROM audits a WHERE a.username = c.username AND a.config_id = c.id) AS audit_count
  FROM audit_configs c
  WHERE c.id = ? AND c.username = ?
`);
const insertConfigStmt = db.prepare(`
  INSERT INTO audit_configs (
    id, username, name, description, domain, max_pages, max_depth, same_origin_only, wait_until,
    show_browser, url_sources_json, include_sitemaps, options_json, is_default, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateConfigStmt = db.prepare(`
  UPDATE audit_configs SET
    name = ?, description = ?, domain = ?, max_pages = ?, max_depth = ?, same_origin_only = ?,
    wait_until = ?, show_browser = ?, url_sources_json = ?, include_sitemaps = ?, options_json = ?,
    is_default = ?, updated_at = ?
  WHERE id = ? AND username = ?
`);
const deleteConfigStmt = db.prepare("DELETE FROM audit_configs WHERE id = ? AND username = ?");
const unsetDefaultConfigStmt = db.prepare("UPDATE audit_configs SET is_default = 0 WHERE username = ? AND id <> ?");

function normalizeConfigInput(input = {}) {
  return {
    name: requiredText(input.name, "Config name"),
    description: String(input.description || "").trim(),
    domain: String(input.domain || "").trim(),
    maxPages: Math.max(1, Number.parseInt(input.maxPages ?? input.max_pages ?? 15, 10) || 15),
    maxDepth: input.maxDepth == null && input.max_depth == null ? null : Math.max(0, Number.parseInt(input.maxDepth ?? input.max_depth, 10) || 0),
    sameOriginOnly: input.sameOriginOnly !== false && input.same_origin_only !== false,
    waitUntil: String(input.waitUntil || input.wait_until || "domcontentloaded").trim() || "domcontentloaded",
    showBrowser: input.showBrowser !== false && input.show_browser !== false,
    urlSources: normalizeList(input.urlSources || input.url_sources),
    includeSitemaps: input.includeSitemaps !== false && input.include_sitemaps !== false,
    options: input.options && typeof input.options === "object" ? input.options : {},
    isDefault: Boolean(input.isDefault || input.is_default)
  };
}

function hydrateConfig(config, username) {
  if (!config) return null;
  const user = normalizeAuditUsername(username || config.username);
  const preActionTemplates = db.prepare(`
    SELECT t.*, l.sort_order
    FROM audit_config_action_templates l
    JOIN action_templates t ON t.id = l.action_template_id
    WHERE l.audit_config_id = ? AND t.username = ? AND t.type = 'pre'
    ORDER BY l.sort_order ASC, t.updated_at DESC
  `).all(config.id, user).map(mapActionTemplateRow);
  const postActionTemplates = db.prepare(`
    SELECT t.*, l.sort_order
    FROM audit_config_action_templates l
    JOIN action_templates t ON t.id = l.action_template_id
    WHERE l.audit_config_id = ? AND t.username = ? AND t.type = 'post'
    ORDER BY l.sort_order ASC, t.updated_at DESC
  `).all(config.id, user).map(mapActionTemplateRow);
  const ruleSets = db.prepare(`
    SELECT r.*, l.sort_order
    FROM audit_config_rule_sets l
    JOIN rule_sets r ON r.id = l.rule_set_id
    WHERE l.audit_config_id = ? AND r.username = ?
    ORDER BY l.sort_order ASC, r.updated_at DESC
  `).all(config.id, user).map(mapRuleSetRow);
  const flowTemplates = db.prepare(`
    SELECT f.*, l.sort_order
    FROM audit_config_flow_templates l
    JOIN interaction_flow_templates f ON f.id = l.flow_template_id
    WHERE l.audit_config_id = ? AND f.username = ?
    ORDER BY l.sort_order ASC, f.updated_at DESC
  `).all(config.id, user).map(mapFlowTemplateRow);
  return { ...config, preActionTemplates, postActionTemplates, ruleSets, flowTemplates };
}

function listAuditConfigs(username) {
  return listConfigStmt.all(normalizeAuditUsername(username)).map(mapConfigRow);
}

function getAuditConfig(id, username, hydrate = true) {
  const config = mapConfigRow(selectConfigStmt.get(id, normalizeAuditUsername(username)));
  return hydrate ? hydrateConfig(config, username) : config;
}

function replaceConfigLinks(configId, username, data = {}) {
  const user = normalizeAuditUsername(username);
  const preIds = normalizeList(data.preActionTemplateIds);
  const postIds = normalizeList(data.postActionTemplateIds);
  const ruleIds = normalizeList(data.ruleSetIds);
  const flowIds = normalizeList(data.flowTemplateIds);

  db.prepare("DELETE FROM audit_config_action_templates WHERE audit_config_id = ?").run(configId);
  db.prepare("DELETE FROM audit_config_rule_sets WHERE audit_config_id = ?").run(configId);
  db.prepare("DELETE FROM audit_config_flow_templates WHERE audit_config_id = ?").run(configId);

  const insertActionLink = db.prepare("INSERT INTO audit_config_action_templates (id, audit_config_id, action_template_id, sort_order) VALUES (?, ?, ?, ?)");
  const insertRuleLink = db.prepare("INSERT INTO audit_config_rule_sets (id, audit_config_id, rule_set_id, sort_order) VALUES (?, ?, ?, ?)");
  const insertFlowLink = db.prepare("INSERT INTO audit_config_flow_templates (id, audit_config_id, flow_template_id, sort_order) VALUES (?, ?, ?, ?)");
  const canUseAction = db.prepare("SELECT id FROM action_templates WHERE id = ? AND username = ? AND type = ?");
  const canUseRule = db.prepare("SELECT id FROM rule_sets WHERE id = ? AND username = ?");
  const canUseFlow = db.prepare("SELECT id FROM interaction_flow_templates WHERE id = ? AND username = ?");

  [...preIds.map((id) => ({ id, type: "pre" })), ...postIds.map((id) => ({ id, type: "post" }))].forEach((item, index) => {
    if (canUseAction.get(item.id, user, item.type)) {
      insertActionLink.run(randomUUID(), configId, item.id, index);
    }
  });
  ruleIds.forEach((id, index) => {
    if (canUseRule.get(id, user)) insertRuleLink.run(randomUUID(), configId, id, index);
  });
  flowIds.forEach((id, index) => {
    if (canUseFlow.get(id, user)) insertFlowLink.run(randomUUID(), configId, id, index);
  });
}

function createAuditConfig(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const data = normalizeConfigInput(input);
  const ts = now();
  const id = ensureId(input.id);
  const tx = db.transaction(() => {
    if (data.isDefault) unsetDefaultConfigStmt.run(user, id);
    insertConfigStmt.run(
      id,
      user,
      data.name,
      data.description,
      data.domain,
      data.maxPages,
      data.maxDepth,
      boolToInt(data.sameOriginOnly),
      data.waitUntil,
      boolToInt(data.showBrowser),
      toJson(data.urlSources),
      boolToInt(data.includeSitemaps),
      toJson(data.options),
      boolToInt(data.isDefault),
      ts,
      ts
    );
    replaceConfigLinks(id, user, input);
  });
  tx();
  return getAuditConfig(id, user);
}

function updateAuditConfig(id, username, input = {}) {
  const user = normalizeAuditUsername(username);
  if (!getAuditConfig(id, user, false)) return null;
  const data = normalizeConfigInput(input);
  const ts = now();
  const tx = db.transaction(() => {
    if (data.isDefault) unsetDefaultConfigStmt.run(user, id);
    updateConfigStmt.run(
      data.name,
      data.description,
      data.domain,
      data.maxPages,
      data.maxDepth,
      boolToInt(data.sameOriginOnly),
      data.waitUntil,
      boolToInt(data.showBrowser),
      toJson(data.urlSources),
      boolToInt(data.includeSitemaps),
      toJson(data.options),
      boolToInt(data.isDefault),
      ts,
      id,
      user
    );
    replaceConfigLinks(id, user, input);
  });
  tx();
  return getAuditConfig(id, user);
}

function deleteAuditConfig(id, username) {
  return deleteConfigStmt.run(id, normalizeAuditUsername(username)).changes > 0;
}

function duplicateAuditConfig(id, username) {
  const source = getAuditConfig(id, username);
  if (!source) return null;
  const input = {
    ...source,
    id: randomUUID(),
    name: `${source.name} Copy`,
    isDefault: false,
    preActionTemplateIds: source.preActionTemplates.map((item) => item.id),
    postActionTemplateIds: source.postActionTemplates.map((item) => item.id),
    ruleSetIds: source.ruleSets.map((item) => item.id)
  };
  return createAuditConfig(username, input);
}

const listActionStmt = db.prepare("SELECT * FROM action_templates WHERE username = ? AND type = ? ORDER BY updated_at DESC");
const selectActionStmt = db.prepare("SELECT * FROM action_templates WHERE id = ? AND username = ?");
const insertActionStmt = db.prepare("INSERT INTO action_templates (id, username, name, description, type, steps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
const updateActionStmt = db.prepare("UPDATE action_templates SET name = ?, description = ?, type = ?, steps_json = ?, updated_at = ? WHERE id = ? AND username = ?");
const deleteActionStmt = db.prepare("DELETE FROM action_templates WHERE id = ? AND username = ?");

function normalizeActionTemplateInput(input = {}) {
  return {
    name: requiredText(input.name, "Template name"),
    description: String(input.description || "").trim(),
    type: normalizeTemplateType(input.type),
    steps: normalizeList(input.steps)
  };
}

function listActionTemplates(username, type = "pre") {
  return listActionStmt.all(normalizeAuditUsername(username), normalizeTemplateType(type)).map(mapActionTemplateRow);
}

function getActionTemplate(id, username) {
  return mapActionTemplateRow(selectActionStmt.get(id, normalizeAuditUsername(username)));
}

function createActionTemplate(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const data = normalizeActionTemplateInput(input);
  const id = ensureId(input.id);
  const ts = now();
  insertActionStmt.run(id, user, data.name, data.description, data.type, toJson(data.steps), ts, ts);
  return getActionTemplate(id, user);
}

function updateActionTemplate(id, username, input = {}) {
  const user = normalizeAuditUsername(username);
  if (!getActionTemplate(id, user)) return null;
  const data = normalizeActionTemplateInput(input);
  updateActionStmt.run(data.name, data.description, data.type, toJson(data.steps), now(), id, user);
  return getActionTemplate(id, user);
}

function deleteActionTemplate(id, username) {
  return deleteActionStmt.run(id, normalizeAuditUsername(username)).changes > 0;
}

function duplicateActionTemplate(id, username) {
  const source = getActionTemplate(id, username);
  if (!source) return null;
  return createActionTemplate(username, { ...source, id: randomUUID(), name: `${source.name} Copy` });
}

const listRuleSetStmt = db.prepare("SELECT * FROM rule_sets WHERE username = ? ORDER BY updated_at DESC");
const selectRuleSetStmt = db.prepare("SELECT * FROM rule_sets WHERE id = ? AND username = ?");
const insertRuleSetStmt = db.prepare("INSERT INTO rule_sets (id, username, name, description, rules_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const updateRuleSetStmt = db.prepare("UPDATE rule_sets SET name = ?, description = ?, rules_json = ?, updated_at = ? WHERE id = ? AND username = ?");
const deleteRuleSetStmt = db.prepare("DELETE FROM rule_sets WHERE id = ? AND username = ?");

function normalizeRuleSetInput(input = {}) {
  return {
    name: requiredText(input.name, "Rule set name"),
    description: String(input.description || "").trim(),
    rules: normalizeList(input.rules)
  };
}

function listRuleSets(username) {
  return listRuleSetStmt.all(normalizeAuditUsername(username)).map(mapRuleSetRow);
}

function getRuleSet(id, username) {
  return mapRuleSetRow(selectRuleSetStmt.get(id, normalizeAuditUsername(username)));
}

function createRuleSet(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const data = normalizeRuleSetInput(input);
  const id = ensureId(input.id);
  const ts = now();
  insertRuleSetStmt.run(id, user, data.name, data.description, toJson(data.rules), ts, ts);
  return getRuleSet(id, user);
}

function updateRuleSet(id, username, input = {}) {
  const user = normalizeAuditUsername(username);
  if (!getRuleSet(id, user)) return null;
  const data = normalizeRuleSetInput(input);
  updateRuleSetStmt.run(data.name, data.description, toJson(data.rules), now(), id, user);
  return getRuleSet(id, user);
}

function deleteRuleSet(id, username) {
  return deleteRuleSetStmt.run(id, normalizeAuditUsername(username)).changes > 0;
}

function duplicateRuleSet(id, username) {
  const source = getRuleSet(id, username);
  if (!source) return null;
  return createRuleSet(username, { ...source, id: randomUUID(), name: `${source.name} Copy` });
}

const listFlowStmt = db.prepare("SELECT * FROM interaction_flow_templates WHERE username = ? ORDER BY updated_at DESC");
const selectFlowStmt = db.prepare("SELECT * FROM interaction_flow_templates WHERE id = ? AND username = ?");
const insertFlowStmt = db.prepare("INSERT INTO interaction_flow_templates (id, username, name, description, steps_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
const updateFlowStmt = db.prepare("UPDATE interaction_flow_templates SET name = ?, description = ?, steps_json = ?, updated_at = ? WHERE id = ? AND username = ?");
const deleteFlowStmt = db.prepare("DELETE FROM interaction_flow_templates WHERE id = ? AND username = ?");

function normalizeFlowTemplateInput(input = {}) {
  return {
    name: requiredText(input.name, "Flow name"),
    description: String(input.description || "").trim(),
    steps: normalizeList(input.steps)
  };
}

function listFlowTemplates(username) {
  return listFlowStmt.all(normalizeAuditUsername(username)).map(mapFlowTemplateRow);
}

function getFlowTemplate(id, username) {
  return mapFlowTemplateRow(selectFlowStmt.get(id, normalizeAuditUsername(username)));
}

function createFlowTemplate(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const data = normalizeFlowTemplateInput(input);
  const id = ensureId(input.id);
  const ts = now();
  insertFlowStmt.run(id, user, data.name, data.description, toJson(data.steps), ts, ts);
  return getFlowTemplate(id, user);
}

function updateFlowTemplate(id, username, input = {}) {
  const user = normalizeAuditUsername(username);
  if (!getFlowTemplate(id, user)) return null;
  const data = normalizeFlowTemplateInput(input);
  updateFlowStmt.run(data.name, data.description, toJson(data.steps), now(), id, user);
  return getFlowTemplate(id, user);
}

function deleteFlowTemplate(id, username) {
  return deleteFlowStmt.run(id, normalizeAuditUsername(username)).changes > 0;
}

function duplicateFlowTemplate(id, username) {
  const source = getFlowTemplate(id, username);
  if (!source) return null;
  return createFlowTemplate(username, { ...source, id: randomUUID(), name: `${source.name} Copy` });
}

const listInteractionConfigStmt = db.prepare(`
  SELECT c.*,
         (SELECT COUNT(1) FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id) AS run_count,
         (SELECT r.status FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
         (SELECT r.created_at FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at
  FROM interaction_configs c
  WHERE c.username = ? AND c.deleted_at IS NULL
  ORDER BY c.updated_at DESC
`);
const selectInteractionConfigStmt = db.prepare(`
  SELECT c.*,
         (SELECT COUNT(1) FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id) AS run_count,
         (SELECT r.status FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_status,
         (SELECT r.created_at FROM interaction_runs r WHERE r.username = c.username AND r.interaction_config_id = c.id ORDER BY r.created_at DESC LIMIT 1) AS last_run_at
  FROM interaction_configs c
  WHERE c.id = ? AND c.username = ? AND c.deleted_at IS NULL
`);
const insertInteractionConfigStmt = db.prepare(`
  INSERT INTO interaction_configs (
    id, username, name, description, starting_url, wait_until, show_browser,
    general_settings_json, steps_json, created_at, updated_at, deleted_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
`);
const updateInteractionConfigStmt = db.prepare(`
  UPDATE interaction_configs SET
    name = ?, description = ?, starting_url = ?, wait_until = ?, show_browser = ?,
    general_settings_json = ?, steps_json = ?, updated_at = ?
  WHERE id = ? AND username = ? AND deleted_at IS NULL
`);
const softDeleteInteractionConfigStmt = db.prepare("UPDATE interaction_configs SET deleted_at = ?, updated_at = ? WHERE id = ? AND username = ? AND deleted_at IS NULL");

function normalizeInteractionConfigInput(input = {}) {
  const settings = input.generalSettings && typeof input.generalSettings === "object"
    ? input.generalSettings
    : (input.general_settings && typeof input.general_settings === "object" ? input.general_settings : {});
  return {
    name: requiredText(input.name, "Interaction config name"),
    description: String(input.description || "").trim(),
    startingUrl: requiredText(input.startingUrl || input.starting_url, "Starting URL"),
    waitUntil: String(input.waitUntil || input.wait_until || "domcontentloaded").trim() || "domcontentloaded",
    showBrowser: input.showBrowser !== false && input.show_browser !== false,
    generalSettings: settings,
    steps: normalizeList(input.steps)
  };
}

function hydrateInteractionConfig(config, username) {
  if (!config) return null;
  const user = normalizeAuditUsername(username || config.username);
  const flowTemplates = db.prepare(`
    SELECT f.*, l.sort_order
    FROM interaction_config_templates l
    JOIN interaction_flow_templates f ON f.id = l.interaction_flow_template_id
    WHERE l.interaction_config_id = ? AND f.username = ?
    ORDER BY l.sort_order ASC, f.updated_at DESC
  `).all(config.id, user).map(mapFlowTemplateRow);
  const ruleSets = db.prepare(`
    SELECT r.*, l.sort_order
    FROM interaction_config_rule_sets l
    JOIN rule_sets r ON r.id = l.rule_set_id
    WHERE l.interaction_config_id = ? AND r.username = ?
    ORDER BY l.sort_order ASC, r.updated_at DESC
  `).all(config.id, user).map(mapRuleSetRow);
  return { ...config, flowTemplates, ruleSets };
}

function replaceInteractionConfigLinks(configId, username, input = {}) {
  const user = normalizeAuditUsername(username);
  const templateIds = normalizeList(input.flowTemplateIds || input.templateIds);
  const ruleSetIds = normalizeList(input.ruleSetIds);

  db.prepare("DELETE FROM interaction_config_templates WHERE interaction_config_id = ?").run(configId);
  db.prepare("DELETE FROM interaction_config_rule_sets WHERE interaction_config_id = ?").run(configId);

  const insertTemplateLink = db.prepare("INSERT INTO interaction_config_templates (id, interaction_config_id, interaction_flow_template_id, sort_order) VALUES (?, ?, ?, ?)");
  const insertRuleLink = db.prepare("INSERT INTO interaction_config_rule_sets (id, interaction_config_id, rule_set_id, sort_order) VALUES (?, ?, ?, ?)");
  const canUseTemplate = db.prepare("SELECT id FROM interaction_flow_templates WHERE id = ? AND username = ?");
  const canUseRule = db.prepare("SELECT id FROM rule_sets WHERE id = ? AND username = ?");

  templateIds.forEach((id, index) => {
    if (canUseTemplate.get(id, user)) insertTemplateLink.run(randomUUID(), configId, id, index);
  });
  ruleSetIds.forEach((id, index) => {
    if (canUseRule.get(id, user)) insertRuleLink.run(randomUUID(), configId, id, index);
  });
}

function listInteractionConfigs(username) {
  return listInteractionConfigStmt.all(normalizeAuditUsername(username)).map(mapInteractionConfigRow);
}

function getInteractionConfig(id, username, hydrate = true) {
  const config = mapInteractionConfigRow(selectInteractionConfigStmt.get(id, normalizeAuditUsername(username)));
  return hydrate ? hydrateInteractionConfig(config, username) : config;
}

function createInteractionConfig(username, input = {}) {
  const user = normalizeAuditUsername(username);
  const data = normalizeInteractionConfigInput(input);
  const id = ensureId(input.id);
  const ts = now();
  const tx = db.transaction(() => {
    insertInteractionConfigStmt.run(
      id,
      user,
      data.name,
      data.description,
      data.startingUrl,
      data.waitUntil,
      boolToInt(data.showBrowser),
      toJson(data.generalSettings),
      toJson(data.steps),
      ts,
      ts
    );
    replaceInteractionConfigLinks(id, user, input);
  });
  tx();
  return getInteractionConfig(id, user);
}

function updateInteractionConfig(id, username, input = {}) {
  const user = normalizeAuditUsername(username);
  if (!getInteractionConfig(id, user, false)) return null;
  const data = normalizeInteractionConfigInput(input);
  const ts = now();
  const tx = db.transaction(() => {
    updateInteractionConfigStmt.run(
      data.name,
      data.description,
      data.startingUrl,
      data.waitUntil,
      boolToInt(data.showBrowser),
      toJson(data.generalSettings),
      toJson(data.steps),
      ts,
      id,
      user
    );
    replaceInteractionConfigLinks(id, user, input);
  });
  tx();
  return getInteractionConfig(id, user);
}

function deleteInteractionConfig(id, username) {
  const ts = now();
  return softDeleteInteractionConfigStmt.run(ts, ts, id, normalizeAuditUsername(username)).changes > 0;
}

function duplicateInteractionConfig(id, username) {
  const source = getInteractionConfig(id, username);
  if (!source) return null;
  return createInteractionConfig(username, {
    ...source,
    id: randomUUID(),
    name: `${source.name} Copy`,
    flowTemplateIds: source.flowTemplates.map((item) => item.id),
    ruleSetIds: source.ruleSets.map((item) => item.id)
  });
}

const insertInteractionRunStmt = db.prepare(`
  INSERT INTO interaction_runs (
    id, username, interaction_config_id, config_snapshot_json, status, progress,
    results_json, error_text, started_at, completed_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)
`);
const updateInteractionRunCompleteStmt = db.prepare(`
  UPDATE interaction_runs SET status = ?, progress = ?, results_json = ?, error_text = ?, completed_at = ?, updated_at = ? WHERE id = ? AND username = ?
`);
const updateInteractionRunProgressStmt = db.prepare("UPDATE interaction_runs SET progress = ?, updated_at = ? WHERE id = ? AND username = ?");
const selectInteractionRunStmt = db.prepare(`
  SELECT r.*, c.name AS config_name
  FROM interaction_runs r
  LEFT JOIN interaction_configs c ON c.id = r.interaction_config_id AND c.username = r.username
  WHERE r.id = ? AND r.username = ?
`);
const listInteractionRunsStmt = db.prepare(`
  SELECT r.id, r.username, r.interaction_config_id, r.config_snapshot_json, r.status, r.progress,
         r.error_text, r.started_at, r.completed_at, r.created_at, r.updated_at, c.name AS config_name
  FROM interaction_runs r
  LEFT JOIN interaction_configs c ON c.id = r.interaction_config_id AND c.username = r.username
  WHERE r.username = ?
  ORDER BY r.created_at DESC
  LIMIT ?
`);

function recordInteractionRunStart({ id, username, interactionConfigId, configSnapshot, startedAt }) {
  const ts = now();
  insertInteractionRunStmt.run(
    id,
    normalizeAuditUsername(username),
    interactionConfigId || null,
    toJson(configSnapshot || null),
    "running",
    0,
    startedAt || ts,
    ts,
    ts
  );
}

function updateInteractionRunProgress(id, username, progress) {
  updateInteractionRunProgressStmt.run(Math.max(0, Number(progress) || 0), now(), id, normalizeAuditUsername(username));
}

function recordInteractionRunCompletion({ id, username, completedAt, results }) {
  updateInteractionRunCompleteStmt.run(
    "completed",
    100,
    toJson(results || null),
    null,
    completedAt || now(),
    now(),
    id,
    normalizeAuditUsername(username)
  );
}

function recordInteractionRunFailure({ id, username, completedAt, error, results }) {
  updateInteractionRunCompleteStmt.run(
    "failed",
    100,
    toJson(results || null),
    error ? String(error) : null,
    completedAt || now(),
    now(),
    id,
    normalizeAuditUsername(username)
  );
}

function getInteractionRun(id, username) {
  return mapInteractionRunRow(selectInteractionRunStmt.get(id, normalizeAuditUsername(username)));
}

function listInteractionRuns(username, limit = 50) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 500) : 50;
  return listInteractionRunsStmt.all(normalizeAuditUsername(username), safeLimit).map(mapInteractionRunRow);
}

module.exports = {
  recordAuditStart,
  recordAuditCompletion,
  recordAuditProgress,
  recordAuditFailure,
  updateAuditHeaders,
  listAudits,
  getAudit,
  getUser,
  createUser,
  createExtensionToken,
  listExtensionTokens,
  revokeExtensionToken,
  getUserForExtensionToken,
  listAuditConfigs,
  getAuditConfig,
  createAuditConfig,
  updateAuditConfig,
  deleteAuditConfig,
  duplicateAuditConfig,
  listActionTemplates,
  getActionTemplate,
  createActionTemplate,
  updateActionTemplate,
  deleteActionTemplate,
  duplicateActionTemplate,
  listRuleSets,
  getRuleSet,
  createRuleSet,
  updateRuleSet,
  deleteRuleSet,
  duplicateRuleSet,
  listFlowTemplates,
  getFlowTemplate,
  createFlowTemplate,
  updateFlowTemplate,
  deleteFlowTemplate,
  duplicateFlowTemplate
  ,
  listInteractionConfigs,
  getInteractionConfig,
  createInteractionConfig,
  updateInteractionConfig,
  deleteInteractionConfig,
  duplicateInteractionConfig,
  recordInteractionRunStart,
  updateInteractionRunProgress,
  recordInteractionRunCompletion,
  recordInteractionRunFailure,
  getInteractionRun,
  listInteractionRuns
};
