# Phase 2 Adversarial QA Summary

Run ID: 2026-09-08T20-27-28-014Z
Date: 2026-09-08T20:29:29.244Z
App URL: http://127.0.0.1:3310
Target URL: http://127.0.0.1:4590
Safe external URL: https://example.com
Screenshot folder: output/playwright/qa-phase2-2026-09-08T20-27-28-014Z

## Result

- Checks executed: 105
- Issues found: 0
- Blocker/high issues: 0
- Screenshots captured: 18

## Created QA Data

```json
{
  "userA": {
    "username": "p2a3ki5pl",
    "password": "P2APass3ki5pl!"
  },
  "userB": {
    "username": "p2b3ki5pl",
    "password": "P2BPass3ki5pl!"
  },
  "preTemplateId": "bc83f34d-836d-4245-85b1-47bbccfbd5d8",
  "postTemplateId": "39d049db-17fb-4aad-b22b-281904296f72",
  "ruleSetId": "511f72f8-6776-41a9-a6f9-683a31374248",
  "flowTemplateId": "522f26e7-cef1-44c3-a3c9-692afb9777a9",
  "auditConfigId": "267113d1-5917-456e-b4be-f321d94308c5",
  "interactionConfigId": "b9ac8dfd-3852-4cd9-9a58-99fa2471e412",
  "auditRunIds": [
    "b2c9fe10-2915-40c6-8136-881db10bbbd9",
    "168f6f65-3483-42b0-a733-842adef05999",
    "1cfb30d0-91dd-4292-bd16-70dcda08be35",
    "b047b13b-5d02-430e-8af9-82d6feab4697",
    "7b68d4de-4c77-4f7d-bb9e-1d0718a0e468",
    "7bcc9297-9a08-4e01-a8f7-d4b2012358ef",
    "8c00dd9b-7768-4df7-a596-836020942cd7",
    "1a5ba878-1874-4665-93cc-b6cc51639e86",
    "a1a7804e-1598-42e3-90bd-97ceb35c6c39",
    "5a42d772-5480-44e2-b502-d287888a6e38",
    "8f82684e-4bd8-40eb-b1e1-f26d0addf427"
  ],
  "interactionRunIds": [
    "cf064c5f-6369-4e4e-8968-c24c113b0137",
    "00ff5660-4145-4550-861e-33149f76daee",
    "a4035acb-8627-4d0e-8d36-db11730faf26",
    "0134e0c3-5093-432e-80ab-f808efd292f5",
    "557781d9-1aec-4867-915b-30805a5ccea2",
    "01b8263d-fba8-42d4-8850-43359da46cb5",
    "085836cf-7a61-40c2-a099-8a4977216c55"
  ]
}
```

## Checks

