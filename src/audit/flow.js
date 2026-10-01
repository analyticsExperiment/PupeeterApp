function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
}

async function resolveFrameFromSelector(context, selector, timeoutMs) {
  const frameHandle = await context.waitForSelector(selector, { timeout: timeoutMs });
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

function withTimeout(promise, timeoutMs, message) {
  const boundedTimeout = Math.max(500, Number(timeoutMs) || 10000);
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message || 'Timed out')), boundedTimeout);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function dispatchDomClick(context, selector) {
  return context.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return { clicked: false, reason: 'target-not-found' };
    try {
      node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    } catch (_) {
      try { node.scrollIntoView(); } catch (_) {}
    }
    const rect = node.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + (rect.width / 2),
      clientY: rect.top + (rect.height / 2)
    };
    for (const eventName of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      node.dispatchEvent(new MouseEvent(eventName, eventInit));
    }
    if (typeof node.click === 'function') {
      node.click();
    } else {
      node.dispatchEvent(new MouseEvent('click', eventInit));
    }
    return { clicked: true };
  }, selector);
}

async function clickSelector(context, page, selector, timeoutMs, onLog, stepNumber) {
  const handle = await context.waitForSelector(selector, { timeout: timeoutMs });
  if (!handle) throw new Error(`click target not found: ${selector}`);

  try {
    await handle.evaluate((node) => {
      try {
        node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      } catch (_) {
        try { node.scrollIntoView(); } catch (_) {}
      }
    });
  } catch (_) {}

  try {
    const box = await handle.boundingBox();
    if (box && box.width > 0 && box.height > 0 && page.mouse) {
      const x = box.x + (box.width / 2);
      const y = box.y + (box.height / 2);
      await withTimeout(page.mouse.click(x, y, { delay: 20 }), Math.min(timeoutMs, 5000), 'mouse click timed out');
      return;
    }
  } catch (err) {
    onLog({
      level: 'warn',
      ts: Date.now(),
      msg: `Flow step ${stepNumber} mouse click failed; trying DOM click fallback`,
      selector,
      error: String(err && err.message ? err.message : err)
    });
  } finally {
    try { await handle.dispose(); } catch (_) {}
  }

  const fallback = await dispatchDomClick(context, selector);
  if (!fallback || !fallback.clicked) {
    throw new Error(`DOM click fallback failed for ${selector}${fallback?.reason ? `: ${fallback.reason}` : ''}`);
  }
  onLog({
    level: 'info',
    ts: Date.now(),
    msg: `Flow step ${stepNumber} DOM click fallback executed`,
    selector
  });
}

async function fillSelector(context, page, selector, value, timeoutMs, onLog, stepNumber) {
  await clickSelector(context, page, selector, timeoutMs, onLog, stepNumber);
  const text = String(value ?? '');
  try {
    if (page.keyboard && typeof page.keyboard.type === 'function') {
      await withTimeout(page.keyboard.type(text, { delay: 10 }), timeoutMs, 'keyboard type timed out');
      return;
    }
    await withTimeout(context.type(selector, text, { delay: 10 }), timeoutMs, 'type timed out');
    return;
  } catch (err) {
    onLog({
      level: 'warn',
      ts: Date.now(),
      msg: `Flow step ${stepNumber} keyboard type failed; setting field value directly`,
      selector,
      error: String(err && err.message ? err.message : err)
    });
  }

  const filled = await context.evaluate(({ sel, textValue }) => {
    const node = document.querySelector(sel);
    if (!node) return { filled: false, reason: 'target-not-found' };
    if ('value' in node) {
      node.focus();
      node.value = textValue;
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true };
    }
    if (node.isContentEditable) {
      node.focus();
      node.textContent = textValue;
      node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: textValue }));
      return { filled: true };
    }
    return { filled: false, reason: 'unsupported-target' };
  }, { sel: selector, textValue: text });
  if (!filled || !filled.filled) {
    throw new Error(`type fallback failed for ${selector}${filled?.reason ? `: ${filled.reason}` : ''}`);
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
    const timeoutMs = timeout ?? 10000;
    try {
      onLog({ level: 'info', ts: Date.now(), msg: `Flow step ${index + 1} start`, action, selector, value });
      switch (actionName) {
        case 'waitforselector':
          if (!selector) throw new Error('waitForSelector requires selector');
          await activeContext.waitForSelector(selector, { timeout: timeoutMs });
          break;
        case 'click':
          if (!selector) throw new Error('click requires selector');
          await clickSelector(activeContext, page, selector, timeoutMs, onLog, index + 1);
          break;
        case 'type':
          if (!selector) throw new Error('type requires selector');
          await fillSelector(activeContext, page, selector, value, timeoutMs, onLog, index + 1);
          break;
        case 'hover':
          if (!selector) throw new Error('hover requires selector');
          await activeContext.waitForSelector(selector, { timeout: timeoutMs });
          await activeContext.hover(selector);
          break;
        case 'waitfortimeout':
          await sleep(timeout ?? 1000);
          break;
        case 'navigate':
          if (!value) throw new Error('navigate requires value (URL)');
          await page.goto(value, { waitUntil: waitUntil || 'domcontentloaded', timeout: timeout ?? 60000 });
          activeContext = page.mainFrame ? page.mainFrame() : page;
          break;
        case 'pagerefresh':
        case 'refresh':
        case 'reload':
          await page.reload({ waitUntil: waitUntil || 'domcontentloaded', timeout: timeout ?? 60000 });
          activeContext = page.mainFrame ? page.mainFrame() : page;
          break;
        case 'switchtoiframe': {
          let frame = null;
          if (selector) {
            frame = await resolveFrameFromSelector(page, selector, timeout ?? 30000);
          }
          if (!frame && selector) {
            // Fallback: selector might target an element inside the frame, not the iframe tag.
            frame = await findFrameContainingSelector(page, selector, timeout ?? 30000);
          }
          if (!frame && selector) {
            // Fallback: treat selector text as a frame hint (name/url/title/id contains).
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
                // Intentionally run user-provided snippet in active page/frame context.
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
          // Unknown action: ignore gracefully
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
