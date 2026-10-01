# Pupetter Analysis

Pupetter Analysis is a self-hosted web auditing workspace for inspecting how a website behaves in a real browser. It crawls a target site, records analytics and marketing requests, captures cookies and `dataLayer` state, supports repeatable interaction flows, and presents exportable results.

The project includes a browser-based dashboard, an Express API, Puppeteer and Playwright runners, a Chrome extension recorder, an MCP server, and regression tests.

> The published repository intentionally excludes local audit databases, session data, generated reports, screenshots, logs, and local configuration. Those files can contain collected site data, user records, or pairing tokens and are also unsuitable for normal GitHub file-size limits.

## What it can do

- Crawl a domain and inspect network activity, cookies, vendor tags, and `dataLayer` events.
- Run declarative journeys such as clicks, input, scrolling, waits, and navigation.
- Manage audit and interaction configurations, action templates, flow templates, rule sets, and history.
- Export audit results as JSON or CSV.
- Provide authenticated UI access, an agent-oriented API, an MCP interface, and a Chrome extension recorder.
- Compare Puppeteer and Playwright execution paths.

The dashboard and extension still use the **Free Audit** / **Free Audit Recorder** labels. This repository includes the full runnable source and **[Pupetter-Analysis.zip](Pupetter-Analysis.zip)** for sharing. A fresh installation creates a new local database; our existing audit history and saved configurations are not included.

## 1. Requirements

- **Node.js 24.x**, or **Node.js 22.x at least 22.12**, with npm. These versions satisfy the included Puppeteer and SQLite package requirements.
- Internet access for dependency/browser downloads and websites being audited.
- Google Chrome for the unpacked extension; a graphical desktop for visible browser runs.
- Space for dependencies and managed Chrome/Chromium downloads. Dependencies and browsers are not bundled in the ZIP.

Check your installation:

```bash
node --version
npm --version
```

If either command is unavailable, install a supported Node.js version first. If Node was already installed through nvm, load that machine's nvm shell configuration before continuing.

## 2. Get the application

Choose **one** method.

### Clone the complete repository

```bash
git clone https://github.com/analyticsExperiment/PupeeterApp.git
cd PupeeterApp
```

### Download and extract the ZIP

