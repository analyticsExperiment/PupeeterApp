# Reliability and Visual QA - 7-8 September 2026

**Completed: nine QA/fix/retest rounds and 17 grouped functional/UI defects fixed.** After the final fix, the open-state suite passed twice consecutively from fresh starts, followed by the deep, adversarial, API, MCP, extension, reliability and console suites. Selected final screenshots were visually reviewed. Final evidence is in `output/qa-final-20260908/`. This is a local workflow verification, not a production-security clearance: four high dependency advisory entries remain open.

## Scope and Outcome

This is a new evidence-based review, not a reuse of the earlier green results. It covers the existing console, both audit engines, interactions, reports/exports, API ownership, MCP interoperability, and the installed recorder extension. No runner was rewritten and no database schema change was added. The only audit-runner change corrects confirmed duplicate console capture; crawl, action and rule-evaluation behavior is unchanged.

Earlier verification is recorded in `output/qa-final-20260907-complete/`, `output/qa-final-20260907-dashboard/`, `output/qa-final-resumed-20260907-165929/`, and `output/qa-final-console-20260907/`. The contrast sequence was intentionally paused at the user's request. The completed final Dashboard refinement and subsequent full verification are recorded in `output/qa-final-20260908/` below.

## Final Verification Evidence

Final sequence completed on 8 September 2026 local time (the screenshot folder timestamps use UTC, so they begin with 7 September). `QA_HEADED=1` was set; each application harness started and stopped its own app instance. No application, test, or dependency files changed during the sequence: all 25 SHA-256 entries in `source-hashes.json` were rechecked after completion. Documentation was finalized afterward.

| Command | Final result | Evidence in `output/qa-final-20260908/` |
| --- | --- | --- |
| `node --check` for 18 changed JS files | All passed | `syntax.log` |
| `npm run qa:open-states` pass 1 | 285 checks, 0 issues, 56 screenshots | `1-qa-open-states.log`, `1-QA_OPEN_STATE_SUMMARY.md` |
| `npm run qa:open-states` pass 2 | 285 checks, 0 issues, 56 screenshots | `2-qa-open-states.log`, `2-QA_OPEN_STATE_SUMMARY.md` |
| `npm run qa:deep` | 118 checks, 0 issues, 53 screenshots | `3-qa-deep.log`, `3-QA_REGRESSION_SUMMARY.md` |
| `npm run qa:phase2` | 105 checks, 0 issues, 18 screenshots | `4-qa-phase2.log`, `4-QA_PHASE2_REGRESSION_SUMMARY.md` |
| `npm run qa:api` | 39 checks passed | `5-qa-api.log` |
| `npm run qa:mcp` | All 49 tools called successfully through the official SDK | `6-qa-mcp.log` |
| `npm run qa:extension` | Replay smoke passed with 9 recorded steps | `7-qa-extension.log` |
| `npm run qa:reliability` | 10 tests passed, 0 skipped, 10 screenshots | `8-qa-reliability.log` |
| `npm run qa:console` | 4 tests passed, including both real audit engines | `9-qa-console.log` |
| `node tests/qa/database-preservation.js output/qa-backup-20260907-001857/audits.db` | 14 original tables preserved, integrity OK, 0 foreign-key errors, 2 idempotent initializations | `database-preservation.json` |
| `node tests/qa/audit-runner-smoke.js` | Both engines: 2 pages, 2 console messages, 0 rule failures, Browser closed | `runner-smoke.log` |
| `npm audit --json` | 4 high advisory entries, 0 critical; unresolved installer-chain risk | `dependency-audit.json` |

The command pipeline exited successfully and wrote `FINAL COMPLETE: ALL SUITES PASSED` to `completion.log`. The dependency audit is a separate risk review and is not included in that success claim. The MCP log includes an intentional missing-name validation error from its negative test; that request was rejected as expected, not an unhandled suite failure.

### Final Screenshot Inventory and Review

193 PNGs were captured in the final sequence, with the folder counts independently verified:

