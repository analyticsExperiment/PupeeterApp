# Agent API and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add programmatic APIs and MCP tools so agents can create, configure, run, inspect, and export audits and interaction journeys without driving the UI manually.

**Architecture:** Keep the existing UI CRUD endpoints and runner behavior intact. Add a small agent orchestration layer that upserts templates/rule sets, creates configs, assembles payloads through existing helpers, and starts runs through existing runner entry points. Add a stdio MCP server that calls these HTTP APIs with a session cookie, so external AI agents use the application as a tool.

**Tech Stack:** Node.js, Express, better-sqlite3, existing audit/interaction runners, vanilla JSON-RPC stdio MCP bridge, Playwright/HTTP regression scripts.

---

### Task 1: Contract Tests

**Files:**
- Create: `tests/api/agent-api-regression.js`
- Create: `tests/mcp/mcp-smoke.js`
- Modify: `package.json`

- [ ] Write a failing HTTP regression script that registers a dummy user, calls a one-shot audit builder API, verifies created templates/rules/config/run ownership, polls the audit, and checks JSON/CSV exports.
- [ ] Extend the same script to call a one-shot interaction builder API, verify template/rule/config/run creation, poll the run, and check JSON/CSV exports.
- [ ] Add cross-user negative checks for created resources through direct API URLs.
- [ ] Write a failing MCP smoke script that starts the MCP stdio server, initializes it, lists tools, logs in, creates an audit config, starts a small audit, creates/runs an interaction, and reads statuses/results.
- [ ] Add `npm run qa:api` and `npm run qa:mcp` scripts.

### Task 2: Agent API Orchestration

**Files:**
- Create: `src/api/agentOrchestrator.js`
- Modify: `server.js`

- [ ] Add validation helpers for safe URLs, positive integers, waitUntil values, template names, rule set names, and action/interaction step arrays.
- [ ] Add `GET /api/agent/schema` returning supported engines, waitUntil values, action types, rule subjects/types/operators, and example payloads.
- [ ] Add `POST /api/agent/audits` that can:
  - accept general audit settings,
  - create or reuse pre/post action templates,
  - create or reuse rule sets,
  - attach templates/rules to a saved audit config,
  - preserve inline actions/rules in `options`,
  - optionally start the audit run,
  - return config, assembled payload, snapshot, and run id.
- [ ] Add `POST /api/agent/interactions` with equivalent behavior for interaction flow templates, inline steps, rule sets, saved interaction config, and optional run.
- [ ] Add convenience aliases `POST /api/agent/audits/:id/run` and `POST /api/agent/interactions/:id/run` that call the existing config run paths internally.

### Task 3: MCP Tools

**Files:**
- Create: `mcp/free-audit-mcp.js`
- Create: `mcp/README.md`
- Modify: `package.json`

- [ ] Implement a JSON-RPC stdio MCP server supporting `initialize`, `tools/list`, and `tools/call`.
- [ ] Add tools for login, schema, audit create/run/status/results/export, interaction create/run/status/results/export, and resource listing.
- [ ] Store session cookies in memory for the MCP process only.
- [ ] Keep tool responses compact JSON text and surface API errors cleanly.

### Task 4: Postman and Docs

**Files:**
- Create: `docs/postman/Free Audit Agent API.postman_collection.json`
- Create: `docs/postman/Free Audit Local.postman_environment.json`
- Create: `docs/AGENT_API_AND_MCP.md`
- Modify: `docs/README.md`

- [ ] Document dummy account credentials used by QA.
- [ ] Document authentication, agent endpoint payloads, run polling, exports, and MCP setup.
- [ ] Add a Postman collection covering auth, schema, audit build/run/status/results/exports, interaction build/run/status/results/exports, and security checks.

### Task 5: Verification

**Files:**
- Update: `QA_REGRESSION_SUMMARY.md`
- Update: `QA_TEST_PLAN.md`

- [ ] Run `node --check` on changed JS files.
- [ ] Run `npm run qa:api` and fix issues with root-cause evidence.
- [ ] Run `npm run qa:mcp` and fix issues with root-cause evidence.
- [ ] Run `npm run qa:deep`, `npm run qa:phase2`, and `npm run qa:open-states`.
- [ ] Update QA docs with commands, dummy credentials, endpoints tested, issues found/fixed, and limitations.
