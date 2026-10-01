# Free Audit Recorder

Free Audit Recorder is a Manifest V3 Chrome extension companion for Free Audit. It records real browser actions and generates interaction steps compatible with Free Audit Interaction Flow Templates and Interaction Configs. It can also audit pages in your normal Chrome tab, either automatically or as you browse.

## Attached Chrome audit

1. Start Free Audit and connect the extension through your app login as below. Create/select an Audit Config in the app with the target starting URL, page limit, and rules.
2. Reload the unpacked extension at `chrome://extensions` after updating it. Open a normal Chrome web tab, then open the extension popup.
3. In **Attached Chrome audit**, select the config. Leave **Automatically discover and visit pages** checked to crawl, or uncheck it for a manual browsing audit. Click **Start audit**. The tab reloads or navigates to the configured starting URL so its first document request is captured.
4. With automatic mode, the extension collects same-origin links and, when enabled in the config, reads `robots.txt` for sitemap locations and tries `/sitemap.xml`. It visits discovered pages in the same tab, up to the configured target. In manual mode, browse that tab yourself and click **Stop & save**. The extension captures document status, request URLs/statuses, cookies, page title, link count, and dataLayer snapshot in either mode. It does not use Puppeteer, Playwright, or the Chrome debugger.
5. Open the report link or find the run in Audit History. The report shows pages audited versus the target and why the crawl stopped. The config's rules are evaluated against saved pages.

With no explicit URL sources, the target is the number of distinct pages to *try* to audit, not a promise that the site has that many accessible pages. The crawl stops early if it exhausts discoverable URLs or receives an Access Denied/HTTP 403/429 page; the report names that reason. The extension stays on the configured origin, skips obvious logout/cart/checkout and binary URLs, and caps discovery. Automatic mode does not click through menus/forms or execute pre/post/on-page audit actions. It does not record console messages or response bodies. Full-page navigations are captured; same-document SPA route changes are not counted as separate pages. To keep each upload bounded, it records at most 300 requests, 100 cookies, and 30 dataLayer entries per page; longer values are truncated. Captured request URLs and cookie values can contain sensitive data: treat reports/exports as confidential and use only accounts/sites you are authorized to audit.

If the site returns an Access Denied page, the report records that HTTP status and associated requests; this mode does not guarantee that a protected site will allow every visit. The extension observes a normally launched Chrome tab, which avoids changing how Chrome was launched for the audit.

## What It Records

- Initial page open as `openUrl`
- Clicks as `click`
- Text inputs as debounced `type` steps, flushed before later actions, navigation, pause, and stop
- Password, OTP, token, card, CVV, PIN, and secret-like values as placeholders such as `{{PASSWORD}}`
- Select dropdowns as `selectDropdownOption`
- Checkboxes and radios as `checkCheckbox` / `uncheckCheckbox`
- Enter/Escape keys as `pressKey`
- Scrolls as throttled `scroll` steps
- Top-level page navigation, with per-tab recording state retained across page loads

## Sign in and config sync

1. Start Free Audit locally.
2. Load or reload this extension in Chrome from `extension/free-audit-recorder`.
3. In the popup, set the Free Audit app URL and click **Sign in via app**.
4. The extension opens or finds the app tab. Log in there with your existing account. The extension connects automatically after the app page loads; reopen the popup to see **Connected to Free Audit** and your username.
5. Choose an audit config. The popup automatically prefers a config matching the current tab's site. Configs created or edited in the app appear on the next popup open and refresh about every five seconds while the popup stays open. No extension reload is needed for config changes.

The app password is never stored in the extension. The app creates a revocable extension token using the already-authenticated session; the token is stored only in trusted extension-local storage. **Disconnect** revokes it. If you change app accounts, disconnect and sign in again so the extension uses the correct account. The older manual pairing-token field remains under **Advanced** as a fallback. Changing extension *code* still requires reloading an unpacked extension at `chrome://extensions`.

The extension sends saves with:

```http
Authorization: Bearer <pairing token>
```

Tokens can also be revoked from Settings.

## Load Locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click "Load unpacked".
4. Select `extension/free-audit-recorder`.

## Basic Workflow

1. Navigate to the site you want to record.
2. Open the extension popup.
3. Click Start.
4. Browse normally.
5. Click Stop.
6. Preview the steps.
7. Copy JSON, save as an Interaction Flow Template, or save as an Interaction Config.

## Limitations

- Automatic iframe recording is not supported. Add explicit frame-switch steps in the interaction editor; the interaction runner supports them.
- Recording and pause state live in per-tab extension session storage. Closing the tab/browser clears that recording; export or save first. Attached audit pages are sent to the app as you navigate and finalized when the target, exhaustion, denial, or manual stop occurs; a browser/app crash can leave a run marked running until it is resumed and stopped.
- Password and other recognized sensitive fields are masked heuristically. This is not a guarantee for arbitrary custom fields. Review every journey before sharing it; replace placeholders through your approved test-data workflow before replay.
- Same-document `pushState` changes without a page load are not automatically navigation steps. Review SPA journeys and add assertions/navigation where necessary.
- Scroll replay uses the existing runner's scroll semantics, not exact pixel restoration. Drag/drop, file uploads, canvas controls, and closed shadow roots require manual journey editing.
- Generated selectors include a confidence score, but complex apps may still need manual selector cleanup.

## Verification

`npm run qa:extension` checks recorded-step API save/replay and token revocation.
`npm run qa:reliability` additionally loads the actual unpacked extension in Chromium, checks navigation, tab isolation, popup reopen/save, masking, and pause/resume after reload.
`npm run qa:attached-audit` verifies session-based connection, config sync, manual and automatic attached capture, target and shortfall outcomes, rule evaluation, token revocation, and existing recorder operation using a disposable database. Reload the unpacked extension after updating these files to activate version 0.5.0 and its service worker.