| Exact folder below `output/playwright/` | PNGs | Review record |
| --- | --- | --- |
| `qa-open-states-2026-09-07T22-24-14-405Z` | 56 | First consecutive final pass; behavior and geometry assertions passed. Visual acceptance used the second final pass below. |
| `qa-open-states-2026-09-07T22-25-00-222Z` | 56 | Visually reviewed all 13 main desktop pages and the key opened/mobile states listed below. |
| `qa-regression-2026-09-07T22-25-44-597Z` | 53 | Deep functional screenshot evidence. Not every PNG was individually reviewed; equivalent final report states were reviewed in the open-state folder. |
| `qa-phase2-2026-09-07T22-27-20-345Z` | 18 | Visually reviewed `13-phase2-mobile-dashboard-html.png`, confirming long-name action readability in the adversarial fixture. |
| `qa-reliability-2026-09-07T22-30-07-618Z` | 10 | Visually reviewed long-name controls at 1440/820/390px, `installed-extension-popup.png`, `mobile-settings-token.png`, and `390-navigation-open.png`. |

In the second open-state folder, the reviewed default pages were `01-desktop-dashboard.png` through `13-desktop-interaction-report.png`. Reviewed interactive evidence included the vendor picker open/search/expectation states, mobile vendor picker, audit-config and interaction-template pickers, mobile interaction action picker, network/request-detail/dataLayer/console/rules modals, `54-interaction-report-requests-modal-open.png`, and both mobile reports (`38` and `39`). Text, popover containment, controls and modal layering were acceptable in those reviewed states. Intentionally failing rule fixtures explain FAILED labels in some report screenshots; they are not test failures.

This is a selected, documented visual review, not a claim that all 193 PNGs or native operating-system menus were visually certified. Long tables intentionally scroll within their own regions. The magenta rectangle in the token screenshot is the test's secret-redaction mask, not an application color or rendering defect.

### Local Evaluation

The existing application is available at `http://127.0.0.1:3000`; the final QA harnesses used separate ports. The existing server and original DB were not replaced during finalization. API/MCP usage and local dummy-account details remain in `docs/AGENT_API_AND_MCP.md`; Postman imports are `docs/postman/Free Audit Agent API.postman_collection.json` and `docs/postman/Free Audit Local.postman_environment.json`. Use the dummy account only locally and do not reuse its credentials for client or hosted deployments.

## Recursive QA Rounds

1. Baseline and independent probes: existing suites passed, but a standard MCP client timed out and focused recorder/settings/failure-status tests reproduced defects.
2. Functional repairs: fixed protocol compatibility, input ordering, duplicate events, recorder persistence/tab isolation, token cancellation, and live failure details. Tested the real installed extension, not only injected scripts.
3. Shared UI and navigation: refreshed the console styling, added compact mobile navigation and an Interaction Runs entry, exposed the previously hidden scratch-audit entry point, and fixed a stretched mobile header discovered by the new test.
4. Screenshot-led fixes: found mobile picker clipping despite green geometry checks. Tightened the check, reproduced the failure with actual bounding boxes, and removed the conflicting viewport-width override.
5. Final polish and test-quality repairs: corrected low-contrast report text, mobile token-button wrapping and duplicate recorder numbering. Replaced focus-only native-menu probes with click/open-state/dismissal/keyboard tests. Froze application files before the final full sequence.
6. Final screenshot review caught broken-word dashboard status labels at mobile width. Added a contained scrollable table with a sticky Open column, nonwrapping status labels, and stable scrollbar space. Added dashboard-specific assertions and repeated the final suites. The first sequence's interrupted Phase 2 was rerun successfully before this additional refinement.
7. Closer inspection of the deep suite's console modal found pale information text missed by the earlier report-detail review. Measured the failure at 1.84:1, changed information/status text colors without changing capture or log behavior, and added a real console-modal screenshot and 4.5:1 regression check. Repeated the clean-start final sequence again.
8. Resumed full sequence passed, then screenshot review exposed duplicated console rows in both audit engines. A new real-browser exact-count test reproduced one log call becoming two report entries. Removed the redundant in-page console interception/append path, retained native console/pageerror capture and structured arguments, and added assertions for true repeats, formatting, iframe logs, runtime errors, rejected promises, actions, per-page isolation and rule evaluation.
9. Reviewed adversarial long-name screenshots and found Dashboard Run/Edit labels compressed into vertical text. A focused test reproduced 29px-wide, 68px-high controls even on desktop. Reserved action width and stacked mobile shortcut content/actions; added three Phase 2 readability checks and a real UI Edit-link regression at three viewport sizes.

These are nine test/fix/retest rounds, not nine claims of exhaustive full-suite coverage. Broad suites were repeated during the work; archived final logs identify precisely what passed on the final version.

## Issue Log

