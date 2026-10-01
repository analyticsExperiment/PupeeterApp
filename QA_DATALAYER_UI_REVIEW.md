# dataLayer Inspector and Whole-Application UI Review

Date: 8 September 2026. This review follows the user's screenshots, not the assumption that previous green tests guaranteed visual quality.

## Stop Checkpoint

Stopped at the user's requested five-hour allowance threshold: 25% remaining. Implementation is saved. The final sequence passed the seven inspector tests, two consecutive 285-check open-state passes, deep 118, Phase 2 105, API 39, all 49 MCP tools, console 4, reliability 10, extension replay with 9 steps, database preservation across 14 original tables, and both-engine runner smoke. Twelve modified JS files passed syntax checks; all 17 tracked source hashes remained unchanged during verification. Evidence: `output/qa-datalayer-20260908/`.

Final additional run IDs: deep `2026-09-08T06-04-09-637Z`, Phase 2 `2026-09-08T06-05-54-208Z`, reliability `2026-09-08T06-08-56-486Z`. Those generated screenshots are evidence, not a claim of individual visual review; the reviewed images are listed below. The wider page-by-page suggestions remain recommendations, not implemented fixes. No further redesign should be inferred as complete. Existing backend process still needs a normal restart to use the renamed log wording; static UI changes load on refresh. No usage reset was consumed.

## Delivered

- Replaced the audit's unstyled key/value output and the interaction report's separate JSON renderer with one shared inspector. Keys and values stay together; nesting has indentation/disclosure controls; strings, numbers, booleans and null have distinct readable styles.
- Event names and compact previews identify entries before expansion. Before/After and interaction Added snapshots are explicit. Search filters matching entries without removing their other properties. Tree/JSON modes, full-snapshot copying, empty/no-match states and clipboard-denial recovery are implemented.
- Child branches load on demand, with 100-entry batches for large arrays. Expand one level is deliberately bounded; Collapse all affects loaded branches. Raw JSON and copied JSON preserve the complete selected snapshot, regardless of the current filter.
- The same inspector now displays parsed network JSON and interaction rule details. Audit and interaction report dialogs close with Escape; Escape in a populated inspector search clears the filter first.
- Changed human-facing Post-Audit wording to On Page Actions in navigation, scratch forms, config tabs/summaries/pickers, template headings, new runner logs/errors and the MCP tool description. API identifiers such as `postAuditActions`, `postActionTemplates`, and `type=post` remain compatible. Technical JSON/configuration dumps and historical saved log text are deliberately not rewritten. User-created names are not renamed.
- Escaped On Page error messages in report HTML; an error containing markup can no longer be interpreted as a new HTML element.

No database schema, stored report, capture algorithm, rule evaluator or runner execution sequence was changed. Runner edits are log/error wording only. The existing port-3000 process was left running; browser refresh loads the UI, while that older process needs a normal restart to use the updated backend log wording.

## New Focused Tests

`npm run qa:json` runs seven browser tests in `tests/qa/json-inspector-regression.js`:

1. Audit inspector: same-line key/value geometry, nested ecommerce expansion, search/highlighting, exact raw/copy readback, empty snapshots and Escape.
2. Values: markup is inert; long strings are intact; false, null, zero and empty structures remain distinguishable; collapse/expand works.
3. Desktop/tablet/mobile containment and reachable controls at 1440, 820 and 390px.
4. Interaction step Before/After/Added and final-journey dataLayer use the same renderer.
5. A 2,000-entry snapshot is batched, later entries can be searched, and rebuilding modal HTML does not duplicate controls.
6. On Page wording is visible while legacy URLs remain valid.
7. Report error text is inert and denied clipboard access falls back to selectable raw JSON.

The focused report payloads are deliberately mocked to exercise edge cases; they do not replace runner tests. The real saved Sky audit from the user's screenshot was also opened in the in-app browser: its 19-entry After snapshot rendered correctly without rerunning or altering that audit.

## Current Visual Evidence

- `output/playwright/qa-json-inspector-2026-09-08T06-02-19-483Z/`: seven focused tests passed; 12 PNGs. Reviewed the mobile inspector, and expanded desktop/tree/raw/search states in the preceding focused iterations. The final mobile command buttons are grouped rather than splitting individually across rows.
- `output/playwright/qa-open-states-2026-09-08T06-02-33-441Z/`: visually reviewed all 13 main desktop screenshots, `01` through `13`, for the page-by-page assessment below. 285 behavioral/geometry checks passed.
- `output/playwright/qa-open-states-2026-09-08T06-03-22-404Z/`: second consecutive 285-check pass; the final dataLayer modal screenshot was visually reviewed.
- Logs and immutable source hashes for this sequence: `output/qa-datalayer-20260908/`. Final cross-suite outcome is recorded after all commands finish.

## Page-by-Page Feedback

