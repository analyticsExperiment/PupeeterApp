# Tag & Cookie Auditor QA Test Plan

## Report and History Continuation - 9 September 2026

See `QA_REPORT_UI_SUMMARY.md` for the current issue ledger and final evidence; older dated sections below remain historical.

- `npm run qa:reports`: eight focused browser tests for report identity/navigation, six keyboard-operated audit drilldowns, nested modal focus/Back/Escape, separate execution/validation results, seven incomplete/skipped/error/rule fixtures, history filters, exact configuration/snapshot readback, delayed-response ordering, long captured text and three viewport widths.
- Native history select text is checked against measured font glyph height, not only element visibility. History table scrolling must remain inside its region. Search/date/status/error-range controls and the detail panel must remain readable on mobile.
- Focused result payloads are deliberately mocked. Retain real-engine coverage from `qa:deep`, `qa:phase2`, `qa:open-states`, exact console tests and both-engine smoke.
- Final protocol: headed `qa:open-states` twice consecutively from separate fresh starts, then deep, Phase 2, reports, JSON, API, MCP, console, reliability and recorder tests; syntax, original-database preservation and unchanged-source hashes. Visually inspect final screenshots before recording completion.
- Preserve `postAuditActions` and other API keys in raw configuration; all human-facing app labels remain On Page Actions. Do not mutate existing snapshots to change terminology.

## dataLayer and Naming Follow-Up - 8 September 2026

See `QA_DATALAYER_UI_REVIEW.md` for the current inspector implementation and screenshot-based feedback across all 13 main screens. New `npm run qa:json` covers nested values, keyboard disclosure/Escape, raw/copy fidelity, empty and large snapshots, mobile containment, inert markup, clipboard failure and On Page wording. It supplements, not replaces, deep/open-state/Phase 2/API/MCP and runner tests. Technical payload identifiers and existing saved data remain unchanged.

## Scope

This plan covers authenticated UI, CRUD management surfaces, audit execution, interaction execution, reports, exports, ownership controls, database persistence, and visual regression checks for the Tag & Cookie Auditor / Audit Management Console.

## Environment

- App command: `npm start` or `node server.js`
- Default app port: `3000`; QA harness uses `QA_APP_PORT` if supplied
- Database: `data/audits.db` using `better-sqlite3`, WAL enabled
- Browser automation: Playwright from the existing dependency
- Safe target: local QA server started by `tests/qa/deep-regression.js`

## Test Matrix

| Area | Coverage |
| --- | --- |
| Authentication | Register, login, logout, session persistence, unauthenticated page redirects, unauthenticated API 401 |
| Ownership | User B cannot access User A audits, audit configs, action templates, rule sets, interaction configs, or interaction runs by direct API URL |
| Navigation/UI | Sidebar, active state, dashboard, create audit, audit history, audit configs, action templates, rule sets, interaction configs, flow templates, interaction runs, settings |
| Visual review | Desktop screenshots for all main pages, mobile smoke for dashboard/create audit, layout overflow/clipping checks, modal open/close checks |
| Audit from scratch | Domain/start URL, URL sources, pre-audit actions, post-audit actions, rules, SSE logs, final report, report modals, CSV/JSON exports, history entry |
| Audit configs | Create, attach pre/post templates and rule set, save, run, snapshot storage, history config name, duplicate, edit, delete test duplicate |
| Action templates | Create/edit/duplicate/delete pre-audit and post-audit templates, multiple step types, step reorder, apply to create audit |
| Rule sets | Create/edit/duplicate/delete, page field, request URL, cookie, dataLayer, console, positive and negative rules, report pass/fail/not-applied rendering |
| Interaction flow templates | Create/edit/duplicate/delete, multiple action types, apply to create audit flow area |
| Interaction configs | Create, import flow template, add manual journey steps, reorder, enable/disable, run, report, run history, JSON/CSV export |
| Reports | Audit summary cards, page cards, Tools, Network, Request Details, Cookies, dataLayer, Console, Rules, interaction step cards, screenshot modal where captured |
| Exports | Audit CSV/JSON, vendor CSV where detected requests exist, interaction CSV/JSON |
| Database | Idempotent schema load, no existing data deletion, new records persist, duplicate/delete affect only QA-created records, config snapshots on runs |
| Agent API | One-shot full audit build/run, one-shot full interaction build/run, schema discovery, API validation failures, run polling, JSON/CSV exports, and cross-user ownership checks |
| MCP | Free Audit MCP stdio initialize, tool listing, login, schema lookup, CRUD/duplicate tool families, audit creation/status/results, interaction creation/status/results |
| Chrome extension recorder | Pairing tokens, action recording, sensitive masking, save recorded flow template/config, generated interaction replay |

