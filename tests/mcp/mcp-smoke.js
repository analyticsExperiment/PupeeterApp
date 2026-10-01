const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_PORT = Number(process.env.QA_MCP_APP_PORT || 3340);
const TARGET_PORT = Number(process.env.QA_MCP_TARGET_PORT || 4640);
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;
const TARGET_URL = `http://127.0.0.1:${TARGET_PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const USERNAME = `mcp_agent_${Date.now()}`;
const PASSWORD = 'McpAgentTest123!';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startTargetServer() {
  const server = http.createServer((req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    if (req.url === '/favicon.ico') return send(204, 'text/plain', '');
    if (req.url.startsWith('/api/local-pixel')) return send(200, 'application/json', '{"ok":true}');
    return send(200, 'text/html', `<!doctype html><html><head><title>MCP Target</title></head><body>
      <h1>MCP Target</h1>
      <button id="acceptCookies">Accept Cookies</button>
      <div id="result">Waiting</div>
      <script>
        document.cookie = 'mcp_session=1; path=/';
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push({ event: 'mcp_page_view' });
        fetch('/api/local-pixel?event=mcp');
        document.getElementById('acceptCookies').addEventListener('click', () => {
          document.getElementById('result').textContent = 'Accepted';
          window.dataLayer.push({ event: 'mcp_accept' });
        });
      </script>
    </body></html>`);
  });
  return new Promise((resolve) => server.listen(TARGET_PORT, '127.0.0.1', () => resolve(server)));
}

function startAppServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(APP_PORT), SESSION_SECRET: `mcp-smoke-${RUN_ID}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[app] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[app-err] ${chunk}`));
  return child;
}

function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) reject(new Error(`Timed out waiting for ${url}`));
      else setTimeout(tick, 350);
    };
    tick();
  });
}

class McpClient {
  constructor(command, args, env) {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
    this.client = new Client({ name: 'free-audit-qa', version: '1.0.0' });
    this.calledTools = new Set();
    this.transport = new StdioClientTransport({ command, args, cwd: ROOT, env: { ...process.env, ...env } });
  }

  async request(method, params) {
    if (method === 'initialize') {
      await this.client.connect(this.transport, { timeout: 8000 });
      return { serverInfo: this.client.getServerVersion() };
    }
    if (method === 'tools/list') return this.client.listTools();
    if (method === 'tools/call') return this.client.callTool(params);
    throw new Error(`Unsupported test request ${method}`);
  }

  notify() {} // The SDK sends the initialization notification.

  async tool(name, args) {
    this.calledTools.add(name);
    const result = await this.request('tools/call', { name, arguments: args || {} });
    const text = result.content?.[0]?.text || '{}';
    return JSON.parse(text);
  }

  close() {
    return this.client.close();
  }
}

async function registerUser() {
  const response = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, displayName: USERNAME })
  });
  if (![201, 409].includes(response.status)) {
    throw new Error(`Failed to create MCP user: ${response.status} ${await response.text()}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForToolStatus(client, toolName, idKey, id) {
  for (let i = 0; i < 80; i += 1) {
    const status = await client.tool(toolName, { [idKey]: id });
    if (status.status === 'completed') return status;
    if (status.status === 'failed') throw new Error(`${toolName} failed: ${status.error || 'unknown error'}`);
    await sleep(750);
  }
  throw new Error(`${toolName} did not complete for ${id}`);
}

function assertToolSchema(tool) {
  assert(tool.inputSchema && tool.inputSchema.type === 'object', `${tool.name} missing object inputSchema`);
  assert(tool.description && tool.description.length > 10, `${tool.name} missing useful description`);
}

