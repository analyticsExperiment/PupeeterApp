# Free Audit MCP

MCP server for Free Audit, exposing tools to manage audit configs, run audits, manage interaction configs, run interaction journeys, inspect reports, and export results.

Version 1.1.0 uses the official MCP SDK's standard newline-delimited stdio transport. The old custom Content-Length transport was incompatible with standard MCP clients and has been removed. API payloads and tool names are unchanged. This is a local stdio server, not a hosted HTTP MCP service.

Run `npm run qa:mcp` to connect through the official SDK client, call all 49 exposed tools, validate both export formats and CRUD readback, and verify cross-user denial. The specification is at [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

Start the app first:

```powershell
npm start
```

Then configure your MCP client to run:

```powershell
node mcp/free-audit-mcp.js
```

Useful environment variables:

- `FREE_AUDIT_BASE_URL` - defaults to `http://127.0.0.1:3000`
- `FREE_AUDIT_USERNAME` - optional auto-login username
- `FREE_AUDIT_PASSWORD` - optional auto-login password

Tools exposed:

- `free_audit_register`
- `free_audit_login`
- `free_audit_get_schema`
- `free_audit_list_audit_configs`
- `free_audit_get_audit_config`
- `free_audit_create_audit_config`
- `free_audit_update_audit_config`
- `free_audit_delete_audit_config`
- `free_audit_duplicate_audit_config`
- `free_audit_create_audit`
- `free_audit_start_audit`
- `free_audit_run_audit_config`
- `free_audit_get_audit_status`
- `free_audit_get_audit_results`
- `free_audit_list_audits`
- `free_audit_export_audit_json`
- `free_audit_export_audit_csv`
- `free_audit_list_action_templates`
- `free_audit_get_action_template`
- `free_audit_create_action_template`
- `free_audit_update_action_template`
- `free_audit_delete_action_template`
- `free_audit_duplicate_action_template`
- `free_audit_list_rule_sets`
- `free_audit_get_rule_set`
- `free_audit_create_rule_set`
- `free_audit_update_rule_set`
- `free_audit_delete_rule_set`
- `free_audit_duplicate_rule_set`
- `free_audit_list_interaction_flow_templates`
- `free_audit_get_interaction_flow_template`
- `free_audit_create_interaction_flow_template`
- `free_audit_update_interaction_flow_template`
- `free_audit_delete_interaction_flow_template`
- `free_audit_duplicate_interaction_flow_template`
- `free_audit_list_interaction_configs`
- `free_audit_get_interaction_config`
- `free_audit_create_interaction_config`
- `free_audit_update_interaction_config`
- `free_audit_delete_interaction_config`
- `free_audit_duplicate_interaction_config`
- `free_audit_create_interaction`
- `free_audit_run_interaction_config`
- `free_audit_get_interaction_status`
- `free_audit_get_interaction_results`
- `free_audit_list_interaction_runs`
- `free_audit_export_interaction_json`
- `free_audit_export_interaction_csv`
- `free_audit_list_resources`