## Required Journeys

1. Audit from scratch through `/?scratch=1`.
2. Audit from saved config through `/audit-configs.html`.
3. Action template creation and application.
4. Rule set creation and report verification.
5. Interaction config run and interaction report verification.
6. User ownership enforcement with two QA users.

## Automation Command

```powershell
node tests/qa/deep-regression.js
```

Optional:

```powershell
$env:QA_HEADED='1'; node tests/qa/deep-regression.js
```

Agent/API and MCP automation:

```powershell
npm run qa:api
npm run qa:mcp
npm run qa:extension
```

Postman artifacts:

- `docs/postman/Free Audit Agent API.postman_collection.json`
- `docs/postman/Free Audit Local.postman_environment.json`

The collection includes 32 importable requests covering auth, agent audit/interaction build-run flows, result/export endpoints, saved-resource management list/detail/run endpoints, and extension pairing/save endpoints.

Local dummy API account:

```text
username: free_audit_api_dummy
password: FreeAuditAPI123!
```

Chrome extension recorder:

- Load `extension/free-audit-recorder/` as an unpacked Manifest V3 extension.
- Pair from Settings with a one-time displayed token.
- Smoke with `npm run qa:extension`.

## Phase 2 Adversarial QA

Phase 2 expands the baseline regression beyond happy paths. It is intended to catch validation, visual, ownership, persistence, and stability issues that may not appear in the first full sweep.

### Additional Automation Commands

```powershell
$env:QA_HEADED='1'; npm run qa:deep
npm run qa:phase2
npm run qa:open-states
```

### Additional Coverage Matrix

| Area | Coverage |
| --- | --- |
| Headed visual pass | Run the deep regression in headed Chromium and watch for awkward flow, flicker, slow states, layout jumps, confusing controls, modal problems, and visual regressions |
| Edge-case validation | Empty required fields, invalid URLs, very long names/descriptions, special characters, duplicate names, missing/invalid selectors, empty steps, empty rule sets, empty journeys, invalid wait values, very large/negative/non-numeric numbers |
| Advanced audit runner | No actions, pre-only actions, post-only actions, combined actions, multiple URL sources, sitemap on/off, same-origin toggles, waitUntil variants, pass/fail/not-applied rules, CSV/JSON export validation |
| Advanced interaction runner | Empty journey, single-step journey, multi-step journey, disabled steps, failed selectors, iframe/main-frame switching, JavaScript execution, navigation, form fill, wait/navigation behavior, per-step capture and rule states |
| Data persistence | Restart app after creating audit config, action templates, rule set, interaction flow template, interaction config, audit run, and interaction run; verify records, reports, and exports still open |
| Cross-user security | User B direct API checks for User A audits, configs, templates, rule sets, flow templates, interaction configs, interaction runs, exports, result endpoints, list endpoints, and SSE logs |
| Responsive/visual | Desktop, tablet, and mobile checks for sidebar, tables, forms, modals, report cards, network tables, JSON/dataLayer views, visible buttons, and unintended horizontal overflow |
| Realistic safe target | One or two low-volume public/demo targets with low page counts to verify external load, request/cookie/console capture, blocked request tolerance, and timeout behavior |
| Performance/stability | Sequential small runs: 3 scratch audits, 3 config audits, and 3 interactions; verify no stuck statuses, log mixing, stale browser instances, or inaccurate history |