These are prioritised recommendations, not claims that the remaining experience is already polished. The screenshot number refers to the first open-state folder above.

| Step / Screen | Current assessment | Recommended next change |
| --- | --- | --- |
| 1. Dashboard (`01`) | Readable and restrained; recent jobs and saved configs are accessible. | Make failed-rule totals actionable, with a filtered list of affected audits. |
| 2. Create Audit (`02`) | Workflow works, but the long form and generic Free Audit heading make orientation and the final Start button harder to find. | Use a task-specific title and a persistent run/save action area; collapse optional sections with configured-step counts. |
| 3. Audit History (`03`) | Reports reopen, but the latest-detail area repeats metrics and exposes a dense raw configuration table. | Add date/status/domain filters and a compact details panel; put structured configuration behind an inspector instead of an always-expanded JSON dump. |
| 4. Audit Configs (`04`) | Search and cards are readable; a small number of records consumes a large area. | Use denser rows with explicit Open/Run controls and consistent engine, page-limit and last-run columns. |
| 5. Pre-Audit templates (`05`) | Search works; repeated step counts and template metadata compete for attention. | Standardise list/editor spacing, show the count once, and use familiar reorder icons with accessible names. |
| 6. On Page templates (`06`) | New name is consistent; behaviour remains per scanned page. | Match the same compact library/editor layout as Pre-Audit templates. Preserve the distinction between once-per-audit and once-per-page actions. |
| 7. Rules (`07` and scratch builder in `02`) | Searchable vendor controls are an improvement; multiple nested sections still make the editor visually heavy. | Provide a concise condition/expectation summary when collapsed and put rule preview/test output beside the editor. |
| 8. Interaction Configs (`08`) | Config search and run metadata are available. | Align the library with Audit Configs and use a status badge instead of low-emphasis text for a failed last run. |
| 9. Interaction Flow Templates (`09`) | Ordered steps are editable, but the layout differs from the other template libraries. Tiny Up/Dn controls and unrelated fields add friction. | Use the shared action-editor layout and action-specific fields; make reordering keyboard-friendly and visibly reachable. |
| 10. Interaction Runs (`10`) | History and exports are clear; a full UUID takes space in the main row. | Move IDs into details/copy controls, add filters, and distinguish execution failures from validation failures. |
| 11. Settings (`11`) | Account and token sections are readable. Defaults is informational with no direct action in this state. | Add a direct default-config selector or link to its configuration; group integrations separately from account preferences. |
| 12. Audit Report (`12`) | New dataLayer inspection is much clearer. Generic page heading, introductory copy, and six request-information cards push findings below the first viewport. | Lead with audit/config name, target, time and failures. Collapse request metadata and make page-result drilldowns keyboard-focusable buttons. |
| 13. Interaction Report (`13`) | Per-step captures are comprehensive. FAILED alongside 3 passed steps and 0 failed steps is easy to misread, although the 3 failed rules explain it. | Show separate execution and validation outcomes; collapse successful steps and open the first failed rule by default. |

### Highest-Priority Follow-Up

1. Reports: findings-first layout, explicit run identity, and separate execution/rule outcomes.
2. History and configuration details: compact searchable lists and readable structured data instead of raw dumps.
3. Editors: one consistent layout across Pre-Audit, On Page and interaction templates, with meaningful field labels and accessible reorder controls.
4. Keyboard accessibility: native report-drilldown buttons, dialog focus containment/return, and screen-reader verification. The new inspector supports native disclosure keyboard behaviour, but this is not a full application accessibility certification.

## Changed Files and Limits

New: `public/json-inspector.js`, `public/json-inspector.css`, `tests/qa/json-inspector-regression.js`, and three pinned Lucide 0.468.0 SVG icons plus their license under `public/vendor/lucide/`. Icons are served locally; no CDN dependency was introduced.

Integration/labels: `public/helpers.js`, `public/interaction-report.js`, `public/app.js`, `public/index.html`, `public/interaction-report.html`, `public/action-templates.js`, `public/audit-configs.html`, `public/audit-configs.js`, `public/shared-layout.js`, `src/audit/auditRunner.js`, `src/audit/playwrightRunner.js`, `src/api/agentOrchestrator.js`, `mcp/free-audit-mcp.js`, `package.json`.

Snapshots are captured JSON, not live JavaScript objects like DevTools: functions, prototypes and values never captured by the runner cannot be reconstructed. Raw JSON for unusually huge payloads can still be expensive even though tree rendering is batched. Search filters top-level entries/properties containing the query; it is not a JSONPath query engine. Native OS menus, real mobile devices, full accessibility and public-deployment security are separate checks. The previously documented four high dependency advisory entries remain unresolved; no dependency upgrade was made in this pass.

The user requested stopping when the five-hour allowance has 25% remaining. Usage is checked during the task; no reset credit is authorised or consumed.