| Area | Check | Status | Details |
| --- | --- | --- | --- |
| Authentication | registered p2a3ki5pl | PASS |  |
| Edge validation | create audit blocks empty target | PASS |  |
| Edge validation | audit config blocks empty name | PASS |  |
| Edge validation | action template blocks empty name | PASS |  |
| Edge validation | rule set blocks empty name | PASS |  |
| Edge validation | flow template blocks empty name | PASS |  |
| Edge validation | interaction config blocks empty name | PASS |  |
| Edge validation | audit start rejects empty payload | PASS |  |
| Edge validation | audit config API rejects empty name | PASS |  |
| Edge validation | action template API rejects empty name | PASS |  |
| Edge validation | rule set API rejects empty name | PASS |  |
| Edge validation | flow template API rejects empty name | PASS |  |
| Edge validation | interaction config API rejects empty name | PASS |  |
| Edge validation | interaction config API rejects empty starting URL | PASS |  |
| Edge validation | negative maxPages normalizes without corrupting config | PASS |  |
| Advanced audit runner | no actions start accepted | PASS |  |
| Advanced audit runner | no actions finishes gracefully | PASS |  |
| Advanced audit runner | pre actions only start accepted | PASS |  |
| Advanced audit runner | pre actions only finishes gracefully | PASS |  |
| Advanced audit runner | post actions only start accepted | PASS |  |
| Advanced audit runner | post actions only finishes gracefully | PASS |  |
| Advanced audit runner | combined actions urls sitemap rules start accepted | PASS |  |
| Advanced audit runner | combined actions urls sitemap rules finishes gracefully | PASS |  |
| Advanced audit runner | pass fail and skipped rule states are represented | PASS |  |
| Advanced audit runner | mixed audit exports work | PASS |  |
| Advanced interaction runner | empty journey terminal status | PASS |  |
| Advanced interaction runner | empty journey returns readable zero-step report | PASS |  |
| Advanced interaction runner | single step terminal status | PASS |  |
| Advanced interaction runner | multi step with failing rules terminal status | PASS |  |
| Advanced interaction runner | disabled iframe js navigation evidence is readable | PASS |  |
| Advanced interaction runner | interaction failed-rule status is explicit | PASS |  |
| Advanced interaction runner | multi interaction exports work | PASS |  |
| Advanced interaction runner | failed selector terminal status | PASS |  |
| Advanced interaction runner | failed selector report contains clear error | PASS |  |
| Authentication | logged in p2a3ki5pl | PASS |  |
| Data persistence | /api/audit-configs persists after restart | PASS |  |
| Data persistence | /api/action-templates?type=pre persists after restart | PASS |  |
| Data persistence | /api/action-templates?type=post persists after restart | PASS |  |
| Data persistence | /api/rule-sets persists after restart | PASS |  |
| Data persistence | /api/interaction-flow-templates persists after restart | PASS |  |
| Data persistence | /api/interaction-configs persists after restart | PASS |  |
| Data persistence | /api/audits?limit=50 persists after restart | PASS |  |
| Data persistence | /api/interaction-runs?limit=50 persists after restart | PASS |  |
| Data persistence | stored reports and exports open after restart | PASS |  |
| Authentication | registered p2b3ki5pl | PASS |  |
| Cross-user security | User B blocked from User A audit config | PASS |  |
| Cross-user security | User B blocked from User A pre template | PASS |  |
| Cross-user security | User B blocked from User A post template | PASS |  |
| Cross-user security | User B blocked from User A rule set | PASS |  |
| Cross-user security | User B blocked from User A flow template | PASS |  |
| Cross-user security | User B blocked from User A interaction config | PASS |  |
| Cross-user security | User B blocked from User A audit detail | PASS |  |
| Cross-user security | User B blocked from User A audit results | PASS |  |
| Cross-user security | User B blocked from User A audit json export | PASS |  |
| Cross-user security | User B blocked from User A audit csv export | PASS |  |
| Cross-user security | User B blocked from User A audit SSE logs | PASS |  |
| Cross-user security | User B blocked from User A interaction run | PASS |  |
| Cross-user security | User B blocked from User A interaction results | PASS |  |
| Cross-user security | User B blocked from User A interaction json export | PASS |  |
| Cross-user security | User B blocked from User A interaction csv export | PASS |  |
| Cross-user security | User B blocked from User A interaction SSE logs | PASS |  |
| Cross-user security | User B list excludes User A configs | PASS |  |
| Cross-user security | User B list excludes User A templates | PASS |  |
| Cross-user security | User B list excludes User A ruleSets | PASS |  |
| Cross-user security | User B list excludes User A templates | PASS |  |
| Cross-user security | User B list excludes User A configs | PASS |  |
| Cross-user security | User B list excludes User A audits | PASS |  |
| Cross-user security | User B list excludes User A runs | PASS |  |
| Browser/responsive | desktop long config action labels remain readable | PASS |  |
| Browser/responsive | desktop /dashboard.html renders usable | PASS |  |
| Browser/responsive | desktop /audit-configs.html renders usable | PASS |  |
| Browser/responsive | desktop /interaction-configs.html renders usable | PASS |  |
| Browser/responsive | desktop /rule-sets.html renders usable | PASS |  |
| Browser/responsive | desktop /interaction-report.html?id=cf064c5f-6369-4e4e-8968-c24c113b0137 renders usable | PASS |  |
| Browser/responsive | desktop /?auditId=b2c9fe10-2915-40c6-8136-881db10bbbd9 renders usable | PASS |  |
| Browser/responsive | tablet long config action labels remain readable | PASS |  |
| Browser/responsive | tablet /dashboard.html renders usable | PASS |  |
| Browser/responsive | tablet /audit-configs.html renders usable | PASS |  |
| Browser/responsive | tablet /interaction-configs.html renders usable | PASS |  |
| Browser/responsive | tablet /rule-sets.html renders usable | PASS |  |
| Browser/responsive | tablet /interaction-report.html?id=cf064c5f-6369-4e4e-8968-c24c113b0137 renders usable | PASS |  |
| Browser/responsive | tablet /?auditId=b2c9fe10-2915-40c6-8136-881db10bbbd9 renders usable | PASS |  |
| Browser/responsive | mobile long config action labels remain readable | PASS |  |
| Browser/responsive | mobile /dashboard.html renders usable | PASS |  |
| Browser/responsive | mobile /audit-configs.html renders usable | PASS |  |
| Browser/responsive | mobile /interaction-configs.html renders usable | PASS |  |
| Browser/responsive | mobile /rule-sets.html renders usable | PASS |  |
| Browser/responsive | mobile /interaction-report.html?id=cf064c5f-6369-4e4e-8968-c24c113b0137 renders usable | PASS |  |
| Browser/responsive | mobile /?auditId=b2c9fe10-2915-40c6-8136-881db10bbbd9 renders usable | PASS |  |
| Advanced audit runner | safe external example.com start accepted | PASS |  |
| Advanced audit runner | safe external example.com finishes gracefully | PASS |  |
| Realistic safe target | external audit reaches terminal state with readable evidence | PASS |  |
| Advanced audit runner | stability scratch audit 1 start accepted | PASS |  |
| Advanced audit runner | stability scratch audit 1 finishes gracefully | PASS |  |
| Advanced audit runner | stability scratch audit 2 start accepted | PASS |  |
| Advanced audit runner | stability scratch audit 2 finishes gracefully | PASS |  |
| Advanced audit runner | stability scratch audit 3 start accepted | PASS |  |
| Advanced audit runner | stability scratch audit 3 finishes gracefully | PASS |  |
| Performance/stability | stability 1 config audit completes | PASS |  |
| Performance/stability | stability 2 config audit completes | PASS |  |
| Performance/stability | stability 3 config audit completes | PASS |  |
| Advanced interaction runner | stability interaction 1 terminal status | PASS |  |
| Advanced interaction runner | stability interaction 2 terminal status | PASS |  |
| Advanced interaction runner | stability interaction 3 terminal status | PASS |  |
| Performance/stability | history contains sequential run records | PASS |  |