### REL-01 - High - MCP interoperability
- Reproduce: connect an official SDK `Client` using `StdioClientTransport` to the old server.
- Expected: initialization and tools/list complete. Actual: initialization timed out after 4 seconds.
- Root cause: custom Content-Length framing, also copied into the old smoke test, instead of MCP's newline-delimited stdio protocol.
- Fix/files: `mcp/free-audit-mcp.js`, `package.json`, `package-lock.json`, `tests/mcp/mcp-smoke.js`; official SDK server/client transport, unchanged tool names and API payloads.
- Retest: all 49 tools called successfully, including CRUD readback, JSON/CSV exports and ownership denial. Screenshot: not applicable; protocol/console evidence in the MCP log.

### REL-02 - High - Recorder loses or reorders typed input
- Reproduce: type and immediately stop, click submit, pause, or navigate before the debounce expires.
- Expected: final text is captured before the later action. Actual: pending text was omitted or appeared after submit.
- Root cause: unflushable WeakMap timers and no action-boundary flush.
- Fix/files: `extension/free-audit-recorder/recorder.js`; tracked timers, flush before action boundaries, cancel on reset, retain masking.
- Retest: immediate-stop and fill-before-submit assertions pass; real extension preserves input across navigation. Screenshot: nonvisual event-order defect; reliability test evidence.

### REL-03 - High - Recorder duplicates form/control actions
- Reproduce: click submit or check a checkbox while recording.
- Expected: one executable action per intent. Actual: click plus submit/Enter or checkbox-change generated duplicate actions.
- Root cause: independent overlapping click, submit, key and change handlers.
- Fix/files: `extension/free-audit-recorder/recorder.js`; dedicated change handling and submit-intent deduplication.
- Retest: no duplicate pressKey on submit; one checkbox action; saved safe steps replay successfully. Screenshot: nonvisual event-sequence defect.

### REL-04 - High - Recorder state across navigation/tabs
- Reproduce: start a recording, navigate to another page, reopen the popup, or open another tab.
- Expected: the recording and pause state stay with the original tab. Actual: in-page state was reset; popup/global storage was not a reliable per-tab source of truth.
- Root cause: no service-worker-backed per-tab restore lifecycle; iframe message responses could also compete with the main frame.
- Fix/files: new extension `background.js`, `contentScript.js`, `recorder.js`, `manifest.json`, `popup.js`; serialized session storage keyed by tab, top-frame routing, restore on navigation, cleanup on tab close.
- Retest: installed extension navigation, popup reopen/save, second-tab isolation, pause/reload/resume, and masking all pass. Screenshot: latest reliability `installed-extension-popup.png`.
- Compatibility: automatic iframe recording was not dependable before and is now explicitly unsupported; manual frame steps and runner iframe support remain intact.

### REL-05 - Medium - Saved recording starts on the final page
- Reproduce: record a multi-page journey and save it as an interaction config from the last page.
- Expected: startingUrl is the first recorded navigation. Actual: active tab URL was used.
- Fix/files: `extension/free-audit-recorder/popup.js`; prefer the first openUrl, retaining the existing fallback and payload shape.
- Retest: installed-popup save followed by API readback confirms the initial URL and all steps. Screenshot: latest reliability popup evidence.

### REL-06 - Medium - Cancelling pairing-token naming creates a token
- Reproduce: Settings > Create Pairing Token > Cancel.
- Expected: no write. Actual: falsy prompt result fell through to a default label and POST.
- Fix/files: `public/settings.js`; return on null, disable pending controls, handle revoke failures, clear the one-time secret after revocation.
- Retest: cancellation preserves count; create/auth/revoke/401 lifecycle passes; an injected 503 displays its error and allows retry. Screenshot: latest reliability `mobile-settings-token.png`, secret masked.

### REL-07 - Medium - Failed interaction status omits its error
- Reproduce: run a click against a missing selector and poll status before restarting the server.
- Expected: failed status includes the step error. Actual: database error existed but the live job error was null.
- Fix/files: `server.js`; assign a step-specific error (or rule-failure reason) to the in-memory job and persist that same error.
- Retest: missing-selector status explains the failed step while the server is live. No runner behavior changed. Screenshot: nonvisual API defect.

### REL-08 - Medium - Scratch audit has no visible entry point
- Reproduce: log in and choose Create Audit without knowing the `?scratch=1` URL.
- Expected: start an unsaved audit through the UI. Actual: only saved-config actions were offered; old tests navigated directly to the hidden URL.
- Fix/files: `public/index.html`; visible Start From Scratch link to the existing form.
- Retest: click-through test reaches the blank config selector and editable target field; deep audit journey passes. Screenshot: latest reliability `scratch-audit-entry.png`.

