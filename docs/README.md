# Tag & Cookie Auditor — Project Guide

This guide explains what this app does, how the code is organized, and how data flows from the UI through the backend crawler and back to the report. It is written for beginners and includes simple drawings and practical tips.

---

## 1) What the app does

- You enter a domain/URL and optionally a short interaction flow (click/type/wait, etc.).
- The backend opens the site in a headless browser (Puppeteer), crawls links, and for each page:
  - Captures analytics/marketing network requests (e.g., GA, GTM, TikTok, OneTrust, etc.).
  - Reads the `dataLayer` array (before/after) and collects cookies.
- You watch live “Backend Logs” while scanning.
- When it’s done, you get a report per page, unique tools, and CSV/JSON exports.

---

## 2) Quick architecture

```
UI (public/)  -> REST: start/status/results ->  Express API (server.js)
UI (public/)  -> SSE: logs                 ->  Express API (server.js)
Express API   -> run audit ->  src/audit/auditRunner.js -> Puppeteer (Chromium/Chrome)
auditRunner   -> uses      ->  src/audit/flow.js (click/type/etc.)
auditRunner   -> classify  ->  src/audit/utils.js (vendors)
auditRunner   -> results   ->  Express API -> UI report + exports
```

- UI is static HTML/CSS/JS (no framework) served by Express.
- Server has minimal endpoints to kick off, poll, stream logs (SSE), and return results/CSV/JSON.
- Audit runner handles all crawling and collection.

---

## 3) Folder & file map

- `server.js` — Express app, job store, SSE logs stream, REST endpoints, static UI.
- `src/audit/auditRunner.js` — Core crawler: launches Chromium, navigates, captures analytics, dataLayer, cookies; builds results.
- `src/audit/flow.js` — Simple, declarative interaction steps (click/type/navigate/wait/etc.).
- `src/audit/utils.js` — URL helpers + vendor classification (GA, GTM, ads pixels, consent tools, etc.).
- `public/` — Client-side app (HTML/CSS/JS) to start audits, watch logs, and view reports.
  - `index.html` — App shell and modal container.
  - `styles.css` — Dark theme, tiles, tables, logs, JSON tree.
  - `app.js` — Frontend logic: start job, poll status, draw report, bind modals.
  - `helpers.js` — Vendor grouping, request/cookie/datalayer modals, JSON tree, modal stack, IST timestamp formatter.
- `docs/README.md` — This document.

---

## 4) Endpoints (server.js)

- `POST /api/audit/start` — Start a job. Body example:
  ```json
  {"domain":"https://example.com","maxPages":15,"maxDepth":2,"sameOriginOnly":true,"waitUntil":"domcontentloaded","flow":[]}
  ```
- `GET /api/audit/:id/status` — Poll status; includes basic progress and error (if any).
- `GET /api/audit/:id/logs` — Live Server‑Sent Events (SSE) “log” and “done”.
- `GET /api/audit/:id/results` — Final results JSON.
- `GET /api/audit/:id/csv` — Expanded CSV (cookies JSON, vendors, dataLayer JSON, etc.).
- `GET /api/audit/:id/json` — Full results as a downloadable JSON file.

Jobs are stored in memory (Map). Each job has: `status`, `progress`, `results`, `logs`, and a set of SSE clients.

### Agent/API endpoints

For Postman and AI-agent use, see `docs/AGENT_API_AND_MCP.md`.

- `GET /api/agent/schema` — Supported action types, browser engines, waitUntil values, rule fields/operators, and example payloads.
- `POST /api/agent/audits` — Create a complete audit config, upsert action templates/rule sets, attach them, and optionally start a run.
- `POST /api/agent/audits/:id/run` — Run an existing audit config through the same runner path as the UI.
- `POST /api/agent/interactions` — Create a complete interaction config/journey, upsert flow templates/rule sets, attach them, and optionally start a run.
- `POST /api/agent/interactions/:id/run` — Run an existing interaction config through the same runner path as the UI.

Postman files:

- `docs/postman/Free Audit Agent API.postman_collection.json`
- `docs/postman/Free Audit Local.postman_environment.json`

MCP server:

- `node mcp/free-audit-mcp.js`

Chrome extension recorder:

- `extension/free-audit-recorder/`
- `docs/CHROME_EXTENSION_RECORDER.md`

---

## 5) Runner flow (auditRunner.js)

```
UI -> API: start
API -> Runner: auditDomain
Runner -> Puppeteer: launch + goto(url)
Puppeteer -> Runner: network requests
Runner: classify vendor per request
Runner: capture dataLayer + cookies
Runner -> Flow: optional steps (click/type/etc.)
Runner -> API: results
API -> UI: results + exports
```

