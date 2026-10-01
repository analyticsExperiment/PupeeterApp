# Repository Guide

## Scope of the published source

This repository contains the application source, tests, configuration templates, documentation, extension source, and MCP implementation needed to build and run Pupetter Analysis.

The following local-only material is excluded through `.gitignore`:

- SQLite databases and their write-ahead-log files under `data/`.
- Generated audit results, screenshots, and test reports under `output/`.
- Dependency installations, local agent/tool state, logs, and `.env` configuration.

This separation keeps collected audit data and credentials out of the source history. It also avoids GitHub's 100 MB individual-file limit: the current local audit database exceeds that limit.

## Fresh setup

1. Install Node.js 22.12 or later.
2. Run `npm ci` from the repository root.
3. Set `ADMIN_PASSWORD` and `SESSION_SECRET` to strong values for any non-local use.
4. For Playwright without a browser override, run `npx playwright install chromium`. Optionally set `PUPPETEER_EXECUTABLE_PATH` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when a runner should use a particular browser executable.
5. Run `npm start` and open `http://localhost:3000`.

The persistence layer will create the local SQLite data directory as needed. Never copy a production audit database into a public checkout.

## Contributor checks

Run the focused test command that matches the area being changed. For API and integration work, begin with `npm run qa:api` and `npm run qa:mcp`. For reporting/UI changes, use the relevant `qa:json`, `qa:reports`, or browser QA command. Review generated files before sharing them; they are intentionally not tracked.