### REL-09 - Medium - Audit console messages and errors are counted twice
- Reproduce: audit a local page with one `console.log('qa-once')` in either engine, then open Console in its report.
- Expected: one entry per emitted event; genuine repeated calls remain separate. Actual: one browser event plus its in-page fallback copy were both appended, inflating summary/error counts and potentially count-based rules.
- Screenshot: `output/playwright/qa-regression-2026-09-07T17-01-41-250Z/48-config-console-modal.png` shows repeated messages a few milliseconds apart. Exact failing assertions for both engines are in `output/qa-console-capture-red.log` (`2 !== 1`).
- Root cause: native `console`/`pageerror` listeners were combined with unconditional `window.__capturedConsole` append, without event identity.
- Fix/files: `src/audit/auditRunner.js`, `src/audit/playwrightRunner.js`, `src/audit/runnerShared.js`; use native events as the source of truth, remove redundant injected interception/append, serialize object arguments while retaining primitive browser formatting and fallback text on serialization failure. Entry shape stays `{type,text,ts}`; existing saved reports are untouched.
- Tests/files: new `tests/qa/console-capture-regression.js`, `npm run qa:console` in `package.json`. The fixture explicitly sets the existing rule evaluation limit to include the final action message; its initial missing limit caused a test-only rule expectation failure after duplicate counts were fixed.
- Retest: exact-count and nearby/full verification recorded in the final evidence section below.

### VIS-01 - Medium - Mobile navigation consumes excessive space
- Reproduce: view sparse pages at 390px/820px; the old full sidebar stack displaced content. During the refinement, grid row stretching also enlarged the collapsed header.
- Expected: compact navigation with reachable links and a stable collapsed height.
- Fix/files: `public/shared-layout.js`, `public/styles.css`; accessible toggle, Escape/outside close, active aria-current, explicit mobile grid rows, separate Interaction Runs link.
- Retest: collapsed header under 80px, navigation/click-through/close and overflow checks pass at both widths. Screenshots: reliability `390-navigation-open.png`, `390-navigation-closed.png`, and 820px counterparts.

### VIS-02 - Medium - Mobile catalog popover clips its right edge
- Reproduce: open the Rules Tag Vendor picker at 390px with a page scrollbar.
- Expected: popover is inside the usable viewport with a margin. Actual: right edge 378.4px versus client width 375px; old tests compared against innerWidth including the scrollbar.
- Evidence: `output/playwright/qa-open-states-2026-09-07T00-14-32-904Z/mobile-rules-vendor-picker-open.png`; stricter geometry test failed.
- Root cause: innerWidth calculation plus a mobile `100vw !important` CSS override.
- Fix/files: `public/rules.js`, `public/styles.css`, `tests/qa/open-state-visual.js`; client viewport dimensions, remove override, require an 8px usable-viewport margin.
- Retest: strict geometry, search, selection, save/reload, Escape and outside close pass. No rule data/evaluation changes.

### VIS-03 - Low - Report contrast and crowded rule fields
- Reproduce: inspect request-detail headings/JSON keys and seven-column expectations on desktop.
- Expected: readable text and usable field widths. Actual: pale yellow text on white and truncated selector labels.
- Fix/files: `public/styles.css`; dark teal detail/key text, two-row expectation layout, neutral surfaces, improved summary/table/form hierarchy, restrained borders, sticky modal header and consistent focus styling.
- Retest: report screenshots visually reviewed; no panel/document overflow detected. Evidence: latest open-state request details, vendor picker and reports.

### VIS-04 - Low - Mobile Revoke label breaks mid-word
- Reproduce: Settings with an active token at 390px.
- Expected: readable Revoke control. Actual: equal-width table cells split the label into two lines.
- Evidence: `output/playwright/qa-reliability-2026-09-07T00-16-46-445Z/mobile-settings-token.png`.
- Fix/files: `public/styles.css`; content-sized token table, compact nonwrapping revoke control.
- Retest: mobile lifecycle test checks nonwrapping and viewport containment; screenshot re-reviewed.

### VIS-05 - Low - Recorder preview numbering/disabled states
- Reproduce: inspect a stopped recording in the popup.
- Expected: one number per step and distinguishable disabled controls. Actual: ordered-list markers plus manually prefixed numbers showed `1. 1.`; disabled buttons looked active.
- Fix/files: extension `popup.js`, `styles.css`; use list numbering only, visible disabled/focus states and primary-action color.
- Retest: installed-extension DOM assertion and popup screenshot review. No recorded-step data changed.

