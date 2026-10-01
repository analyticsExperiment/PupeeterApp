# Report and History UI Continuation

Date: 9 September 2026 local time. This continues the recommendations in `QA_DATALAYER_UI_REVIEW.md`; it does not replace that historical record. The user explicitly removed the 25%-remaining stop rule for this continuation. No usage reset was consumed.

## Scope and Delivery

- Audit reports now identify the config, target, start time and run ID. Request metadata is collapsed initially, keeping findings nearer the top. The sidebar identifies saved reports with Audit History instead of Create Audit.
- All six audit page drilldowns are native keyboard-operable buttons. Audit, history and interaction dialogs contain Tab focus, close with Escape, and return focus to the original trigger, including after nested request details and Back.
- Interaction reports distinguish step execution from rule validation. Missing or incomplete step evidence does not imply successful execution. Later successful steps start collapsed; the first step and steps with execution/rule failures remain open. Rule details open the first failed result.
- Audit History has domain/config/run-ID search, status, inclusive local-date filters, failed-rules-only and Reset. Counts explicitly describe the latest 200 records returned by the existing endpoint, not the entire database.
- History details are compact and configuration/saved snapshots use the shared searchable Tree/JSON inspector. Raw API keys and values remain intact. Existing report/export/re-run/duplicate controls remain available.
- Long captured URLs wrap within mobile reports. Captured titles and navigation/pre-action/flow errors are escaped before being inserted into report HTML.

No API route, payload contract, runner execution, rule evaluation, database schema or stored report was changed. All test writes are isolated QA accounts/data. Existing data is not cleaned up or deleted.

## Issue Log

The first seven entries were found through the previous visual review, current source inspection, or the new browser checks. REP-08 was introduced and caught during this pass. Screenshot paths below are relative to `output/playwright/`; unless described as before-state, they show the fix. Functional fixtures are intentional and are backed by separate real-run suites.

| ID / Severity | Feature and reproduction | Expected / actual before fix | Root cause and files | Fix and focused retest | Screenshot |
| --- | --- | --- | --- | --- | --- |
| REP-01 / medium | Open a saved audit report | Identify the run and findings; instead generic creation heading, creation navigation and expanded request metadata obscured orientation | Report rendering in `public/app.js`, `public/index.html`, `public/shared-layout.js` | Report identity, collapsed metadata, correct active nav; focused report test passes | `qa-reports-2026-09-08T20-23-02-862Z/01-audit-report.png` |
| REP-02 / medium | Reach a report tile using Tab, open a modal, then Tab/Shift+Tab/Escape through nested request details | Keyboard access and focus return; tiles were divs and focus could leave the overlay | `public/app.js`, `public/helpers.js`, `public/interaction-report.js`; shared new `public/report-ui.js` | Native buttons, dialog semantics, focus loop/return; all six tiles and nested Back tested | `qa-reports-2026-09-08T20-23-02-862Z/03-nested-network-details.png` |
| REP-03 / medium | Run passing interaction steps with failing rules; inspect a legacy/incomplete result | Separate execution and validation; overall FAILED beside zero failed steps was easy to misinterpret | `public/interaction-report.js` summary combined outcomes | Explicit execution/validation, accurate failure counts, missing/skipped/incomplete states; seven outcome fixtures plus real interaction regression | `qa-reports-2026-09-08T20-23-02-862Z/04-interaction-outcomes.png` |
| REP-04 / medium | Open History, locate a run and inspect nested configuration | Scannable list and structured configuration; repeated cards/timeline/raw JSON and cramped columns impeded reading | `public/audits.html`, `public/audits.js`, `public/report-ui.css` | Filters, contained table scrolling, compact details and two configuration inspectors; filter and exact-JSON readback tests pass | `qa-reports-2026-09-08T20-23-02-862Z/08-history-configuration.png` |
| REP-05 / medium | Delay audit A detail, select B, then release A response | B must remain selected and displayed; old unguarded fetch could replace B with A | Async `selectAudit` in `public/audits.js` | Request sequence guard also invalidated by filtering; deliberately out-of-order response test passes | `qa-reports-2026-09-08T20-23-02-862Z/09-history-loading.png` |
| REP-06 / medium | Render a report with a 600-character unbroken URL at 390px | Contained wrapping; first focused run failed with document overflow | Flex metadata's intrinsic text width; `public/report-ui.css` | Block/wrapping metadata and min-width constraints; three-width checks and long-URL exact regression pass | `qa-reports-2026-09-08T20-23-02-862Z/11-audit-long-text.png` |
| REP-07 / high | Return HTML markup in a captured title or navigation/action error | Display inert text; source interpolation could interpret the captured markup | `renderPage` in `public/app.js` | Escape captured text and restrict page Open links to HTTP(S); hostile markup produces no image/script node in the regression | Same long-text screenshot as REP-06; source-confirmed, no before-exploit screenshot |
| REP-08 / medium | Inspect the new History status field at 390px | Fully visible selected text; inherited padding within the fixed height clipped the value | New filter CSS combined with shared input sizing | Explicit padding/height; native-select font glyph metrics checked against inner height; visual retest acceptable | Before: `qa-reports-2026-09-08T20-20-14-368Z/10-history-390.png`; after: `qa-reports-2026-09-08T20-23-02-862Z/10-history-390.png` |

No unexpected browser console errors or failed same-origin requests were observed by the focused suite. The deliberate asynchronous delay and hostile-text fixtures are not unexpected network failures.

## Recursive Verification

Three product refinement cycles: initial report/history changes; screenshot/geometry-led long-URL and history layout corrections; mobile control sizing and report navigation correction. A separate test-only correction replaced native select `line-height: normal` parsing with measured font glyph height. That NaN assertion was a harness error, not an application failure.

New command: `npm run qa:reports`, implemented by `tests/qa/report-ui-regression.js`. Eight browser tests include seven interaction outcome fixtures, three viewport sizes, dialog keyboard operation, filter/empty/loading/error-range states, exact configuration readback, escaped text and forced out-of-order history responses. Each run creates its own app process and QA account. Focused fixture endpoints are mocked; broad suites exercise actual CRUD, runners, capture, persistence and exports.

Final pipeline evidence: `output/qa-reports-final-20260909/`. Final outcome and exact reviewed folders will be filled after every process finishes; do not interpret this draft as a completed regression claim.

## Remaining Limits and Feedback

- History filters intentionally cover the latest 200 records. Server-side pagination and full-history search remain a future enhancement.
- Long history tables scroll horizontally inside their own focusable region; page-level horizontal overflow is not intended.
- The next UI priorities remain consistent template editors/reorder controls, denser config libraries, optional-section summaries in Create Audit, and actionable dashboard failure totals. These are recommendations, not features implemented by this report-focused continuation.
- Desktop Chromium and emulated tablet/mobile widths are covered, not real iOS/Android devices or full screen-reader certification. Native OS menu pixels are outside Playwright page screenshots.
- Tests primarily use localhost targets with low page counts. This does not establish multi-day load, every third-party consent platform, or production-deployment security.
- The four previously documented high dependency advisory entries remain unresolved in the browser-installer dependency chain. No dependencies were changed this turn. Reassess and remediate before public deployment.
- The inspector displays captured JSON snapshots, not live JavaScript prototypes/functions. Very large raw JSON views can still be expensive.

Recommended manual acceptance: reopen an existing client report without rerunning it; inspect Before/After dataLayer, a nested network request and a failed rule; compare execution and validation on an interaction report; filter History on a small phone; confirm keyboard focus returns after closing each modal. Perform a low-count consent journey on an authorized staging site before running against a real client site.
