(function () {
  const selectorApi = window.FreeAuditSelector;
  const sensitivePattern = /(password|passwd|pwd|otp|token|secret|card|cc-|credit|cvv|cvc|pin|ssn|private)/i;
  const state = {
    recording: false,
    paused: false,
    steps: [],
    timers: new Map(),
    onChange: null,
    lastSubmitIntent: 0,
    lastEnter: 0,
    lastClick: null,
    lastScrollAt: 0,
    lastUrl: ''
  };

  function now() {
    return Date.now();
  }

  function currentUrl() {
    return window.location.href;
  }

  function targetElement(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.find((item) => item && item.nodeType === Node.ELEMENT_NODE) || event.target;
  }

  function isEditable(element) {
    if (!element || !element.tagName) return false;
    const tag = element.tagName.toLowerCase();
    if (tag === 'textarea' || element.isContentEditable) return true;
    if (tag !== 'input') return false;
    const type = String(element.type || 'text').toLowerCase();
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
  }

  function isSensitive(element) {
    if (!element) return false;
    const haystack = [
      element.type,
      element.name,
      element.id,
      element.autocomplete,
      element.placeholder,
      element.getAttribute && element.getAttribute('aria-label')
    ].map((item) => String(item || '')).join(' ');
    return element.type === 'password' || sensitivePattern.test(haystack);
  }

  function maskedValue(element, value) {
    if (!isSensitive(element)) return { value, sensitive: false };
    const text = String(element.name || element.id || element.autocomplete || '').toLowerCase();
    if (/otp/.test(text)) return { value: '{{OTP}}', sensitive: true };
    if (/user|email|login/.test(text)) return { value: '{{USERNAME}}', sensitive: true };
    if (/card|cvv|cvc|pin/.test(text)) return { value: '{{SECRET_VALUE}}', sensitive: true };
    if (/token|secret/.test(text)) return { value: '{{SECRET_VALUE}}', sensitive: true };
    return { value: '{{PASSWORD}}', sensitive: true };
  }

  function selectorFor(element) {
    return selectorApi && selectorApi.generateSelector
      ? selectorApi.generateSelector(element)
      : { selector: '', confidence: 0, matches: 0, label: element?.tagName || '' };
  }

  function persist() {
    if (state.onChange) state.onChange(snapshot());
  }

  function record(step) {
    if (!state.recording || state.paused) return;
    const enriched = {
      id: `recorded-${state.steps.length + 1}`,
      timestamp: new Date().toISOString(),
      urlBefore: step.urlBefore || currentUrl(),
      urlAfter: step.urlAfter || currentUrl(),
      ...step
    };
    if (window.top !== window) {
      enriched.frameUrl = currentUrl();
      enriched.notes = [enriched.notes, 'Recorded inside an iframe; verify iframe selector before running.'].filter(Boolean).join(' ');
    }
    state.steps.push(enriched);
    persist();
  }

  function recordNavigationIfChanged() {
    const url = currentUrl();
    if (state.lastUrl === url) return;
    state.lastUrl = url;
    record({ action: 'openUrl', value: url, label: `Navigate to ${url}`, confidence: 1 });
  }

  function handleClick(event) {
    flushInputs();
    const target = targetElement(event);
    const element = target?.closest('button, a, input, select, label') || target;
    if (!element || !element.tagName) return;
    if (['checkbox', 'radio'].includes(element.type) || element.tagName === 'SELECT' || element.tagName === 'LABEL') return;
    if (element.type === 'submit') {
      state.lastSubmitIntent = now();
      if (now() - state.lastEnter < 400) return;
    }
    const meta = selectorFor(element);
    if (!meta.selector) return;
    const key = `${meta.selector}|${currentUrl()}`;
    if (state.lastClick && state.lastClick.key === key && now() - state.lastClick.ts < 400) return;
    state.lastClick = { key, ts: now() };
    record({
      action: 'click',
      selector: meta.selector,
      label: `Click ${meta.label}`,
      selectorStrategy: meta.strategy,
      selectorConfidence: meta.confidence,
      selectorMatches: meta.matches
    });
  }

  function recordInput(element) {
    const meta = selectorFor(element);
    if (!meta.selector) return;
    const masked = maskedValue(element, element.isContentEditable ? element.textContent : element.value);
    record({
      action: 'type',
      selector: meta.selector,
      value: masked.value,
      sensitive: masked.sensitive || undefined,
      label: `Type into ${meta.label}`,
      selectorStrategy: meta.strategy,
      selectorConfidence: meta.confidence,
      selectorMatches: meta.matches
    });
  }

  function handleInput(event) {
    const element = targetElement(event);
    if (!isEditable(element)) return;
    const old = state.timers.get(element);
    if (old) clearTimeout(old);
    state.timers.set(element, setTimeout(() => {
      state.timers.delete(element);
      recordInput(element);
    }, 450));
  }

  function flushInputs() {
    for (const [element, timer] of state.timers) {
      clearTimeout(timer);
      recordInput(element);
    }
    state.timers.clear();
  }

  function cancelInputs() {
    for (const timer of state.timers.values()) clearTimeout(timer);
    state.timers.clear();
  }

  function handleChange(event) {
    flushInputs();
    const element = targetElement(event);
    if (!element || !element.tagName) return;
    const tag = element.tagName.toLowerCase();
    const meta = selectorFor(element);
    if (!meta.selector) return;
    if (tag === 'select') {
      record({
        action: 'selectDropdownOption',
        selector: meta.selector,
        value: element.value,
        label: `Select ${element.value || meta.label}`,
        selectorStrategy: meta.strategy,
        selectorConfidence: meta.confidence,
        selectorMatches: meta.matches
      });
      return;
    }
    if (element.type === 'checkbox') {
      record({
        action: element.checked ? 'checkCheckbox' : 'uncheckCheckbox',
        selector: meta.selector,
        label: `${element.checked ? 'Check' : 'Uncheck'} ${meta.label}`,
        selectorStrategy: meta.strategy,
        selectorConfidence: meta.confidence,
        selectorMatches: meta.matches
      });
      return;
    }
    if (element.type === 'radio' && element.checked) {
      record({
        action: 'checkCheckbox',
        selector: meta.selector,
        label: `Select ${meta.label}`,
        selectorStrategy: meta.strategy,
        selectorConfidence: meta.confidence,
        selectorMatches: meta.matches
      });
    }
  }

  function handleSubmit(event) {
    flushInputs();
    if (now() - state.lastSubmitIntent < 500) return;
    const element = event.submitter || targetElement(event);
    const meta = selectorFor(element);
    if (meta.selector) {
      record({
        action: event.submitter ? 'click' : 'pressKey',
        selector: meta.selector,
        value: 'Enter',
        label: `Submit ${meta.label}`,
        selectorStrategy: meta.strategy,
        selectorConfidence: meta.confidence,
        selectorMatches: meta.matches
      });
    }
  }

  function handleKeydown(event) {
    if (!['Enter', 'Escape'].includes(event.key)) return;
    flushInputs();
    if (event.key === 'Enter') state.lastEnter = state.lastSubmitIntent = now();
    const element = targetElement(event);
    const meta = selectorFor(element);
    record({
      action: 'pressKey',
      selector: meta.selector || undefined,
      value: event.key,
      label: `Press ${event.key}`,
      selectorStrategy: meta.strategy,
      selectorConfidence: meta.confidence,
      selectorMatches: meta.matches
    });
  }

  function handleScroll() {
    if (now() - state.lastScrollAt < 800) return;
    state.lastScrollAt = now();
    record({ action: 'scroll', value: String(Math.round(window.scrollY || document.documentElement.scrollTop || 0)), label: 'Scroll page' });
  }

  function bind() {
    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('submit', handleSubmit, true);
    document.addEventListener('keydown', handleKeydown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('popstate', recordNavigationIfChanged, true);
    window.addEventListener('hashchange', recordNavigationIfChanged, true);
    window.addEventListener('pagehide', flushInputs, true);
  }

  function unbind() {
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('input', handleInput, true);
    document.removeEventListener('change', handleChange, true);
    document.removeEventListener('submit', handleSubmit, true);
    document.removeEventListener('keydown', handleKeydown, true);
    window.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('popstate', recordNavigationIfChanged, true);
    window.removeEventListener('hashchange', recordNavigationIfChanged, true);
    window.removeEventListener('pagehide', flushInputs, true);
  }

  function start(options = {}) {
    cancelInputs();
    if (options.clear !== false) state.steps = [];
    state.recording = true;
    state.paused = false;
    state.lastUrl = '';
    state.lastClick = null;
    state.lastSubmitIntent = state.lastEnter = 0;
    unbind();
    bind();
    recordNavigationIfChanged();
    persist();
    return snapshot();
  }

  function pause() {
    flushInputs();
    state.paused = true;
    persist();
    return snapshot();
  }

  function resume() {
    state.paused = false;
    recordNavigationIfChanged();
    persist();
    return snapshot();
  }

  function stop() {
    flushInputs();
    state.recording = false;
    state.paused = false;
    unbind();
    persist();
    return snapshot();
  }

  function clear() {
    cancelInputs();
    state.steps = [];
    persist();
    return snapshot();
  }

  function snapshot() {
    return {
      recording: state.recording,
      paused: state.paused,
      steps: state.steps.slice()
    };
  }

  window.FreeAuditRecorder = {
    setPersistence(callback) { state.onChange = callback; },
    restore(saved) {
      cancelInputs();
      state.steps = Array.isArray(saved?.steps) ? saved.steps : [];
      state.recording = Boolean(saved?.recording);
      state.paused = Boolean(saved?.paused);
      state.lastUrl = state.steps.at(-1)?.urlAfter || '';
      unbind();
      if (state.recording) { bind(); recordNavigationIfChanged(); }
      return snapshot();
    },
    start,
    pause,
    resume,
    stop,
    clear,
    snapshot,
    record
  };
})();