### Current Phase 2 Result

- Latest command: `npm run qa:phase2`
- Run ID: `2026-05-24T15-55-42-663Z`
- Result: 102 checks passed, 0 reproducible issues in the final run.
- Evidence: `QA_PHASE2_REGRESSION_SUMMARY.md` and `output/playwright/qa-phase2-2026-05-24T15-55-42-663Z`.

## Phase 3 Open-State Visual QA

Phase 3 is the human-visible open-state pass. It exists to catch the nooks and corners that a "page is not blank" regression can miss.

### Command

```powershell
npm run qa:open-states
```

### Pages Covered

| Page | Default state | Open states |
| --- | --- | --- |
| Dashboard | Desktop/tablet/mobile screenshots, nav state, overflow, controls | Config cards and quick action reachability |
| Create Audit | Launcher and scratch mode screenshots | Config picker, waitUntil/same-origin controls through baseline regression |
| Audit History | History table/cards | Report reopen/export links through baseline regression |
| Audit Configs | List/detail responsive states | Common template picker dialog, Escape close, linked template/rule selectors |
| Pre-Audit Actions | Template editor | Action type dropdown catalog |
| Post-Audit Actions | Template editor | Action type dropdown catalog |
| Rules | Rule set editor | Searchable vendor/tag comboboxes, search, select, Escape, outside click, save/reload persistence |
| Interaction Configs | List/detail responsive states | Journey action dropdown, template import picker, mobile action dropdown |
| Interaction Flow Templates | Template editor | Mobile ordered step layout and action dropdown reachability |
| Interaction Runs | Run history | Report links and export links through baseline regression |
| Settings | Default settings state | Primary controls and responsive layout |
| Audit Report | Summary/page cards | Network modal, request detail modal, dataLayer modal, rules modal |
| Interaction Report | Summary/step cards | Request drilldown modal |

### Open-State Assertions

The script checks:

- Visible meaningful page content, active nav, and reachable primary controls.
- No relevant console errors or failed same-origin requests.
- No unintended document-level horizontal overflow.
- No internal panel overflow inside major editor/report containers.
- Popover visibility, viewport containment, capped height, sensible width, and trigger anchoring.
- Escape and outside-click close behavior where applicable.
- Vendor/tag selection and persistence after save/reload.
- Required screenshot artifacts for Rules, audit config picker, action dropdowns, interaction controls, and report modals.

### Current Phase 3 Result

- Final open-state pass #1: `2026-05-24T15-52-22-496Z`, passed.
- Final open-state pass #2: `2026-05-24T15-53-08-360Z`, passed with 259 checks and 55 screenshots.
- Evidence: `QA_OPEN_STATE_SUMMARY.md`, `QA_OPEN_STATE_ISSUES.md`, and `output/playwright/qa-open-states-2026-05-24T15-53-08-360Z`.

## Phase 2 Adversarial QA - September 2026 Continuation

The May results above are historical. Current fixes, limitations, exact final run IDs and screenshot-review notes are maintained in `QA_RELIABILITY_SUMMARY.md`; latest final logs are in `output/qa-final-20260908/`. Earlier green sequences were followed by screenshot-led findings REL-09 and VIS-08, requiring another complete sequence.