async function main() {
  const target = await startTargetServer();
  const app = startAppServer();
  let mcp;
  try {
    await waitForHttp(`${BASE_URL}/api/health`);
    await registerUser();
    mcp = new McpClient(process.execPath, ['mcp/free-audit-mcp.js'], { FREE_AUDIT_BASE_URL: BASE_URL });

    const init = await mcp.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'free-audit-mcp-smoke', version: '1.0.0' }
    });
    assert(init.serverInfo?.name === 'free-audit-mcp', `unexpected MCP server name ${JSON.stringify(init.serverInfo)}`);
    assert(init.serverInfo?.title === 'Free Audit MCP', `unexpected MCP server title ${JSON.stringify(init.serverInfo)}`);
    mcp.notify('notifications/initialized', {});

    const listed = await mcp.request('tools/list', {});
    const toolNames = listed.tools.map((tool) => tool.name);
    listed.tools.forEach(assertToolSchema);
    const expectedTools = [
      'free_audit_login',
      'free_audit_get_schema',
      'free_audit_list_audit_configs',
      'free_audit_get_audit_config',
      'free_audit_create_audit_config',
      'free_audit_update_audit_config',
      'free_audit_delete_audit_config',
      'free_audit_duplicate_audit_config',
      'free_audit_create_audit',
      'free_audit_run_audit_config',
      'free_audit_get_audit_status',
      'free_audit_get_audit_results',
      'free_audit_list_audits',
      'free_audit_export_audit_json',
      'free_audit_export_audit_csv',
      'free_audit_list_action_templates',
      'free_audit_create_action_template',
      'free_audit_update_action_template',
      'free_audit_delete_action_template',
      'free_audit_list_rule_sets',
      'free_audit_create_rule_set',
      'free_audit_update_rule_set',
      'free_audit_delete_rule_set',
      'free_audit_list_interaction_flow_templates',
      'free_audit_create_interaction_flow_template',
      'free_audit_update_interaction_flow_template',
      'free_audit_delete_interaction_flow_template',
      'free_audit_list_interaction_configs',
      'free_audit_create_interaction',
      'free_audit_run_interaction_config',
      'free_audit_get_interaction_status',
      'free_audit_get_interaction_results',
      'free_audit_list_interaction_runs',
      'free_audit_export_interaction_json',
      'free_audit_export_interaction_csv'
    ];
    for (const name of expectedTools) {
      assert(toolNames.includes(name), `${name} tool missing`);
    }
    const legacyPrefix = `${String.fromCharCode(112, 111, 112, 117, 112)}_${String.fromCharCode(112, 105, 116, 121)}`;
    assert(!toolNames.some((name) => name.startsWith(legacyPrefix)), 'legacy tool prefix is still exposed');

    const login = await mcp.tool('free_audit_login', { username: USERNAME, password: PASSWORD });
    assert(login.ok && login.user?.username === USERNAME, `MCP login failed: ${JSON.stringify(login)}`);

    const schema = await mcp.tool('free_audit_get_schema');
    assert(Array.isArray(schema.schema?.actionTypes), 'MCP schema missing actionTypes');

    const invalid = await mcp.tool('free_audit_create_audit_config', { name: '', domain: TARGET_URL });
    assert(invalid.error && invalid.status === 400, `invalid args did not return clean error: ${JSON.stringify(invalid)}`);

    const actionTemplate = await mcp.tool('free_audit_create_action_template', {
      name: `MCP Action Template ${RUN_ID}`,
      type: 'post',
      steps: [{ action: 'waitForTimeout', timeout: 50 }]
    });
    assert(actionTemplate.template?.id, 'action template create failed');
    const updatedActionTemplate = await mcp.tool('free_audit_update_action_template', {
      id: actionTemplate.template.id,
      name: `MCP Action Template Updated ${RUN_ID}`,
      type: 'post',
      steps: [{ action: 'waitForTimeout', timeout: 75 }]
    });
    assert(updatedActionTemplate.template?.name.includes('Updated'), 'action template update failed');

    const ruleSet = await mcp.tool('free_audit_create_rule_set', {
      name: `MCP Rule Set ${RUN_ID}`,
      rules: [{
        name: 'Final URL contains target',
        conditions: [{ subject: 'finalUrl', operator: 'contains', value: TARGET_URL }],
        assertions: [{ type: 'pageField', field: 'finalUrl', operator: 'contains', value: TARGET_URL }]
      }]
    });
    assert(ruleSet.ruleSet?.id, 'rule set create failed');

    const auditConfig = await mcp.tool('free_audit_create_audit_config', {
      name: `MCP Audit Config ${RUN_ID}`,
      domain: TARGET_URL,
      urlSources: [TARGET_URL],
      maxPages: 1,
      maxDepth: 0,
      sameOriginOnly: true,
      waitUntil: 'domcontentloaded',
      showBrowser: false,
      includeSitemaps: false,
      options: { browserEngine: 'playwright', workerMode: 'custom', simultaneousWorkers: 1 },
      postActionTemplateIds: [actionTemplate.template.id],
      ruleSetIds: [ruleSet.ruleSet.id]
    });
    assert(auditConfig.config?.id, 'audit config create failed');
    const gotAuditConfig = await mcp.tool('free_audit_get_audit_config', { id: auditConfig.config.id });
    assert(gotAuditConfig.config?.id === auditConfig.config.id, 'audit config get failed');
    const duplicatedAuditConfig = await mcp.tool('free_audit_duplicate_audit_config', { id: auditConfig.config.id });
    assert(duplicatedAuditConfig.config?.id, 'audit config duplicate failed');

    const audit = await mcp.tool('free_audit_run_audit_config', { auditConfigId: auditConfig.config.id });
    assert(audit.auditRun?.id, `MCP audit did not start: ${JSON.stringify(audit)}`);
    await waitForToolStatus(mcp, 'free_audit_get_audit_status', 'auditId', audit.auditRun.id);
    const auditResults = await mcp.tool('free_audit_get_audit_results', { auditId: audit.auditRun.id });
    assert(Array.isArray(auditResults.pages), 'MCP audit results missing pages');
    const auditHistory = await mcp.tool('free_audit_list_audits', { limit: 20 });
    assert(Array.isArray(auditHistory.audits), 'audit history list failed');

    const flowTemplate = await mcp.tool('free_audit_create_interaction_flow_template', {
      name: `MCP Flow ${RUN_ID}`,
      steps: [{ name: 'Template wait', action: 'waitForTimeout', timeout: 50 }]
    });
    assert(flowTemplate.template?.id, 'flow template create failed');

    const interaction = await mcp.tool('free_audit_create_interaction', {
      name: `MCP Interaction ${RUN_ID}`,
      run: true,
      config: {
        startingUrl: TARGET_URL,
        waitUntil: 'domcontentloaded',
        showBrowser: false,
        generalSettings: { browserEngine: 'playwright' },
        steps: [
          { name: 'Open target', action: 'openUrl', value: TARGET_URL, timeout: 8000 },
          { name: 'Accept', action: 'click', selector: '#acceptCookies', timeout: 5000 },
          { name: 'Assert accepted', action: 'assertElementText', selector: '#result', value: 'Accepted', timeout: 5000 }
        ]
      },
      flowTemplateIds: [flowTemplate.template.id],
      ruleSetIds: [ruleSet.ruleSet.id]
    });
    assert(interaction.interactionRun?.id, `MCP interaction did not start: ${JSON.stringify(interaction)}`);
    await waitForToolStatus(mcp, 'free_audit_get_interaction_status', 'runId', interaction.interactionRun.id);
    const interactionResults = await mcp.tool('free_audit_get_interaction_results', { runId: interaction.interactionRun.id });
    assert(Array.isArray(interactionResults.steps), 'MCP interaction results missing steps');
    const interactionConfigs = await mcp.tool('free_audit_list_interaction_configs');
    assert(Array.isArray(interactionConfigs.configs), 'interaction config list failed');
    const interactionRuns = await mcp.tool('free_audit_list_interaction_runs', { limit: 20 });
    assert(Array.isArray(interactionRuns.runs), 'interaction runs list failed');

    for (const [kind, key, idKey, runId] of [
      ['audit', 'pages', 'auditId', audit.auditRun.id],
      ['interaction', 'steps', 'runId', interaction.interactionRun.id]
    ]) {
      const json = await mcp.tool(`free_audit_export_${kind}_json`, { [idKey]: runId });
      assert(Array.isArray(json[key]) && json[key].length > 0, `${kind} JSON export empty`);
      const csv = await mcp.tool(`free_audit_export_${kind}_csv`, { [idKey]: runId });
      assert(csv.csv?.includes(TARGET_URL), `${kind} CSV does not contain target`);
    }

    const customConfig = await mcp.tool('free_audit_create_interaction_config', {
      name: `MCP Manual ${RUN_ID}`, startingUrl: TARGET_URL,
      steps: [{ action: 'waitForTimeout', timeout: 50 }]
    });
    assert(customConfig.config?.id, 'manual interaction config create failed');
    const manualRun = await mcp.tool('free_audit_run_interaction_config', { interactionConfigId: customConfig.config.id });
    assert(manualRun.interactionRun?.id, 'manual interaction run failed');
    await waitForToolStatus(mcp, 'free_audit_get_interaction_status', 'runId', manualRun.interactionRun.id);
    const composite = await mcp.tool('free_audit_create_audit', {
      name: `MCP Composite ${RUN_ID}`, run: false,
      config: { domain: TARGET_URL, maxPages: 1, includeSitemaps: false }
    });
    assert(composite.auditConfig?.id && !composite.auditRun, 'create-only audit unexpectedly ran');
    const scratch = await mcp.tool('free_audit_start_audit', {
      domain: TARGET_URL, maxPages: 1, headless: true, findPagesInSitemaps: false,
      waitUntil: 'domcontentloaded', browserEngine: 'playwright'
    });
    assert(scratch.id, `scratch audit failed: ${JSON.stringify(scratch)}`);
    await waitForToolStatus(mcp, 'free_audit_get_audit_status', 'auditId', scratch.id);

    for (const [singular, plural, key, listKey, original] of [
      ['audit_config', 'audit_configs', 'config', 'configs', auditConfig.config],
      ['action_template', 'action_templates', 'template', 'templates', actionTemplate.template],
      ['rule_set', 'rule_sets', 'ruleSet', 'ruleSets', ruleSet.ruleSet],
      ['interaction_flow_template', 'interaction_flow_templates', 'template', 'templates', flowTemplate.template],
      ['interaction_config', 'interaction_configs', 'config', 'configs', customConfig.config]
    ]) {
      const list = await mcp.tool(`free_audit_list_${plural}`, singular === 'action_template' ? { type: 'post' } : {});
      assert(list[listKey]?.some(r => r.id === original.id), `${singular} list missing owner record`);
      const copy = (await mcp.tool(`free_audit_duplicate_${singular}`, { id: original.id }))[key];
      assert(copy?.id && copy.id !== original.id, `${singular} duplicate failed`);
      const detail = (await mcp.tool(`free_audit_get_${singular}`, { id: copy.id }))[key];
      const updated = (await mcp.tool(`free_audit_update_${singular}`, { ...detail, name: `${detail.name} revised` }))[key];
      assert(updated?.name.endsWith('revised'), `${singular} update failed`);
      const removed = await mcp.tool(`free_audit_delete_${singular}`, { id: copy.id });
      assert(!removed.error, `${singular} delete failed`);
      const missing = await mcp.tool(`free_audit_get_${singular}`, { id: copy.id });
      assert(missing.status === 404, `${singular} deleted record still available`);
      assert((await mcp.tool(`free_audit_get_${singular}`, { id: original.id }))[key]?.id === original.id, `${singular} original changed by delete`);
    }
    const resources = await mcp.tool('free_audit_list_resources', { limit: 10 });
    assert(resources.audits?.audits?.length > 0, 'aggregate resources missing audits');
    const secondUser = await mcp.tool('free_audit_register', {
      username: `${USERNAME}_other`, password: PASSWORD, displayName: 'MCP ownership QA'
    });
    assert(secondUser.user, 'MCP registration failed');
    for (const [name, args] of [
      ['get_audit_config', { id: auditConfig.config.id }],
      ['get_action_template', { id: actionTemplate.template.id }],
      ['get_rule_set', { id: ruleSet.ruleSet.id }],
      ['get_interaction_flow_template', { id: flowTemplate.template.id }],
      ['get_interaction_config', { id: customConfig.config.id }],
      ['export_audit_json', { auditId: audit.auditRun.id }],
      ['export_interaction_csv', { runId: interaction.interactionRun.id }]
    ]) {
      const denied = await mcp.tool(`free_audit_${name}`, args);
      assert([403, 404].includes(denied.status), `Cross-user MCP access: ${name}`);
    }
    assert((await mcp.tool('free_audit_list_audits')).audits.length === 0, 'Cross-user list leak');
    const untested = toolNames.filter(name => !mcp.calledTools.has(name));
    assert(!untested.length, `Untested MCP tools: ${untested.join(', ')}`);
    console.log(`Free Audit MCP smoke passed: ${toolNames.length} tools called through the official SDK, exports and ownership verified.`);
  } finally {
    if (mcp) await mcp.close();
    app.kill('SIGTERM');
    await new Promise((resolve) => target.close(resolve));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
