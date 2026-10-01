# Free Audit Agent API, Extension, and MCP Guide

This guide is for API clients, Postman, browser-extension users, and AI agents that need to use Free Audit as a tool.

The regular UI still works exactly as before. These endpoints are a programmatic layer over the same saved configs, templates, rule sets, runners, reports, and exports.

## On Page Actions Naming

The application now calls per-page actions **On Page Actions**. Existing API payload keys (`postAuditActions`, `onPageActions`, `postActionTemplates`) and action-template `type: "post"` remain compatible. This is a display-name change, not a migration of stored configs or reports. New runner messages use the new wording after the backend is restarted.

Audit and interaction reports now share a searchable dataLayer/JSON inspector. Before/After and Added tabs reflect only snapshots actually present in the report. Copy JSON copies the complete selected snapshot, not only filtered rows. See `QA_DATALAYER_UI_REVIEW.md` for tests and remaining UI recommendations.

## Local Dummy Account

Use this account for local Postman/API evaluation:

```text
username: free_audit_api_dummy
password: FreeAuditAPI123!
```

The QA scripts also create isolated timestamped users so test data stays user-scoped.

## Authentication

All agent APIs use the existing session auth.

1. Register once if needed:

```http
POST /auth/register
Content-Type: application/json

{
  "username": "free_audit_api_dummy",
  "password": "FreeAuditAPI123!",
  "displayName": "Free Audit API Dummy"
}
```

2. Login:

```http
POST /auth/login
Content-Type: application/json

{
  "username": "free_audit_api_dummy",
  "password": "FreeAuditAPI123!"
}
```

Keep the returned `audit.sid` cookie for later requests.

## Agent Endpoints

### Schema

```http
GET /api/agent/schema
```

Returns supported action types, browser engines, waitUntil values, rule subjects, rule assertion types, operators, and example payloads.

### Build A Complete Audit

```http
POST /api/agent/audits
Content-Type: application/json
```

Example:

```json
{
  "name": "API Demo Audit",
  "description": "Created from one API call.",
  "run": true,
  "config": {
    "domain": "https://example.com",
    "urlSources": ["https://example.com"],
    "maxPages": 1,
    "maxDepth": 0,
    "sameOriginOnly": true,
    "waitUntil": "domcontentloaded",
    "showBrowser": false,
    "includeSitemaps": false,
    "options": {
      "browserEngine": "playwright",
      "workerMode": "custom",
      "simultaneousWorkers": 1
    }
  },
  "preActionTemplates": [
    {
      "name": "Accept Consent",
      "steps": [
        { "action": "click", "selector": "#acceptCookies", "timeout": 3000 }
      ]
    }
  ],
  "postActionTemplates": [
    {
      "name": "After Page Wait",
      "steps": [
        { "action": "waitForTimeout", "timeout": 250 }
      ]
    }
  ],
  "ruleSets": [
    {
      "name": "Final URL Rules",
      "rules": [
        {
          "name": "Final URL exists",
          "conditions": [],
          "assertions": [
            { "type": "pageField", "field": "finalUrl", "operator": "exists" }
          ]
        }
      ]
    }
  ]
}
```

Response includes:

- `auditConfig`
- `assembledPayload`
- `configSnapshot`
- `auditRun` with status/log/result/export URLs when `run: true`
- `created` IDs for upserted templates and rule sets

### Run Existing Audit Config

```http
POST /api/agent/audits/:id/run
```

### Build A Complete Interaction

```http
POST /api/agent/interactions
Content-Type: application/json
```

Example:

```json
{
  "name": "API Demo Interaction",
  "description": "Created from one API call.",
  "run": true,
  "config": {
    "startingUrl": "https://example.com",
    "waitUntil": "domcontentloaded",
    "showBrowser": false,
    "generalSettings": {
      "browserEngine": "playwright"
    },
    "steps": [
      { "name": "Open", "action": "openUrl", "value": "https://example.com", "timeout": 8000 },
      { "name": "Assert URL", "action": "assertUrlContains", "value": "example.com" }
    ]
  },
  "flowTemplates": [
    {
      "name": "Reusable Demo Wait",
      "steps": [
        { "name": "Pause", "action": "waitForTimeout", "timeout": 250 }
      ]
    }
  ],
  "ruleSets": [
    {
      "name": "Interaction URL Rules",
      "rules": [
        {
          "name": "Final URL exists",
          "assertions": [
            { "type": "pageField", "field": "finalUrl", "operator": "exists" }
          ]
        }
      ]
    }
  ]
}
```

