# Free Audit Recorder

The Free Audit Recorder is a Manifest V3 Chrome extension that records a real browser journey and saves it into Free Audit as either an interaction flow template or an interaction config. Version 0.5.0 supports attached Chrome audits, automatic page discovery, and session-based sign-in.

The popup's **Sign in via app** opens or finds the local app tab. Log in there; the extension automatically receives its own revocable token from that authenticated session without storing the app password. **Disconnect** revokes that token. The popup fetches configs on open and refreshes them while open, selecting one that matches the current tab's site. Config edits do not require reloading the extension; extension code updates do.

## Attached audit mode

After pairing, create an Audit Config with a starting URL, target page count, and rules. Reload the unpacked extension, open a normal Chrome tab, and choose the config under **Attached Chrome audit**. Leave **Automatically discover and visit pages** checked and click **Start audit** to crawl in that tab. Uncheck it to browse the configured origin manually, then click **Stop & save**. The run appears in Audit History and its report applies the config's rules to the captured pages.

This mode observes top-level navigation/status and request URLs/statuses through the extension, plus cookies and page/dataLayer snapshots. It does not launch a separate automated browser. Automatic mode discovers same-origin links and, if enabled by the config, sitemaps from `robots.txt` and `/sitemap.xml`; it tries to reach the target count. It stops with an explicit reason if there are no more discoverable pages or the site responds with an Access Denied/HTTP 403/429 page. It cannot guarantee 15 accessible pages merely because the target is 15. It does not run audit actions, capture response bodies or console logs, or guarantee access to sites with bot protection. Same-document SPA route changes are not separate pages. Request URLs and cookie values can be sensitive; handle reports and exports accordingly. See `extension/free-audit-recorder/README.md` for the full workflow.

## What It Records

- Page open/navigation as `openUrl`
- Clicks as `click`
- Text and textarea entry as `type`
- Select dropdown changes as `selectDropdownOption`
- Checkbox/radio changes as `checkCheckbox` or `uncheckCheckbox`
- Scroll activity as `scroll`
- Enter/Escape key presses as `pressKey`

Recognized sensitive fields are masked before saving. Password, OTP, token, secret, card, CVV, PIN, SSN, and similar fields use placeholders such as `{{PASSWORD}}`, `{{OTP}}`, or `{{SECRET_VALUE}}`. Detection is heuristic: review custom fields before exporting or sharing a recording.

## Install and connect

1. Start Free Audit.
2. In Chrome, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `extension/free-audit-recorder/`.
3. In the extension popup, set the app URL (for example `http://127.0.0.1:3000`) and click **Sign in via app**.
4. Log in in the app tab that opens. The extension pairs automatically using that session; no password is saved in the extension.

If this login-assisted flow is unavailable, use the **Advanced** pairing-token field: create a token in Free Audit Settings, copy it immediately, and paste it into the extension.

The token is stored as a SHA-256 hash in `data/audits.db`; the raw token is not recoverable after creation. Disconnect in the popup or revoke old tokens from Settings. Logging out of the app alone does not revoke an already-connected extension token; use **Disconnect** when switching accounts.

## Recording Flow

1. Open the target site in the browser tab.
2. Open the extension popup.
3. Click Start.
4. Perform the journey.
5. Click Stop.
6. Review the captured JSON in the popup.
7. Save as Flow Template, or save as Interaction Config.
8. Open Free Audit Interaction Configs to edit, attach rule sets, and run.

## Extension API

Session-authenticated token management:

- `GET /api/extension/tokens`
- `POST /api/extension/tokens`
- `DELETE /api/extension/tokens/:id`

Bearer-token extension calls:

- `GET /api/extension/status`
- `DELETE /api/extension/current-token`
- `GET /api/extension/audit-configs`
- `POST /api/extension/attached-audits`
- `GET /api/extension/attached-audits/:id`
- `POST /api/extension/attached-audits/:id/pages`
- `POST /api/extension/attached-audits/:id/finish`
- `POST /api/extension/interaction-flow-template`
- `POST /api/extension/interaction-config`

## QA

Automated smoke:

```powershell
npm run qa:extension
npm run qa:reliability
npm run qa:attached-audit
```

The smoke starts Free Audit and a local test page, creates a pairing token, injects the recorder scripts, records safe actions, verifies masking, saves the journey through the extension API, runs the generated interaction config, and checks the report.

The reliability suite also installs the real unpacked extension in Chromium, exercises its service worker and content scripts, records across navigation, verifies tab isolation and pause state after reload, reopens the popup, and saves through the popup handler. Its popup is rendered in an extension page because browser-toolbar chrome is outside Playwright's DOM; the operating-system toolbar click remains a manual check.

Version 0.5.0 stores recording and attached-audit state per tab in `chrome.storage.session` through the service worker. The revocable extension token remains in trusted extension-local storage. Pending text is flushed before subsequent actions and stop; submit/checkbox events no longer generate duplicate actions. Saved configs start at the first recorded URL, not the final page.

Manual checklist:

- Load the unpacked extension in Chrome.
- Pair with a Settings token.
- Record a small local or owned test site journey.
- Confirm password-like fields are masked.
- Save as a flow template and as an interaction config.
- Run the generated config and open the interaction report.
- Revoke the pairing token and confirm the extension can no longer save.

## Limitations

- Shadow DOM and heavily dynamic canvas-only controls may need manual selector cleanup.
- Automatic iframe recording is not supported. Add frame-switch steps manually in the interaction editor. The interaction runner itself still supports iframes.
- Save/export before closing the recording tab or browser. Unsaved session recordings are not permanent history.
- SPA `pushState` navigation and exact scroll positions require review; scroll replay follows the existing runner's supported semantics.
- Masked placeholders are not an automatic secret-injection system. Use approved test values before replay.
- File uploads are not recorded as runnable file paths.
- Complex drag/drop gestures are not supported in the MVP.
- Public sites should be tested with permission and low volume.