### VIS-06 - Medium - Mobile dashboard table breaks words
- Reproduce: open Dashboard with at least one completed audit at 390px. Inspect Recent Audits.
- Expected: readable status, URL and date columns with a reachable Open link. Actual: five equally narrow columns broke COMPLETED over two lines and split URLs into fragments.
- Screenshot: `output/playwright/qa-open-states-2026-09-07T12-14-46-695Z/27-mobile-dashboard.png`; live viewport probe `output/qa-dashboard-populated-before.png` confirms the wrapping.
- Console/network evidence: none; DOM showed `white-space: normal` and a 38.6px-high status label. The new regression failed before the fix; `output/qa-dashboard-red-issues.md` preserves the result.
- Root cause: fixed-layout table compressed into the mobile viewport without its own scroll container. Apparent metric-card clipping in full-page PNGs was separately traced to screenshot-induced scrollbar reflow, not actual card overflow.
- Fix/files: `public/dashboard.html`, `public/styles.css`; contained keyboard-focusable table region, sensible minimum table width, sticky Open column, nonwrapping statuses, stable scrollbar gutter. Also prevent the Settings Active status from splitting.
- Tests/files: `tests/qa/open-state-visual.js` adds nine dashboard containment/readability checks and brings native selects to the foreground before opening them; `tests/qa/reliability-regression.js` checks the token status does not wrap. Native probes in the initial red run also lost focus while a separate diagnostic browser was opened; final suites run without competing diagnostic windows.
- Retest: the exact open-state suite passed after the fix, then passed twice again at 284 checks per run in `output/qa-final-20260907-dashboard/`. Deep, Phase 2, API, MCP, extension, reliability and database checks also passed in that sequence.

### VIS-07 - Medium - Console information text has insufficient contrast
- Reproduce: open a saved audit report, then its Console modal with information-level messages.
- Expected: easily readable message text on white. Actual: pale gold `rgb(232,185,49)` information text against white measured only 1.84:1 contrast.
- Screenshot/evidence: `output/qa-console-contrast-before.png`; independent live report DOM probe confirmed the foreground/background colors and ratio.
- Console/network evidence: no runtime failure; this is a visual accessibility defect.
- Root cause: informational text reused the bright button-fill accent color. Similar accent-colored live-log labels and running-status text had the same risk.
- Fix/files: `public/styles.css`; dark teal information/live-log labels and darker amber running/processing status text. Error/warning severity colors and log contents remain unchanged.
- Test/files: `tests/qa/open-state-visual.js`; actually open Console, capture `report-console-modal-open.png`, measure each message against its opaque background, require at least 4.5:1 contrast, then close the modal normally.
- Retest: fresh full sequence below.

### VIS-08 - Medium - Long Dashboard config names squeeze Run/Edit labels
- Reproduce: save a valid config with a long unbroken name, then open Dashboard on desktop or mobile.
- Expected: names wrap without shrinking action labels; Edit remains reachable. Actual: Run and Edit were approximately 29px wide and 68px high, with letters stacked vertically.
- Screenshot/evidence: `output/playwright/qa-phase2-2026-09-07T17-35-45-510Z/13-phase2-mobile-dashboard-html.png`; focused red screenshot in `output/playwright/qa-reliability-2026-09-07T17-40-20-568Z/1440-long-config-buttons.png`; `output/qa-dashboard-long-name-red.log` records the measured failure.
- Console/network evidence: none; this was flex sizing and inherited text wrapping, not a request failure.
- Root cause: the shortcut action group could shrink next to unbroken names and inherited arbitrary word wrapping.
- Fix/files: `public/styles.css`; Dashboard-only nonshrinking action group, single-line labels, and stacked content/actions below 600px. No other card layouts or run behavior changed.
- Test/files: `tests/qa/reliability-regression.js` verifies button dimensions and follows Edit at 1440/820/390px; `tests/qa/phase2-adversarial.js` adds three long-name action-label checks using the existing adversarial config fixture.
- Retest: focused test passes at all three widths; desktop/mobile screenshots visually reviewed in `output/playwright/qa-reliability-2026-09-07T22-22-53-492Z/`. Final full-sequence evidence below.

## Test Improvements

