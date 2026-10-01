# QA Regression Summary

Run ID: 2026-09-08T20-25-48-763Z
Date: 2026-09-08T20:27:26.237Z
App URL: http://127.0.0.1:3300
Target URL: http://127.0.0.1:4567
Browser mode: headed Playwright Chromium
Screenshot folder: output/playwright/qa-regression-2026-09-08T20-25-48-763Z

## Result

- Checks executed: 118
- Issues found: 0
- Blocker/high issues: 0
- Screenshots captured: 53

## Created QA Data

```json
{
  "userA": {
    "username": "qaatt4davz",
    "password": "QaPasstt4davz!"
  },
  "userB": {
    "username": "qabtt4davz",
    "password": "QbPasstt4davz!"
  },
  "auditId": "5444ec63-533e-49c6-a67f-0b165bd1d6af",
  "configAuditId": "82951ed8-b30d-40e2-bc57-ec49e3fa26cb",
  "interactionRunId": "a0e81dcc-c5d4-4207-b7ea-6ca0ba600ebc",
  "preTemplateId": "626cfced-74de-4feb-83b3-92b82350e80d",
  "postTemplateId": "c2823ce9-1604-4b29-a628-3b0b72bd5bf6",
  "ruleSetId": "ae41b5c2-f069-4e49-890c-061228b8f5b7",
  "flowTemplateId": "2247fcb8-b591-403a-badc-0cf265657a4c",
  "auditConfigId": "8616011a-b7f9-4938-8589-11897d203c7b",
  "interactionConfigId": "007f19a7-20f7-464f-8835-89484e80d9c2"
}
```

## Checks

| Area | Check | Status | Details |
| --- | --- | --- | --- |
| Authentication | unauthenticated API returns 401 | PASS |  |
| Authentication | unauthenticated page redirects to login | PASS |  |
| Authentication | registered qaatt4davz | PASS |  |
| Navigation/UI | config launcher is not blank | PASS |  |
| Navigation/UI | config launcher active nav | PASS |  |
| Navigation/UI | config launcher console health | PASS |  |
| Navigation/UI | dashboard is not blank | PASS |  |
| Navigation/UI | dashboard active nav | PASS |  |
| Navigation/UI | dashboard console health | PASS |  |
| Navigation/UI | create audit is not blank | PASS |  |
| Navigation/UI | create audit active nav | PASS |  |
| Navigation/UI | create audit console health | PASS |  |
| Navigation/UI | audit history is not blank | PASS |  |
| Navigation/UI | audit history active nav | PASS |  |
| Navigation/UI | audit history console health | PASS |  |
| Navigation/UI | audit configs is not blank | PASS |  |
| Navigation/UI | audit configs active nav | PASS |  |
| Navigation/UI | audit configs console health | PASS |  |
| Navigation/UI | pre-audit actions is not blank | PASS |  |
| Navigation/UI | pre-audit actions active nav | PASS |  |
| Navigation/UI | pre-audit actions console health | PASS |  |
| Navigation/UI | post-audit actions is not blank | PASS |  |
| Navigation/UI | post-audit actions active nav | PASS |  |
| Navigation/UI | post-audit actions console health | PASS |  |
| Navigation/UI | rules is not blank | PASS |  |
| Navigation/UI | rules active nav | PASS |  |
| Navigation/UI | rules console health | PASS |  |
| Navigation/UI | interaction configs is not blank | PASS |  |
| Navigation/UI | interaction configs active nav | PASS |  |
| Navigation/UI | interaction configs console health | PASS |  |
| Navigation/UI | interaction flow templates is not blank | PASS |  |
| Navigation/UI | interaction flow templates active nav | PASS |  |
| Navigation/UI | interaction flow templates console health | PASS |  |
| Navigation/UI | interaction runs is not blank | PASS |  |
| Navigation/UI | interaction runs active nav | PASS |  |
| Navigation/UI | interaction runs console health | PASS |  |
| Navigation/UI | settings is not blank | PASS |  |
| Navigation/UI | settings active nav | PASS |  |
| Navigation/UI | settings console health | PASS |  |
| Navigation/UI | mobile dashboard is not blank | PASS |  |
| Navigation/UI | mobile dashboard active nav | PASS |  |
| Navigation/UI | mobile dashboard console health | PASS |  |
| Navigation/UI | mobile create audit is not blank | PASS |  |
| Navigation/UI | mobile create audit active nav | PASS |  |
| Navigation/UI | mobile create audit console health | PASS |  |
| Navigation/UI | pre template editor is not blank | PASS |  |
| Navigation/UI | pre template editor active nav | PASS |  |
| Navigation/UI | pre template editor console health | PASS |  |
| Action Templates | pre template saved | PASS |  |
| Action Templates | pre duplicate/delete smoke | PASS |  |
| Navigation/UI | post template editor is not blank | PASS |  |
| Navigation/UI | post template editor active nav | PASS |  |
| Navigation/UI | post template editor console health | PASS |  |
| Action Templates | post template saved | PASS |  |
| Action Templates | post duplicate/delete smoke | PASS |  |
| Navigation/UI | rule set editor is not blank | PASS |  |
| Navigation/UI | rule set editor active nav | PASS |  |
| Navigation/UI | rule set editor console health | PASS |  |
| Rules | rule set saved | PASS |  |
| Rules | rule set duplicate/delete smoke | PASS |  |
| Navigation/UI | interaction flow template editor is not blank | PASS |  |
| Navigation/UI | interaction flow template editor active nav | PASS |  |
| Navigation/UI | interaction flow template editor console health | PASS |  |
| Interaction Flow Templates | flow template saved | PASS |  |
| Interaction Flow Templates | flow template duplicate/delete smoke | PASS |  |
| Reusable Templates | pre template apply opens visible create audit form | PASS |  |
| Reusable Templates | rule set apply opens visible create audit form | PASS |  |
| Reusable Templates | flow template apply opens visible create audit form | PASS |  |
| Navigation/UI | create audit scratch is not blank | PASS |  |
| Navigation/UI | create audit scratch active nav | PASS |  |
| Navigation/UI | create audit scratch console health | PASS |  |
| Audit from Scratch | audit completed with pages | PASS |  |
| Audit from Scratch | SSE/live logs visible | PASS |  |
| Reports | Scratch Tools modal opens/closes | PASS |  |
| Reports | Scratch Network Requests modal opens/closes | PASS |  |
| Reports | Scratch Cookies modal opens/closes | PASS |  |
| Reports | Scratch dataLayer modal opens/closes | PASS |  |
| Reports | Scratch Console modal opens/closes | PASS |  |
| Reports | Scratch Rules modal opens/closes | PASS |  |
| Exports | Scratch audit CSV export | PASS |  |
| Exports | Scratch audit JSON export | PASS |  |
| Navigation/UI | audit history after scratch is not blank | PASS |  |
| Navigation/UI | audit history after scratch active nav | PASS |  |
| Navigation/UI | audit history after scratch console health | PASS |  |
| Navigation/UI | audit config new is not blank | PASS |  |
| Navigation/UI | audit config new active nav | PASS |  |
| Navigation/UI | audit config new console health | PASS |  |
| Audit Configs | config saved with linked assets | PASS |  |
| Audit Configs | config snapshot stored on run | PASS |  |
| Reports | Config Tools modal opens/closes | PASS |  |
| Reports | Config Network Requests modal opens/closes | PASS |  |
| Reports | Config Cookies modal opens/closes | PASS |  |
| Reports | Config dataLayer modal opens/closes | PASS |  |
| Reports | Config Console modal opens/closes | PASS |  |
| Reports | Config Rules modal opens/closes | PASS |  |
| Exports | Config audit CSV export | PASS |  |
| Exports | Config audit JSON export | PASS |  |
| Audit Configs | duplicate/edit/delete duplicate smoke | PASS |  |
| Navigation/UI | interaction config new is not blank | PASS |  |
| Navigation/UI | interaction config new active nav | PASS |  |
| Navigation/UI | interaction config new console health | PASS |  |
| Interaction Configs | interaction run completed with expected step count | PASS |  |
| Interaction Configs | per-step capture includes network/console evidence | PASS |  |
| Exports | interaction JSON export | PASS |  |
| Exports | interaction CSV export | PASS |  |
| Navigation/UI | interaction runs history is not blank | PASS |  |
| Navigation/UI | interaction runs history active nav | PASS |  |
| Navigation/UI | interaction runs history console health | PASS |  |
| Authentication | logout redirects to login | PASS |  |
| Authentication | registered qabtt4davz | PASS |  |
| Authentication | logout redirects to login | PASS |  |
| Authentication | logged in qabtt4davz | PASS |  |
| Security/access control | User B cannot access User A audit config | PASS |  |
| Security/access control | User B cannot access User A pre template | PASS |  |
| Security/access control | User B cannot access User A rule set | PASS |  |
| Security/access control | User B cannot access User A interaction config | PASS |  |
| Security/access control | User B cannot access User A audit detail | PASS |  |
| Security/access control | User B cannot access User A interaction run | PASS |  |