Download **[Pupetter-Analysis.zip](https://github.com/analyticsExperiment/PupeeterApp/raw/refs/heads/main/Pupetter-Analysis.zip)**. Extract it into a new folder, then open a terminal in the folder containing `package.json` and `server.js`.

Linux/macOS example, from the folder containing the downloaded ZIP:

```bash
unzip Pupetter-Analysis.zip -d PupeeterApp
cd PupeeterApp
```

Windows: right-click the ZIP, choose **Extract All**, and open PowerShell in the extracted folder. The ZIP contains the source files directly, not a preinstalled application.

Do not extract an update over a working installation without backing up its local data first.

## 3. Install dependencies and browsers

From the application folder:

```bash
npm ci
npx puppeteer browsers install chrome
npx playwright install chromium
```

`npm ci` uses the committed lockfile. Puppeteer's install script may already download its browser; the explicit command ensures it is available. Playwright needs its matching Chromium unless a browser executable override is configured.

If npm reports blocked dependency install scripts, review its approval instructions for this project. The native SQLite dependency (`better-sqlite3`) needs its installation/build step. After approving it, run:

```bash
npm rebuild better-sqlite3
```

Repeat the browser-install commands above. If SQLite needs compilation because a prebuilt binary is unavailable, install your operating system's C/C++ build tools and Python, then retry. Do not disable script protections globally just to install this app.

On Linux, an error naming missing browser shared libraries means system dependencies are needed. Have an administrator review the changes before using `npx playwright install --with-deps chromium`.

### Optional: use an installed browser

Managed browsers are the simplest setup. To use existing Chrome/Chromium instead, set its actual executable path before starting. Linux example, only if this path exists:

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
```

Playwright first uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, then falls back to `PUPPETEER_EXECUTABLE_PATH`. Custom browsers may not match the engine's tested version. These variables affect application-launched browsers, **not** the extension's existing Chrome tab.

## 4. Start, sign in, and stop

For a quick, trusted local test:

```bash
npm start
```

Open **http://localhost:3000** in Chrome. Fresh-install fallback credentials:

- Username: `admin`
- Password: `audit123`

These are development defaults, not safe credentials for a shared deployment. Set strong credentials and a unique session secret before sharing access. Linux/macOS example:

```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD='replace-with-your-own-strong-password'
export SESSION_SECRET='replace-with-your-own-long-random-secret'
npm start
```

Windows PowerShell equivalent:

```powershell
$env:ADMIN_USERNAME = 'admin'
$env:ADMIN_PASSWORD = 'replace-with-your-own-strong-password'
$env:SESSION_SECRET = 'replace-with-your-own-long-random-secret'
npm start
```

Replace the example secrets. These variables configure the fallback administrator; if that username exists in the database, its stored password takes precedence. A `.env` file alone does **not** configure the app: `server.js` does not automatically load one.

Keep the terminal open while using the app. Press **Ctrl+C** in that terminal to stop it; run `npm start` to restart. Use `npm run dev` for development with automatic restarts.

The app creates `data/audits.db` automatically for local accounts, configurations, results, and hashed extension tokens. Stop the server before backing up the whole `data/` folder, including SQLite WAL/SHM files if present. Never publish it.

The server does not explicitly restrict its listener to loopback. A `localhost` URL alone does not prevent network access; keep it behind a trusted firewall and do not expose the default setup publicly.

## 5. Create and run an application audit

1. Sign in, open **Audit Configs**, and create a configuration with a descriptive name.
2. Set **Domain / Starting URL** to a site you own or are authorized to test.
3. Set **Target Pages**, for example `15`, and keep **Same Origin Only** enabled for a scoped audit.
4. Choose **Automation Engine**: Puppeteer or Playwright. Begin with a low worker count; visible mode needs a graphical desktop.
5. In **URL Sources**, leave **Starting URLs** empty for automatic discovery. Enable **Include URLs from sitemap.xml and robots.txt** if desired. Alternatively, provide specific starting URLs, one per line.
6. Attach the desired rules/actions and save the config.
7. Open **Create Audit**, select the saved config, and click **Run Audit**.
8. Open its report in **Audit History** to inspect requests, cookies, `dataLayer`, rule results, and exports.

**Target Pages is a target, not a guarantee.** With no explicit URL list, the crawler tries to discover and visit that many distinct pages. `robots.txt` can point to sitemaps but is not a full page inventory. Missing links/sitemaps, scope/depth limits, access denial, or rate limits can stop a run early. Reports include `pageTarget`, `targetMet`, and `crawlStopReason` so a one-page run is not silently presented as reaching 15 pages.

## 6. Install the Chrome extension

Start the app, then use your normally launched Google Chrome:

1. Open **chrome://extensions**.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select **`extension/free-audit-recorder`** inside the cloned/extracted app: the folder containing `manifest.json`. Do not select the repository root or ZIP.
5. Confirm **Free Audit Recorder 0.5.0** appears and is enabled.
6. Pin it from Chrome's extensions menu and click its toolbar icon.

The extension needs site access to capture pages, request metadata, and cookies. Install it only in a trusted profile and audit only authorized sites. It does not require launching Chrome through Puppeteer/Playwright.

## 7. Connect the extension and sync configs

1. Set **Free Audit app URL** in the popup to `http://localhost:3000`, or the actual URL/port you use.
2. Click **Sign in via app**. The extension opens or finds the application tab.
3. Log in with your app account. Pairing uses that authenticated session; your password is not stored in the extension.
4. Reopen the popup and confirm **Connected to Free Audit** and the expected username.
5. Create/edit **Audit Configs** in the app. They appear when the popup opens and refresh about every five seconds while it stays open. The popup prefers a config matching the current tab's site.

Use the same app origin consistently: `localhost` and `127.0.0.1` have separate login sessions. A fresh installation has no saved configs until you create them.

If automatic pairing is unavailable, create a token in the app's **Settings**, copy it when displayed, then paste it into **Advanced: paste a pairing token**. Keep it private. **Disconnect** revokes the current token; Settings can also revoke tokens. App logout alone does not revoke an already-paired extension. Disconnect/reconnect when switching accounts.

## 8. Audit in your existing Chrome tab

1. Open the target site in a normal Chrome tab and complete permitted login/consent steps.
2. Open the popup and select your config under **Attached Chrome audit**.
3. Keep **Automatically visit discovered pages** checked for automatic discovery/navigation, or uncheck it for manual browsing.
4. Click **Start audit**. The tab reloads or navigates to the config's starting URL to capture its first document request.
5. Keep the tab and app running; closing the popup is fine. Automatic mode visits discovered same-origin pages in that tab. In manual mode, navigate the tab yourself.
6. Automatic mode finishes at the target, discovery exhaustion, or access denial/rate limiting. Click **Stop & save** to finish manually.
7. Click **Open last report**, or find the run in the app's **Audit History**.

Attached mode uses the existing Chrome session and captures document/request URLs and statuses, cookies, title, links, and `dataLayer`, then applies the config's rules. It does **not** execute pre/post/on-page audit actions or capture console messages/response bodies. Same-document SPA routes are not separate pages. Automatic discovery does not click menus/submit forms and skips obvious risky/binary URLs.

Per-page capture is bounded to 300 requests, 100 cookies, and 30 `dataLayer` entries, with long values truncated. This mode is not a bypass of site security and cannot guarantee every visit will be permitted. If denied, stop and use approved access rather than repeatedly retrying.

## 9. Record and save a journey

1. Open the target site and extension popup.
2. Under **Journey recorder**, click **Start** and perform the journey normally.
3. Use **Pause** when needed and **Stop** when finished.
4. Review **Preview Steps** and enter a **Save name**.
5. Click **Save Flow Template** or **Save Interaction Config**; you can also copy/export JSON.
6. Open that section in the app, review selectors, attach rules, supply approved test values, and run the journey.

Recognized password/OTP/token/card-like fields become placeholders, but masking is heuristic. Review recordings before sharing. Save/export before closing the tab/browser; unsaved recordings are session-only. Iframes, complex SPA routes, drag/drop, file uploads, and closed shadow roots may need manual editing.

## 10. Updating

- Repository installation: review local changes, then run `git pull --ff-only` and `npm ci`. Install matching browsers again if dependencies changed.
- ZIP installation: back up local data and unpack into a separate folder. Keep private data local; do not blindly overwrite it.
- Extension **code** changes: stop/save active work, click **Reload** on the extension at `chrome://extensions`, then refresh target tabs to load new content scripts.
- App **config** changes: reopen the popup or wait for its refresh; no extension reinstall is needed. A running audit uses the config selected for that run.

## 11. iPhone and iPad (iOS/iPadOS)

The web dashboard can be accessed from Safari or Chrome on an iPhone/iPad when the app is running on a reachable computer. This is **remote dashboard access**, not a native iOS installation: Node.js, SQLite, Puppeteer, and Playwright still run on that computer.

For a trusted local-network setup:

1. Complete the desktop setup above and configure a strong password and session secret before allowing other devices to connect.
2. Keep the app/computer running and connect the iPhone/iPad to the same trusted Wi-Fi network.
3. Find the computer's local network IP address in its network settings. Open `http://<computer-local-IP>:3000` in the phone/tablet browser, replacing the placeholder with that actual IP (for example `http://192.168.1.50:3000`). `localhost` on the phone means the phone itself, not your computer.
4. If blocked, ask the computer/network administrator to permit access only from the trusted local network. Guest Wi-Fi device isolation may prevent access. Do not enable internet port forwarding for this default setup.
5. Sign in to use the dashboard and inspect saved reports. Application-triggered audits execute on the host computer; they do not audit the phone's own browsing session.

Local HTTP is unencrypted: do not use this setup over public/untrusted Wi-Fi. Remote access beyond a trusted local environment needs a separately secured HTTPS deployment and appropriate access controls. Mobile layout and this iOS workflow have not been tested on a physical iPhone/iPad in this release.

**The included unpacked Chrome extension cannot be loaded into Chrome on iOS/iPadOS.** Extension attached-tab audits and journey recording require desktop Chrome on Windows, macOS, or Linux. Safari on iOS has its own extension system, but this repository does not include a Safari/iOS port. See [Google's Chrome extension installation guide](https://support.google.com/chrome_webstore/answer/2664769?hl=en) and [Apple's iPhone Safari extension guide](https://support.apple.com/guide/iphone/iphab0432bf6/ios).

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Node/npm missing or unsupported engine | Use Node 24.x or Node 22.x >=22.12, reopen the terminal, and rerun `npm ci`. |
| SQLite binding error | Review blocked scripts, run `npm rebuild better-sqlite3`, and install dependencies on this machine rather than copying from another OS. |
| Browser executable missing | Install the matching managed browser, or correct/remove an invalid executable-path override. |
| Linux missing shared libraries | Install reviewed browser dependencies; visible runs also require a desktop display. |
| `EADDRINUSE` / port 3000 occupied | Stop your previous app with Ctrl+C, or set `PORT=3001` before starting; update the extension URL if the port changes. |
| Extension cannot connect | Keep the app running, check the exact URL/port, sign in via app, and reopen the popup. |
| Config missing | Check the connected account and app URL, create a config there, and reopen the popup. Reconnect after switching accounts. |
| Only one page captured | Check automatic visits are enabled and read the report's stop reason. A target of 15 cannot create links or override denial. |
| Old extension behavior | Reload the correct unpacked extension and refresh target tabs; avoid loading duplicate old/new copies. |
| Site shows Access Denied | Inspect recorded status/requests. Normal Chrome can also be denied later; changing engines does not guarantee access. |

## Project map

| Location | Purpose |
| --- | --- |
| `server.js` | Express application, authentication, API routes, live logs, and static-file serving. |
| `public/` | The browser dashboard and client-side UI. |
| `src/audit/` | Puppeteer/Playwright runners, flow execution, rule handling, and tag classification. |
| `src/api/` | Agent-facing request schema and orchestration. |
| `src/interaction/` | Interaction journey execution and reporting. |
| `src/auth/` | Password and session-related helpers. |
| `src/db.js` | SQLite persistence layer; creates local data under `data/`. |
| `extension/free-audit-recorder/` | Chrome extension for journey recording and attached-tab audits. |
| `mcp/` | MCP server for programmatic use. |
| `tests/` | API, MCP, visual, and reliability regression checks. |
| `docs/` | API, extension, architecture, and usage documentation. |

## Verification commands

The following focused test commands are available:

```bash
npm run qa:extension
npm run qa:api
npm run qa:mcp
npm run qa:reliability
npm run qa:attached-audit
npm run qa:console
npm run qa:json
npm run qa:reports
```

Some browser-based checks need an installed managed browser or working executable override and generate output under `output/`, which remains local. `npm test` is a placeholder; use the named QA commands.

## Documentation

- [Project guide](docs/README.md) — crawl flow, endpoints, data capture, configuration, and troubleshooting.
- [Agent API and MCP](docs/AGENT_API_AND_MCP.md) — programmatic API contracts and MCP usage.
- [Chrome extension recorder](docs/CHROME_EXTENSION_RECORDER.md) — session-based connection, attached audits, and journey recording.
- [Console tracker architecture](docs/console-tracker-architecture.md) — console capture design.

## Security and data handling

Audit results can include cookies, URLs, network requests, browser metadata, and application configuration. Keep `data/`, `output/`, `.env*`, and any exports out of version control unless they have been reviewed and explicitly approved for sharing. Configure a strong `ADMIN_PASSWORD` and `SESSION_SECRET` before exposing the service beyond a trusted local environment.

## License

`package.json` currently declares ISC, but there is no standalone `LICENSE` file. Review and clarify licensing before external redistribution or accepting contributions.