### Run Existing Interaction Config

```http
POST /api/agent/interactions/:id/run
```

## Existing Result and Export APIs

Audits:

- `GET /api/audit/:id/status`
- `GET /api/audit/:id/logs`
- `GET /api/audit/:id/results`
- `GET /api/audit/:id/json`
- `GET /api/audit/:id/csv`

Interactions:

- `GET /api/interaction-runs/:id/status`
- `GET /api/interaction-runs/:id/logs`
- `GET /api/interaction-runs/:id/results`
- `GET /api/interaction-runs/:id/json`
- `GET /api/interaction-runs/:id/csv`

## Postman

Import:

- `docs/postman/Free Audit Agent API.postman_collection.json`
- `docs/postman/Free Audit Local.postman_environment.json`

Run order:

1. Register Dummy Account
2. Login Dummy Account
3. Agent Schema
4. Build Complete Audit
5. Poll Audit Status until completed
6. Get Audit Results / CSV / JSON
7. Build Complete Interaction
8. Poll Interaction Status until completed
9. Get Interaction Results / CSV / JSON

The collection also includes management endpoints for saved audit configs, action templates, rule sets, interaction flow templates, interaction configs, interaction runs, and the extension pairing-token workflow.

## MCP

Start the app:

```powershell
npm start
```

Configure your MCP client to run:

```powershell
node c:\NodeApps\PuppetteerApp\mcp\free-audit-mcp.js
```

Useful environment variables:

```text
FREE_AUDIT_BASE_URL=http://127.0.0.1:3000
FREE_AUDIT_USERNAME=free_audit_api_dummy
FREE_AUDIT_PASSWORD=FreeAuditAPI123!
```

MCP identity:

- Server name: `free-audit-mcp`
- Human title: `Free Audit MCP`
- Tool prefix: `free_audit`
- Transport: standard newline-delimited stdio through the official MCP SDK (server 1.1.0).
- Verification: `npm run qa:mcp` calls all 49 tools through an official SDK client, including exports, duplicate/update/delete readback, and cross-user denial. Restart your MCP client after updating.

Core MCP tools:

- `free_audit_register`
- `free_audit_login`
- `free_audit_get_schema`
- `free_audit_create_audit`
- `free_audit_run_audit_config`
- `free_audit_get_audit_status`
- `free_audit_get_audit_results`
- `free_audit_export_audit_json`
- `free_audit_export_audit_csv`
- `free_audit_create_interaction`
- `free_audit_run_interaction_config`
- `free_audit_get_interaction_status`
- `free_audit_get_interaction_results`
- `free_audit_export_interaction_json`
- `free_audit_export_interaction_csv`
- `free_audit_list_resources`

CRUD MCP tool families:

- Audit configs: list, get, create, update, delete, duplicate.
- Action templates: list, get, create, update, delete, duplicate.
- Rule sets: list, get, create, update, delete, duplicate.
- Interaction flow templates: list, get, create, update, delete, duplicate.
- Interaction configs: list, get, create, update, delete, duplicate.

## Chrome Extension Recorder

The companion extension lives in `extension/free-audit-recorder/`.

Use it to record real browser clicks, form fills, selects, checkbox/radio changes, scrolls, and navigation into the existing Free Audit interaction-step schema. Sensitive values such as passwords, tokens, OTPs, card fields, and secrets are masked before saving.

Pairing flow:

1. Login to Free Audit.
2. Open Settings.
3. Create a Chrome Extension pairing token.
4. Load `extension/free-audit-recorder/` as an unpacked Chrome extension.
5. Paste the base URL and token into the extension popup.
6. Record a journey, then save it as an interaction flow template or interaction config.

Extension API endpoints:

- `GET /api/extension/status`
- `GET /api/extension/tokens`
- `POST /api/extension/tokens`
- `DELETE /api/extension/tokens/:id`
- `POST /api/extension/interaction-flow-template`
- `POST /api/extension/interaction-config`

## Safety Notes

- Keep `maxPages` low for third-party sites.
- Prefer local or owned test targets while building journeys.
- The agent APIs upsert same-named templates/rule sets for the authenticated user only.
- Cross-user access remains blocked by the existing ownership checks.
- The MCP server stores cookies only in memory for the running MCP process.