## Screenshots

- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/01-config-launcher.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/02-dashboard.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/03-create-audit.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/04-audit-history.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/05-audit-configs.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/06-pre-audit-actions.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/07-post-audit-actions.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/08-rules.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/09-interaction-configs.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/10-interaction-flow-templates.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/11-interaction-runs.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/12-settings.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/13-mobile-dashboard.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/14-mobile-create-audit.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/15-pre-template-editor.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/16-pre-template-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/17-post-template-editor.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/18-post-template-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/19-rule-set-editor.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/20-rule-set-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/21-interaction-flow-template-editor.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/22-interaction-flow-template-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/23-apply-pre-template-destination.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/24-apply-rule-set-destination.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/25-apply-flow-template-destination.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/26-create-audit-scratch.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/27-scratch-audit-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/28-scratch-audit-report.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/29-scratch-tools-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/30-scratch-network-requests-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/31-scratch-network-request-detail-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/32-scratch-cookies-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/33-scratch-datalayer-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/34-scratch-console-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/35-scratch-rules-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/36-audit-history-after-scratch.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/37-audit-config-new.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/38-audit-config-pre-template-picker.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/39-audit-config-post-template-picker.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/40-audit-config-rule-set-picker.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/41-audit-config-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/42-audit-config-run-report.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/43-config-tools-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/44-config-network-requests-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/45-config-network-request-detail-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/46-config-cookies-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/47-config-datalayer-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/48-config-console-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/49-config-rules-modal.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/50-interaction-config-new.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/51-interaction-config-populated.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/52-interaction-report.png
- output/playwright/qa-regression-2026-09-08T20-25-48-763Z/53-interaction-runs-history.png
