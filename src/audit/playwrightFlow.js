const { sleep, normalizePlaywrightWaitUntil } = require('./runnerShared');

async function resolveFrameFromSelector(page, selector, timeoutMs) {
  const frameHandle = await page.waitForSelector(selector, { timeout: timeoutMs });
  if (!frameHandle) return null;
  try {
    const frame = await frameHandle.contentFrame();
    return frame || null;
  } finally {
    try { await frameHandle.dispose(); } catch (_) {}
  }
}

function findFrameByHint(page, hint) {
  const needle = String(hint || '').trim().toLowerCase();
  if (!needle) return null;
  const frames = page.frames();

  const exact = frames.find((frame) => {
    const name = String(frame.name() || '').toLowerCase();
    const url = String(frame.url() || '').toLowerCase();
    return name === needle || url === needle;
  });
  if (exact) return exact;

  return frames.find((frame) => {
    const name = String(frame.name() || '').toLowerCase();
    const url = String(frame.url() || '').toLowerCase();
    return name.includes(needle) || url.includes(needle);
  }) || null;
}

function deriveSelectorFromScript(script) {
  const code = String(script || '');
  const match = code.match(/querySelector(?:All)?\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
  if (!match) return null;
  const selector = String(match[2] || '').trim();
  return selector || null;
}

function sanitizeSelectorLiteral(selector) {
  return String(selector || '')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\`/g, '`')
    .trim();
}

function looksLikeJavaScriptSnippet(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return /(document\.|window\.|querySelector|querySelectorAll|=>|function\s*\(|\.click\s*\(|\.submit\s*\(|return\s+|console\.|eval\s*\(|await\s+)/i.test(text);
}

function inferDomAction(script) {
  const code = String(script || '');
  const actionMatch = code.match(/\.(click|submit|focus)\s*\(/i);
  if (!actionMatch) return null;
  const selector = deriveSelectorFromScript(code);
  if (!selector) return null;
  return {
    selector: sanitizeSelectorLiteral(selector),
    action: String(actionMatch[1] || '').toLowerCase()
  };
}

async function runDomActionFallback(context, script) {
  const domAction = inferDomAction(script);
  if (!domAction || !domAction.selector || !domAction.action) return { handled: false, executed: false };

  try {
    return await context.evaluate(({ selector, action }) => {
      const node = document.querySelector(selector);
      if (!node) {
        return { handled: true, executed: false, selector, action, reason: 'target-not-found' };
      }
      if (typeof node[action] !== 'function') {
        return { handled: true, executed: false, selector, action, reason: 'unsupported-action' };
      }
      node[action]();
      return { handled: true, executed: true, selector, action };
    }, domAction);
  } catch (_) {
    return { handled: false, executed: false };
  }
}

async function findFrameContainingSelector(page, selector, timeoutMs) {
  const deadline = Date.now() + Math.max(500, Number(timeoutMs) || 0);
  while (Date.now() <= deadline) {
    const frames = page.frames();
    const mainFrame = page.mainFrame ? page.mainFrame() : null;
    for (const frame of frames) {
      if (mainFrame && frame === mainFrame) continue;
      try {
        const handle = await frame.$(selector);
        if (handle) {
          try { await handle.dispose(); } catch (_) {}
          return frame;
        }
      } catch (_) {}
    }
    await sleep(200);
  }
  return null;
}

async function runFlow(page, steps = [], onLog = () => {}, options = {}) {
  const failFast = options.failFast !== false;
  const stepErrors = [];
  let activeContext = page.mainFrame ? page.mainFrame() : page;

  for (const [index, step] of (steps || []).entries()) {
    const { action, selector, value, timeout, x, y, waitUntil } = step || {};
    const actionName = String(action || '').toLowerCase();
    const timeoutMs = Number(timeout) || 10000;
    try {
      onLog({ level: 'info', ts: Date.now(), msg: `Flow step ${index + 1} start`, action, selector, value });
      switch (actionName) {
        case 'waitforselector':
          if (!selector) throw new Error('waitForSelector requires selector');
          await activeContext.waitForSelector(selector, { timeout: timeoutMs });
          break;
        case 'click':
          if (!selector) throw new Error('click requires selector');
          await activeContext.click(selector, { delay: 20, timeout: timeoutMs });
          break;
        case 'type':
          if (!selector) throw new Error('type requires selector');
          await activeContext.click(selector, { delay: 10, timeout: timeoutMs });
          await activeContext.type(selector, String(value ?? ''), { delay: 10, timeout: timeoutMs });
          break;
        case 'hover':
          if (!selector) throw new Error('hover requires selector');
          await activeContext.hover(selector, { timeout: timeoutMs });
          break;
        case 'waitfortimeout':
          await sleep(timeout ?? 1000);
          break;
        case 'navigate':
          if (!value) throw new Error('navigate requires value (URL)');
          {
            const normalizedWaitUntil = normalizePlaywrightWaitUntil(waitUntil);
            const navTimeout = timeout ?? 60000;
            if (normalizedWaitUntil === 'networkidle') {
              await page.goto(value, { waitUntil: 'domcontentloaded', timeout: navTimeout });
              try {
                await page.waitForLoadState('networkidle', { timeout: Math.min(navTimeout, 15000) });
              } catch (idleErr) {
                onLog({
                  level: 'warn',
                  ts: Date.now(),
                  msg: `Flow step ${index + 1} network idle wait timed out; continuing after DOMContentLoaded`,
                  url: value,
                  error: String(idleErr && idleErr.message ? idleErr.message : idleErr)
                });
              }
            } else {
              await page.goto(value, { waitUntil: normalizedWaitUntil, timeout: navTimeout });
            }
          }
          activeContext = page.mainFrame ? page.mainFrame() : page;
          break;
        case 'pagerefresh':
        case 'refresh':
        case 'reload':
          {
            const normalizedWaitUntil = normalizePlaywrightWaitUntil(waitUntil);
            const navTimeout = timeout ?? 60000;
            if (normalizedWaitUntil === 'networkidle') {
              await page.reload({ waitUntil: 'domcontentloaded', timeout: navTimeout });
              try {
                await page.waitForLoadState('networkidle', { timeout: Math.min(navTimeout, 15000) });
              } catch (idleErr) {
                onLog({
                  level: 'warn',
                  ts: Date.now(),
                  msg: `Flow step ${index + 1} network idle wait timed out after page refresh; continuing after DOMContentLoaded`,
                  error: String(idleErr && idleErr.message ? idleErr.message : idleErr)
                });
              }
            } else {
              await page.reload({ waitUntil: normalizedWaitUntil, timeout: navTimeout });
            }
          }
          activeContext = page.mainFrame ? page.mainFrame() : page;
          break;
        case 'switchtoiframe': {
          let frame = null;
          if (selector) {
            frame = await resolveFrameFromSelector(page, selector, timeout ?? 30000);
          }
          if (!frame && selector) {
            frame = await findFrameContainingSelector(page, selector, timeout ?? 30000);
          }
          if (!frame && selector) {
            frame = findFrameByHint(page, selector);
          }
          if (!frame && value) {
            frame = findFrameByHint(page, value);
          }
          if (!frame) {
            const frameHints = page.frames().slice(0, 8).map((f) => ({
              name: f.name() || '',
              url: f.url() || ''
            }));
            throw new Error(`switchToIFrame could not find target frame. Hints: ${JSON.stringify(frameHints)}`);
          }
          activeContext = frame;
          onLog({
            level: 'info',
            ts: Date.now(),
            msg: `Flow step ${index + 1} frame context switched`,
            frameName: frame.name() || '',
            frameUrl: frame.url() || ''
          });
          break;
        }
        case 'switchtomainframe':
          activeContext = page.mainFrame ? page.mainFrame() : page;
          onLog({ level: 'info', ts: Date.now(), msg: `Flow step ${index + 1} switched to main frame` });
          break;
        case 'executejavascript':
        case 'executejs':
        case 'javascript':
        case 'evaluate':
          {
            const scriptValue = (value !== undefined && value !== null && String(value).trim() !== '')
              ? String(value)
              : (looksLikeJavaScriptSnippet(selector) ? String(selector) : '');
            const selectorValue = scriptValue && looksLikeJavaScriptSnippet(selector) ? '' : selector;
            if (!scriptValue) {
              throw new Error('executeJavaScript requires value (JavaScript code)');
            }
            const explicitSelector = selectorValue && String(selectorValue).trim()
              ? sanitizeSelectorLiteral(selectorValue)
              : null;
            const inferredSelector = explicitSelector
              ? null
              : sanitizeSelectorLiteral(deriveSelectorFromScript(scriptValue));
            const waitSelector = explicitSelector || inferredSelector;
            if (waitSelector) {
              try {
                await activeContext.waitForSelector(waitSelector, { timeout: explicitSelector ? timeoutMs : Math.min(timeoutMs, 4000) });
              } catch (waitErr) {
                if (explicitSelector) {
                  throw waitErr;
                }
                onLog({
                  level: 'warn',
                  ts: Date.now(),
                  msg: `Flow step ${index + 1} inferred selector not found; executing JavaScript anyway`,
                  selector: waitSelector
                });
              }
            }
            try {
              await activeContext.evaluate((code) => {
                return (0, eval)(code);
              }, scriptValue);
            } catch (evalErr) {
              const fallback = await runDomActionFallback(activeContext, scriptValue);
              if (fallback.handled) {
                onLog({
                  level: fallback.executed ? 'info' : 'warn',
                  ts: Date.now(),
                  msg: fallback.executed
                    ? `Flow step ${index + 1} DOM action fallback executed`
                    : `Flow step ${index + 1} DOM action fallback skipped`,
                  selector: fallback.selector || null,
                  action: fallback.action || null,
                  reason: fallback.reason || null
                });
                break;
              }
              throw evalErr;
            }
          }
          break;
        case 'scroll':
          if (selector) {
            await activeContext.waitForSelector(selector, { timeout: timeoutMs });
            await activeContext.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, selector);
          } else if (typeof x === 'number' || typeof y === 'number') {
            await activeContext.evaluate(({ x: sx, y: sy }) => window.scrollTo(sx || 0, sy || 0), { x, y });
          } else {
            await activeContext.evaluate(() => {
              const h = document.body.scrollHeight;
              window.scrollTo(0, h);
            });
          }
          break;
        default:
          break;
      }
      onLog({ level: 'info', ts: Date.now(), msg: `Flow step ${index + 1} success`, action });
    } catch (err) {
      const wrapped = new Error(`Flow step ${index + 1} (${action}) failed: ${err.message}`);
      onLog({ level: 'error', ts: Date.now(), msg: wrapped.message, action, selector });
      stepErrors.push({ step: index + 1, action, error: wrapped.message });
      if (failFast) throw wrapped;
    }
  }

  return { stepErrors };
}

module.exports = { runFlow };