Highlights:
- Puppeteer uses the installed browser's native user agent and network protocol unless an audit explicitly sets a user agent.
- `Target Pages` drives discovery even when no explicit URL sources are entered: the crawler starts at the given URL, follows same-origin links, and, when enabled, reads robots.txt for sitemap references and tries `/sitemap.xml` in the audit browser. The target is still an upper limit, not a promise that many accessible pages exist. Robots.txt does not itself enumerate site pages.
- A site can deny automated navigation even when it opens in a normal browser. HTTP 4xx/5xx document responses are counted as page errors; a page labelled "Access Denied" is not a successful audit of its original content. Use the site's authorized access path rather than treating denied pages as valid results.
- Vendor classification strictly maps GA hits to `https://analytics.google.com/g/collect...`, and `gtm.js`/`gtag/js` to GTM.
- Data captured per page: `analytics[]`, `dataLayer.after[]`, `cookies[]`, `vendors[]` (unique), basic metadata.
- Results summary also lists site-level unique vendors.

---

## 6) Flow steps (flow.js)

Supported actions:
- `waitForSelector`, `click`, `type`, `hover`, `waitForTimeout`, `navigate`, `scroll`.

Example flow:
```json
[
  {"action":"click","selector":"#accept-cookies"},
  {"action":"type","selector":"#search","value":"foundation"},
  {"action":"waitForTimeout","timeout":700},
  {"action":"click","selector":"#submit"}
]
```

---

## 7) Vendor classification (utils.js)

- Google Analytics (requests only): `https://analytics.google.com/g/collect?v=...`
- Google Tag Manager: `googletagmanager.com/gtm.js` or `googletagmanager.com/gtag/js`
- Libraries are not mixed with hits: `analytics.js` → `Google Analytics (script)`.
- Additional pixels (Facebook/TikTok/LinkedIn/Bing/Pinterest/Snap/Twitter/Reddit/Quora/Criteo/Taboola/Outbrain/etc.) are matched by hostname/path.

To add new vendors, extend `classifyAnalytics(url)`.

---

## 8) Frontend behavior (public/)

- Start audit → UI posts `/audit/start` and polls `/status` until done.
- Live logs arrive over SSE; they are stored and can be opened later via a modal.
- Per-page tiles:
  - Tools (unique vendors), dataLayer count, Cookies count.
- Modals:
  - Tools → vendor list → vendor requests (with params) → request details.
  - dataLayer → console-like collapsible tree of the “after” snapshot.
  - Cookies → first/third-party tables with value truncation + tooltip.
- Modals support back navigation (with a small stack) and close.

---

## 9) CSV & JSON exports

- CSV includes per-page cookies (first- and third-party JSON), analytics hits, unique vendors, dataLayer JSON, links found.
- JSON export contains the full `results` object.

---

## 10) Configuration & environment

- Important env var (especially on locked-down machines):
  - `PUPPETEER_EXECUTABLE_PATH` — set to your Chrome path, e.g. `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`.
- Start commands:
  - `npm run dev` — auto-reload with nodemon.
  - `npm start` — regular start.
- Port: `PORT` env var (defaults to 3000).

---

## 11) Authentication

- Access to the auditor now requires a login session.
- Default credentials: `admin / audit123` (or set `ADMIN_PASSWORD` / `SESSION_SECRET` env vars).
- Each audit is tied to the authenticated user; history lists only your own runs.
- `POST /auth/login` logs in, `POST /auth/logout` clears the session.

## 12) Troubleshooting

- Browser fails to launch → set `PUPPETEER_EXECUTABLE_PATH` to installed Chrome.
- Logs 404 or UI not updating → restart server after code changes.
- Vendor counts mismatch → use the Tools tile path; classification is deterministic on page analytics list.

---

## 13) Extending the app

- Add a vendor: `src/audit/utils.js` → `classifyAnalytics` add new hostname/path rules.
- Add a flow action: `src/audit/flow.js` → add a new case; then expose it in the UI combobox (`public/app.js`).
- Persist jobs to disk/DB: replace the in-memory Map in `server.js` with a store and serialize `results`/`logs`.
- Tighten security: add simple auth on endpoints; validate `domain` input.

---

## 14) Visual cheat-sheet

```
UI -> API: start
API -> Runner: auditDomain
Runner -> Chromium: launch + pages
Runner: classify vendors + dataLayer + cookies
Runner -> API: results
API -> UI: report + CSV/JSON
```

You’re ready to tinker. Have fun exploring and extending the auditor!