| Area | Added or independently verified coverage | Evidence |
| --- | --- | --- |
| Console UI | All 13 main pages at desktop/tablet/mobile; actual native dropdown open state, selection, Escape/outside close; vendor popover search/geometry/save/reload; report drilldowns; console-message contrast at least 4.5:1 | `npm run qa:open-states`, 285 checks per complete pass |
| Dashboard | Visible scratch-audit entry, nonwrapping status, contained scrollable history with sticky Open action, metric-card viewport margin, long names cannot squeeze Run/Edit labels, Edit click-through at three widths | Open-state dashboard checks, reliability click-through tests, three added Phase 2 assertions |
| Authentication and ownership | Register/login/logout, protected requests, two-user lists/details/runs/reports/exports/SSE | Deep, Phase 2 and API suites |
| Audit and interaction behavior | CRUD/template assembly, capture/rule states, exports, failed-selector errors, low-count sequential jobs, restart/persistence | Deep and Phase 2 suites; both-engine runner smoke |
| Exact console capture | Both engines: one entry per emitted event; retain genuine repeats, object arguments, native primitive text, iframe logs, runtime errors/rejections, post actions, rule evaluation, and per-page isolation; native-text fallback on unavailable arguments | New `npm run qa:console`, four focused tests with real two-page audits |
| Settings | Cancel creates nothing; token create/authenticate/revoke/401; injected 503 gives an error and retry; mobile token controls/status | `npm run qa:reliability` |
| MCP | Official SDK initialize/list/call interoperability; all 49 tools called; CRUD readback, exports and ownership failures | `npm run qa:mcp` |
| Recorder ordering | Immediate stop, fill-before-submit, checkbox/submit deduplication, sensitive-value masking | Reliability tests and extension replay smoke |
| Installed extension | Real unpacked extension/service worker; tab isolation; recording across navigation; pause/reload/resume; popup reopen/save/readback; initial URL | Reliability installed-extension test |
| Database safety | Backup comparison across 14 tables; original record IDs and stored reports preserved; integrity/foreign keys; initialize schema twice | `node tests/qa/database-preservation.js output/qa-backup-20260907-001857/audits.db` |
| Dependency review | Compatible updates followed by runner regression; unresolved installer-chain advisories explicitly tracked | Final `dependency-audit.json` and reliability report |

### Final Verification Protocol

Use `$env:QA_HEADED='1'` in PowerShell. Run `qa:open-states` twice consecutively, then `qa:deep`, `qa:phase2`, `qa:api`, `qa:mcp`, `qa:extension`, `qa:reliability`, and `qa:console`. Each application harness starts and stops its own app process; the exact-console test invokes both runners against its own local target. Do not open competing diagnostic browser windows during headed native-menu checks. Run `node --check` for modified JavaScript, the database preservation check, and `node tests/qa/audit-runner-smoke.js`. Inspect the latest screenshots before recording success.

The screenshot count is not a coverage guarantee. Native operating-system dropdown surfaces are outside Playwright page PNGs; `:open` and interaction tests verify behavior but not OS menu appearance. The mobile dashboard uses a viewport capture because full-page capture previously changed scrollbar layout. Long tables may scroll inside their own region; document-level overflow is not acceptable. Real devices, browser toolbar popup operation, long-duration load and public deployment remain manual or separate test areas.

### September Final Results

Completed 8 September 2026 local time after the ninth test/fix/retest round. Open-state runs `2026-09-07T22-24-14-405Z` and `2026-09-07T22-25-00-222Z` both passed 285 checks consecutively. Deep run `2026-09-07T22-25-44-597Z` passed 118 checks; adversarial run `2026-09-07T22-27-20-345Z` passed 105. API passed 39 checks, MCP called all 49 tools, extension replay passed with 9 steps, reliability passed 10 tests and exact console capture passed 4 tests. Both-engine runner smoke, 18 JS syntax checks and preservation of the original 14 DB tables passed.

Final logs and frozen-source hashes: `output/qa-final-20260908/`. The sequence captured 193 PNGs. All 13 final desktop pages and selected opened/mobile/adversarial/reliability screenshots were visually reviewed; the exact folder and image inventory is in `QA_RELIABILITY_SUMMARY.md`. Four high dependency advisory entries remain a separate unresolved risk; this functional completion is not production-security certification.