- New `npm run qa:reliability`: ten focused tests, including real unpacked-extension installation, service-worker persistence, tab isolation, popup API save/readback, and long-name Dashboard controls.
- New `tests/qa/database-preservation.js`: repeated schema initialization, SQLite integrity/foreign keys, original primary-key preservation and unchanged stored report contents against the pre-QA backup.
- New `npm run qa:console`: four focused tests, including exact event counts through both real audit engines, structured arguments, genuine repeats, primitive event text, iframe/runtime/rejection logs, per-page isolation, rule results, and serialization fallback.
- MCP smoke now uses an independent standards-based client and calls every exposed tool instead of only checking tool names.
- Open-state suite now has 285 assertions and 56 screenshots, including real native select `:open`, Escape/outside dismissal, keyboard selection, dashboard readability and console text contrast. Open controls and the mobile dashboard use viewport screenshots; other normal pages retain full-page evidence.
- Phase 2 now honors `QA_HEADED=1` for its console browser and adds three long-name control-readability checks (105 checks total). Audit/interaction job visibility remains determined by each test payload.

## Data Safety and Dependencies

- Source copy and online SQLite backup: `output/qa-backup-20260907-001857/`.
- Existing data was not deleted. Temporary QA users/configs/runs remain deliberately available for inspection. No database migration was added.
- Database validation preserves all 14 baseline tables, including 152 existing audits and 81 existing interaction runs and their saved report content. Schema initialization twice is idempotent; integrity is OK and foreign-key errors are zero.
- Added the official MCP SDK. Compatible transitive dependency updates reduced npm audit findings from 13 to 4, with no critical findings remaining.
- OPEN DEPENDENCY RISK: four high advisory entries share the `extract-zip` browser-installer path (`GHSA-jmr9-qjv8-65gv`). npm proposes a Puppeteer 25 major upgrade. That migration is deferred rather than forced into this conservative QA patch. Do not extract untrusted browser archives. This is not a claim that the dependency risk is absent or fully mitigated.

## Limitations and Manual Checks

- High confidence in the tested local workflows, not a guarantee that every possible site, dataset or browser condition is defect-free.
- Chromium headed desktop/tablet/mobile viewport testing is not real iOS/Android/Safari/Firefox testing. Soft-keyboard and screen-reader accessibility need device review.
- Native OS dropdown surfaces are not present in Playwright page PNGs even when `:open` proves they are open. Their opening, selection and dismissal are tested, but OS-native menu appearance still needs manual inspection. Custom vendor popovers are captured and visually reviewed.
- Extension tests use the real extension runtime; its popup is rendered in an extension page for automation. Clicking Chrome's actual toolbar popup and store-packaged installation remain manual checks.
- Recorder supports top-level DOM journeys, not automatic iframe/closed-shadow/canvas/drag/drop/file-upload recording. Exact pixel scroll restoration and arbitrary SPA routing are not guaranteed. Masking is heuristic; review recorded values and handle placeholders before replay.
- External testing is a one-page `https://example.com` probe per Phase 2 run, not broad third-party crawling. Large crawls, long-duration memory soak, multi-machine deployment and adversarial public hosting were not certified.
- Historical report JSON is intentionally not rewritten. Reports saved before REL-09 may still show duplicate console rows/counts; rerun an audit when corrected fresh counts are required.
- Before client use: reload the unpacked extension, restart the MCP client, hard-refresh the console, run one small authorized real journey in each chosen engine, inspect rules/capture/exports, and use non-default credentials. Keep the app local until deployment/security hardening and the dependency major upgrade are reviewed.

## Changed Files

Application: `server.js`, `public/index.html`, `public/dashboard.html`, `public/rules.js`, `public/settings.js`, `public/shared-layout.js`, `public/styles.css`.

Targeted audit console-capture fix: `src/audit/auditRunner.js`, `src/audit/playwrightRunner.js`, `src/audit/runnerShared.js`. The interaction runner is unchanged.

MCP/dependencies: `mcp/free-audit-mcp.js`, `package.json`, `package-lock.json`.

Extension: `background.js` (new), `contentScript.js`, `manifest.json`, `popup.js`, `recorder.js`, `styles.css` under `extension/free-audit-recorder/`.

Tests: `tests/mcp/mcp-smoke.js`, `tests/qa/open-state-visual.js`, `tests/qa/phase2-adversarial.js`, new `tests/qa/reliability-regression.js`, new `tests/qa/database-preservation.js`, new `tests/qa/console-capture-regression.js`.

Documentation: this report, QA issue/test-plan/regression indexes, `mcp/README.md`, extension README, `docs/AGENT_API_AND_MCP.md`, `docs/CHROME_EXTENSION_RECORDER.md`. Generated suite reports and screenshot/log folders are additional evidence, not application source changes.
