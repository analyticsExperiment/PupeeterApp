#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

const baseUrl = String(process.env.FREE_AUDIT_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
const envUsername = process.env.FREE_AUDIT_USERNAME || '';
const envPassword = process.env.FREE_AUDIT_PASSWORD || '';

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

class HttpError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

class SessionClient {
  constructor(rootUrl) {
    this.rootUrl = rootUrl;
    this.cookies = new Map();
  }

  absorbCookies(response) {
    const header = response.headers.get('set-cookie');
    if (!header) return;
    for (const part of header.split(/,(?=\s*[^;,\s]+=)/)) {
      const first = part.split(';')[0];
      const index = first.indexOf('=');
      if (index > 0) this.cookies.set(first.slice(0, index).trim(), first.slice(index + 1).trim());
    }
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  hasSession() {
    return this.cookies.has('audit.sid');
  }

  async request(route, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;

    const response = await fetch(`${this.rootUrl}${route}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    this.absorbCookies(response);
    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    let data = text;
    if (contentType.includes('application/json')) {
      try { data = text ? JSON.parse(text) : null; } catch (_) {}
    }
    if (!response.ok) {
      const message = typeof data === 'object' && data && data.error ? data.error : text || `HTTP ${response.status}`;
      throw new HttpError(message, response.status, data);
    }
    return data;
  }

  login(username, password) {
    return this.request('/auth/login', { method: 'POST', body: { username, password } });
  }

  register(username, password, displayName) {
    return this.request('/auth/register', { method: 'POST', body: { username, password, displayName: displayName || username } });
  }
}

const client = new SessionClient(baseUrl);

async function ensureSession() {
  if (client.hasSession()) return;
  if (!envUsername || !envPassword) {
    throw new Error('Not authenticated. Call free_audit_login first or set FREE_AUDIT_USERNAME and FREE_AUDIT_PASSWORD.');
  }
  await client.login(envUsername, envPassword);
}

function jsonToolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    isError
  };
}

function requireArg(args, name) {
  const value = args && args[name];
  if (value === undefined || value === null || value === '') throw new Error(`${name} is required`);
  return value;
}

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const idSchema = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false };
const limitSchema = { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false };
const anyObjectSchema = { type: 'object', additionalProperties: true };
const createAuditSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    run: { type: 'boolean' },
    config: { type: 'object', additionalProperties: true },
    preActionTemplates: { type: 'array', items: anyObjectSchema },
    postActionTemplates: { type: 'array', items: anyObjectSchema },
    ruleSets: { type: 'array', items: anyObjectSchema },
    rules: { type: 'array', items: anyObjectSchema }
  },
  required: ['name', 'config'],
  additionalProperties: true
};
const createInteractionSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    run: { type: 'boolean' },
    config: { type: 'object', additionalProperties: true },
    flowTemplates: { type: 'array', items: anyObjectSchema },
    flowTemplateIds: { type: 'array', items: { type: 'string' } },
    ruleSets: { type: 'array', items: anyObjectSchema },
    ruleSetIds: { type: 'array', items: { type: 'string' } }
  },
  required: ['name', 'config'],
  additionalProperties: true
};

function tool(name, description, inputSchema) {
  return { name, description, inputSchema };
}

const tools = [
  tool('free_audit_register', 'Register a Free Audit account and keep the returned session cookie for later tool calls.', {
    type: 'object',
    properties: { username: { type: 'string' }, password: { type: 'string' }, displayName: { type: 'string' } },
    required: ['username', 'password'],
    additionalProperties: false
  }),
  tool('free_audit_login', 'Login to Free Audit and keep the session cookie for later tool calls.', {
    type: 'object',
    properties: { username: { type: 'string' }, password: { type: 'string' } },
    required: ['username', 'password'],
    additionalProperties: false
  }),
  tool('free_audit_get_schema', 'Return the agent API schema: supported actions, rules, engines, waitUntil values, and examples.', emptySchema),
  tool('free_audit_list_audit_configs', 'List audit configs for the logged-in user.', emptySchema),
  tool('free_audit_get_audit_config', 'Get one audit config by id.', idSchema),
  tool('free_audit_create_audit_config', 'Create a saved audit config.', anyObjectSchema),
  tool('free_audit_update_audit_config', 'Update a saved audit config. Include id plus the full config fields.', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true }),
  tool('free_audit_delete_audit_config', 'Delete a saved audit config by id.', idSchema),
  tool('free_audit_duplicate_audit_config', 'Duplicate a saved audit config by id.', idSchema),
  tool('free_audit_create_audit', 'Create a complete audit setup from templates/rules/config and optionally run it.', createAuditSchema),
  tool('free_audit_start_audit', 'Start an audit directly from a runner payload.', anyObjectSchema),
  tool('free_audit_run_audit_config', 'Run an existing audit config by id.', { type: 'object', properties: { auditConfigId: { type: 'string' } }, required: ['auditConfigId'], additionalProperties: false }),
  tool('free_audit_get_audit_status', 'Get status/progress for an audit run.', { type: 'object', properties: { auditId: { type: 'string' } }, required: ['auditId'], additionalProperties: false }),
  tool('free_audit_get_audit_results', 'Get completed audit results JSON.', { type: 'object', properties: { auditId: { type: 'string' } }, required: ['auditId'], additionalProperties: false }),
  tool('free_audit_list_audits', 'List audit history for the logged-in user.', limitSchema),
  tool('free_audit_export_audit_json', 'Download completed audit JSON export.', { type: 'object', properties: { auditId: { type: 'string' } }, required: ['auditId'], additionalProperties: false }),
  tool('free_audit_export_audit_csv', 'Download completed audit CSV export as text.', { type: 'object', properties: { auditId: { type: 'string' } }, required: ['auditId'], additionalProperties: false }),
  tool('free_audit_list_action_templates', 'List Pre-Audit or On Page action templates (type pre or post).', { type: 'object', properties: { type: { type: 'string', enum: ['pre', 'post'] } }, additionalProperties: false }),
  tool('free_audit_get_action_template', 'Get one action template by id.', idSchema),
  tool('free_audit_create_action_template', 'Create an action template.', anyObjectSchema),
  tool('free_audit_update_action_template', 'Update an action template. Include id plus the full template fields.', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true }),
  tool('free_audit_delete_action_template', 'Delete an action template by id.', idSchema),
  tool('free_audit_duplicate_action_template', 'Duplicate an action template by id.', idSchema),
  tool('free_audit_list_rule_sets', 'List rule sets for the logged-in user.', emptySchema),
  tool('free_audit_get_rule_set', 'Get one rule set by id.', idSchema),
  tool('free_audit_create_rule_set', 'Create a rule set.', anyObjectSchema),
  tool('free_audit_update_rule_set', 'Update a rule set. Include id plus the full rule set fields.', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true }),
  tool('free_audit_delete_rule_set', 'Delete a rule set by id.', idSchema),
  tool('free_audit_duplicate_rule_set', 'Duplicate a rule set by id.', idSchema),
  tool('free_audit_list_interaction_flow_templates', 'List interaction flow templates for the logged-in user.', emptySchema),
  tool('free_audit_get_interaction_flow_template', 'Get one interaction flow template by id.', idSchema),
  tool('free_audit_create_interaction_flow_template', 'Create an interaction flow template.', anyObjectSchema),
  tool('free_audit_update_interaction_flow_template', 'Update an interaction flow template. Include id plus the full template fields.', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true }),
  tool('free_audit_delete_interaction_flow_template', 'Delete an interaction flow template by id.', idSchema),
  tool('free_audit_duplicate_interaction_flow_template', 'Duplicate an interaction flow template by id.', idSchema),
  tool('free_audit_list_interaction_configs', 'List interaction configs for the logged-in user.', emptySchema),
  tool('free_audit_get_interaction_config', 'Get one interaction config by id.', idSchema),
  tool('free_audit_create_interaction_config', 'Create a saved interaction config.', anyObjectSchema),
  tool('free_audit_update_interaction_config', 'Update a saved interaction config. Include id plus the full config fields.', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: true }),
  tool('free_audit_delete_interaction_config', 'Delete a saved interaction config by id.', idSchema),
  tool('free_audit_duplicate_interaction_config', 'Duplicate a saved interaction config by id.', idSchema),
  tool('free_audit_create_interaction', 'Create a complete interaction config/journey and optionally run it.', createInteractionSchema),
  tool('free_audit_run_interaction_config', 'Run an existing interaction config by id.', { type: 'object', properties: { interactionConfigId: { type: 'string' } }, required: ['interactionConfigId'], additionalProperties: false }),
  tool('free_audit_get_interaction_status', 'Get status/progress for an interaction run.', { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false }),
  tool('free_audit_get_interaction_results', 'Get completed interaction run results JSON.', { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false }),
  tool('free_audit_list_interaction_runs', 'List interaction run history for the logged-in user.', limitSchema),
  tool('free_audit_export_interaction_json', 'Download completed interaction JSON export.', { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false }),
  tool('free_audit_export_interaction_csv', 'Download completed interaction CSV export as text.', { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'], additionalProperties: false }),
  tool('free_audit_list_resources', 'List audits, audit configs, interaction configs, and interaction runs for the logged-in user.', limitSchema)
];

function withoutId(args) {
  const { id, ...body } = args || {};
  return body;
}

function limit(args) {
  return Math.min(Math.max(Number(args?.limit) || 50, 1), 500);
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'free_audit_register':
      return client.register(requireArg(args, 'username'), requireArg(args, 'password'), args.displayName);
    case 'free_audit_login':
      return client.login(requireArg(args, 'username'), requireArg(args, 'password'));
    case 'free_audit_get_schema':
      await ensureSession();
      return client.request('/api/agent/schema');
    case 'free_audit_list_audit_configs':
      await ensureSession();
      return client.request('/api/audit-configs');
    case 'free_audit_get_audit_config':
      await ensureSession();
      return client.request(`/api/audit-configs/${encodeURIComponent(requireArg(args, 'id'))}`);
    case 'free_audit_create_audit_config':
      await ensureSession();
      return client.request('/api/audit-configs', { method: 'POST', body: args });
    case 'free_audit_update_audit_config':
      await ensureSession();
      return client.request(`/api/audit-configs/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'PUT', body: withoutId(args) });
    case 'free_audit_delete_audit_config':
      await ensureSession();
      return client.request(`/api/audit-configs/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'DELETE' });
    case 'free_audit_duplicate_audit_config':
      await ensureSession();
      return client.request(`/api/audit-configs/${encodeURIComponent(requireArg(args, 'id'))}/duplicate`, { method: 'POST', body: {} });
    case 'free_audit_create_audit':
      await ensureSession();
      return client.request('/api/agent/audits', { method: 'POST', body: args });
    case 'free_audit_start_audit':
      await ensureSession();
      return client.request('/api/audit/start', { method: 'POST', body: args });
    case 'free_audit_run_audit_config':
      await ensureSession();
      return client.request(`/api/agent/audits/${encodeURIComponent(requireArg(args, 'auditConfigId'))}/run`, { method: 'POST', body: {} });
    case 'free_audit_get_audit_status':
      await ensureSession();
      return client.request(`/api/audit/${encodeURIComponent(requireArg(args, 'auditId'))}/status`);
    case 'free_audit_get_audit_results':
      await ensureSession();
      return client.request(`/api/audit/${encodeURIComponent(requireArg(args, 'auditId'))}/results`);
    case 'free_audit_list_audits':
      await ensureSession();
      return client.request(`/api/audits?limit=${limit(args)}`);
    case 'free_audit_export_audit_json':
      await ensureSession();
      return client.request(`/api/audit/${encodeURIComponent(requireArg(args, 'auditId'))}/json`);
    case 'free_audit_export_audit_csv':
      await ensureSession();
      return { csv: await client.request(`/api/audit/${encodeURIComponent(requireArg(args, 'auditId'))}/csv`) };
    case 'free_audit_list_action_templates':
      await ensureSession();
      return client.request(`/api/action-templates?type=${encodeURIComponent(args.type || 'pre')}`);
    case 'free_audit_get_action_template':
      await ensureSession();
      return client.request(`/api/action-templates/${encodeURIComponent(requireArg(args, 'id'))}`);
    case 'free_audit_create_action_template':
      await ensureSession();
      return client.request('/api/action-templates', { method: 'POST', body: args });
    case 'free_audit_update_action_template':
      await ensureSession();
      return client.request(`/api/action-templates/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'PUT', body: withoutId(args) });
    case 'free_audit_delete_action_template':
      await ensureSession();
      return client.request(`/api/action-templates/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'DELETE' });
    case 'free_audit_duplicate_action_template':
      await ensureSession();
      return client.request(`/api/action-templates/${encodeURIComponent(requireArg(args, 'id'))}/duplicate`, { method: 'POST', body: {} });
    case 'free_audit_list_rule_sets':
      await ensureSession();
      return client.request('/api/rule-sets');
    case 'free_audit_get_rule_set':
      await ensureSession();
      return client.request(`/api/rule-sets/${encodeURIComponent(requireArg(args, 'id'))}`);
    case 'free_audit_create_rule_set':
      await ensureSession();
      return client.request('/api/rule-sets', { method: 'POST', body: args });
    case 'free_audit_update_rule_set':
      await ensureSession();
      return client.request(`/api/rule-sets/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'PUT', body: withoutId(args) });
    case 'free_audit_delete_rule_set':
      await ensureSession();
      return client.request(`/api/rule-sets/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'DELETE' });
    case 'free_audit_duplicate_rule_set':
      await ensureSession();
      return client.request(`/api/rule-sets/${encodeURIComponent(requireArg(args, 'id'))}/duplicate`, { method: 'POST', body: {} });
    case 'free_audit_list_interaction_flow_templates':
      await ensureSession();
      return client.request('/api/interaction-flow-templates');
    case 'free_audit_get_interaction_flow_template':
      await ensureSession();
      return client.request(`/api/interaction-flow-templates/${encodeURIComponent(requireArg(args, 'id'))}`);
    case 'free_audit_create_interaction_flow_template':
      await ensureSession();
      return client.request('/api/interaction-flow-templates', { method: 'POST', body: args });
    case 'free_audit_update_interaction_flow_template':
      await ensureSession();
      return client.request(`/api/interaction-flow-templates/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'PUT', body: withoutId(args) });
    case 'free_audit_delete_interaction_flow_template':
      await ensureSession();
      return client.request(`/api/interaction-flow-templates/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'DELETE' });
    case 'free_audit_duplicate_interaction_flow_template':
      await ensureSession();
      return client.request(`/api/interaction-flow-templates/${encodeURIComponent(requireArg(args, 'id'))}/duplicate`, { method: 'POST', body: {} });
    case 'free_audit_list_interaction_configs':
      await ensureSession();
      return client.request('/api/interaction-configs');
    case 'free_audit_get_interaction_config':
      await ensureSession();
      return client.request(`/api/interaction-configs/${encodeURIComponent(requireArg(args, 'id'))}`);
    case 'free_audit_create_interaction_config':
      await ensureSession();
      return client.request('/api/interaction-configs', { method: 'POST', body: args });
    case 'free_audit_update_interaction_config':
      await ensureSession();
      return client.request(`/api/interaction-configs/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'PUT', body: withoutId(args) });
    case 'free_audit_delete_interaction_config':
      await ensureSession();
      return client.request(`/api/interaction-configs/${encodeURIComponent(requireArg(args, 'id'))}`, { method: 'DELETE' });
    case 'free_audit_duplicate_interaction_config':
      await ensureSession();
      return client.request(`/api/interaction-configs/${encodeURIComponent(requireArg(args, 'id'))}/duplicate`, { method: 'POST', body: {} });
    case 'free_audit_create_interaction':
      await ensureSession();
      return client.request('/api/agent/interactions', { method: 'POST', body: args });
    case 'free_audit_run_interaction_config':
      await ensureSession();
      return client.request(`/api/agent/interactions/${encodeURIComponent(requireArg(args, 'interactionConfigId'))}/run`, { method: 'POST', body: {} });
    case 'free_audit_get_interaction_status':
      await ensureSession();
      return client.request(`/api/interaction-runs/${encodeURIComponent(requireArg(args, 'runId'))}/status`);
    case 'free_audit_get_interaction_results':
      await ensureSession();
      return client.request(`/api/interaction-runs/${encodeURIComponent(requireArg(args, 'runId'))}/results`);
    case 'free_audit_list_interaction_runs':
      await ensureSession();
      return client.request(`/api/interaction-runs?limit=${limit(args)}`);
    case 'free_audit_export_interaction_json':
      await ensureSession();
      return client.request(`/api/interaction-runs/${encodeURIComponent(requireArg(args, 'runId'))}/json`);
    case 'free_audit_export_interaction_csv':
      await ensureSession();
      return { csv: await client.request(`/api/interaction-runs/${encodeURIComponent(requireArg(args, 'runId'))}/csv`) };
    case 'free_audit_list_resources': {
      await ensureSession();
      const safeLimit = limit(args);
      const [auditConfigs, audits, interactionConfigs, interactionRuns] = await Promise.all([
        client.request('/api/audit-configs'),
        client.request(`/api/audits?limit=${safeLimit}`),
        client.request('/api/interaction-configs'),
        client.request(`/api/interaction-runs?limit=${safeLimit}`)
      ]);
      return { auditConfigs, audits, interactionConfigs, interactionRuns };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: 'free-audit-mcp', title: 'Free Audit MCP', version: '1.1.0' },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    return jsonToolResult(await callTool(params.name, params.arguments || {}));
  } catch (err) {
    const data = err instanceof HttpError ? { status: err.status, response: err.data } : {};
    return jsonToolResult({ error: err.message || String(err), ...data }, true);
  }
});
server.connect(new StdioServerTransport()).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