## Screenshots

- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/01-phase2-desktop-dashboard-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/02-phase2-desktop-audit-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/03-phase2-desktop-interaction-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/04-phase2-desktop-rule-sets-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/05-phase2-desktop-interaction-report-html-id-cf064c5f-6369-4e4e-8968-c24c113b0137.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/06-phase2-desktop-auditid-b2c9fe10-2915-40c6-8136-881db10bbbd9.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/07-phase2-tablet-dashboard-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/08-phase2-tablet-audit-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/09-phase2-tablet-interaction-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/10-phase2-tablet-rule-sets-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/11-phase2-tablet-interaction-report-html-id-cf064c5f-6369-4e4e-8968-c24c113b0137.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/12-phase2-tablet-auditid-b2c9fe10-2915-40c6-8136-881db10bbbd9.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/13-phase2-mobile-dashboard-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/14-phase2-mobile-audit-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/15-phase2-mobile-interaction-configs-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/16-phase2-mobile-rule-sets-html.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/17-phase2-mobile-interaction-report-html-id-cf064c5f-6369-4e4e-8968-c24c113b0137.png
- output/playwright/qa-phase2-2026-09-08T20-27-28-014Z/18-phase2-mobile-auditid-b2c9fe10-2915-40c6-8136-881db10bbbd9.png
