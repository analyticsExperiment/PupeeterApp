# Free Audit MCP Rename and Recorder Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the MCP to Free Audit MCP and add a Manifest V3 Chrome extension MVP that records interaction steps and saves them to Free Audit through safe pairing-token APIs.

**Architecture:** Rename MCP files, scripts, server metadata, tool names, docs, and tests to the `free_audit_*` tool prefix and `free-audit-mcp` internal namespace. Add extension-token storage in SQLite, session-protected token creation/revocation in Settings, bearer-protected extension save endpoints, and a static MV3 extension that records DOM actions into the existing interaction step schema. Keep existing UI, runner, API, and report behavior intact.

**Tech Stack:** Node.js, Express, better-sqlite3, JSON-RPC stdio MCP, Manifest V3 Chrome extension, vanilla JS, Playwright-based smoke scripts.

---

### Task 1: MCP Rename and Coverage

**Files:**
- Create/update: `mcp/free-audit-mcp.js`
- Modify: `mcp/README.md`
- Modify: `tests/mcp/mcp-smoke.js`
- Modify: `package.json`
- Modify: `docs/AGENT_API_AND_MCP.md`
- Modify: `docs/README.md`
- Modify: `QA_AGENT_API_MCP_SUMMARY.md`

- [x] Update MCP serverInfo to `{ name: "free-audit-mcp", title: "Free Audit MCP" }`.
- [x] Rename legacy tool prefixes to `free_audit_*`.
- [x] Add MCP tools for list/get/create/update/delete/duplicate audit configs, action templates, rule sets, interaction flow templates, interaction configs, list audits, and list interaction runs.
- [x] Update smoke test to require the new name, new prefix, valid schemas, invalid-argument clean errors, and safe happy paths.
- [x] Remove user-facing placeholder name references.

### Task 2: Extension Pairing API

**Files:**
- Modify: `src/db.js`
- Modify: `server.js`
- Modify: `public/settings.html`
- Modify: `public/settings.js`
- Modify: `public/styles.css`

- [x] Add `extension_tokens` table with token hash, owner username, label, created timestamp, last used timestamp, and revoked timestamp.
- [x] Add DB helpers to create/list/revoke/resolve tokens.
- [x] Add `GET /api/extension/status`, `GET /api/extension/tokens`, `POST /api/extension/tokens`, `DELETE /api/extension/tokens/:id`.
- [x] Add bearer-protected `POST /api/extension/interaction-flow-template` and `POST /api/extension/interaction-config`.
- [x] Add Settings UI for creating, copying once, viewing metadata, and revoking tokens.

### Task 3: Recorder Extension MVP

**Files:**
- Create: `extension/free-audit-recorder/manifest.json`
- Create: `extension/free-audit-recorder/popup.html`
- Create: `extension/free-audit-recorder/popup.js`
- Create: `extension/free-audit-recorder/contentScript.js`
- Create: `extension/free-audit-recorder/recorder.js`
- Create: `extension/free-audit-recorder/selectorGenerator.js`
- Create: `extension/free-audit-recorder/styles.css`
- Create: `extension/free-audit-recorder/README.md`

- [x] Capture page open, navigation, click, input/change, select, checkbox/radio, submit, scroll throttled, and useful Enter/Escape key presses.
- [x] Mask password/OTP/token/card/CVV/PIN/secret-like values by default.
- [x] Generate selectors using data attributes, stable id, name, aria-label, labels, stable classes, and nth-of-type fallback.
- [x] Validate selector uniqueness and add confidence metadata.
- [x] Provide popup controls for base URL, pairing token, start/pause/stop/clear, preview, copy JSON, save as flow template, save as interaction config, export JSON, and open app.

### Task 4: Extension Smoke Test and Docs

**Files:**
- Create: `tests/qa/extension-recorder-smoke.js`
- Modify: `package.json`
- Create: `docs/CHROME_EXTENSION_RECORDER.md`
- Modify: `QA_TEST_PLAN.md`
- Modify: `QA_REGRESSION_SUMMARY.md`

- [x] Write smoke test that starts Free Audit and a local target, creates an extension token, injects recorder scripts into the target, records safe actions, verifies sensitive masking/selectors/schema, saves a flow template and interaction config via bearer token, runs the generated config, and validates a report.
- [x] Add `npm run qa:extension`.
- [x] Document feasibility, pairing, load steps, recording flow, limitations, and manual checklist.

### Task 5: Verification

**Files:**
- Update: `QA_REGRESSION_SUMMARY.md`
- Update: `QA_ISSUES.md`

- [x] Run `rg` to confirm user-facing placeholder MCP names are gone.
- [x] Run `node --check` on changed JS files.
- [x] Run `npm run qa:mcp`.
- [x] Run `npm run qa:extension`.
- [x] Run `npm run qa:api`.
- [x] Run `npm run qa:open-states`.
- [x] Run `npm run qa:deep`.
- [x] Run `npm run qa:phase2`.
- [x] Document final results and remaining limitations.
