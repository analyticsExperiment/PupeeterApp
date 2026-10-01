(function () {
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function isRandomLike(value) {
    const text = String(value || '');
    if (text.length > 36) return true;
    if (/[a-f0-9]{12,}/i.test(text) && /\d/.test(text)) return true;
    if (/(^|[-_])(ember|react|radix|headlessui|uid|uuid)[-_]?\d+/i.test(text)) return true;
    return false;
  }

  function visibleText(element) {
    return String(element.innerText || element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  }

  function labelText(element) {
    if (!element || !element.ownerDocument) return '';
    const doc = element.ownerDocument;
    if (element.id) {
      const label = doc.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return visibleText(label);
    }
    const wrapping = element.closest('label');
    return wrapping ? visibleText(wrapping) : '';
  }

  function countMatches(selector, doc) {
    try {
      return doc.querySelectorAll(selector).length;
    } catch (_) {
      return 0;
    }
  }

  function result(element, selector, strategy, confidence) {
    const matches = countMatches(selector, element.ownerDocument);
    return {
      selector,
      strategy,
      confidence: matches === 1 ? confidence : Math.max(0.2, confidence - 0.25),
      matches,
      label: element.getAttribute('aria-label') || labelText(element) || visibleText(element) || element.name || element.id || element.tagName.toLowerCase()
    };
  }

  function unique(element, selector, strategy, confidence) {
    const matches = countMatches(selector, element.ownerDocument);
    if (matches === 1) return result(element, selector, strategy, confidence);
    return null;
  }

  function stableClasses(element) {
    return Array.from(element.classList || [])
      .filter((item) => item && !isRandomLike(item) && !/active|selected|hover|focus|open|disabled/i.test(item))
      .slice(0, 3);
  }

  function nthPath(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      const index = siblings.indexOf(node) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
      const selector = parts.join(' > ');
      if (countMatches(selector, element.ownerDocument) === 1) return selector;
      node = parent;
    }
    return parts.join(' > ');
  }

  function generateSelector(element) {
    if (!element || !element.ownerDocument || !element.tagName) {
      return { selector: '', strategy: 'none', confidence: 0, matches: 0, label: '' };
    }
    const tag = element.tagName.toLowerCase();
    for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
      const value = element.getAttribute(attr);
      if (value) {
        const match = unique(element, `[${attr}="${cssEscape(value)}"]`, attr, 0.98);
        if (match) return match;
      }
    }
    if (element.id && !isRandomLike(element.id)) {
      const match = unique(element, `#${cssEscape(element.id)}`, 'id', 0.95);
      if (match) return match;
    }
    if (element.getAttribute('name')) {
      const match = unique(element, `${tag}[name="${cssEscape(element.getAttribute('name'))}"]`, 'name', 0.88);
      if (match) return match;
    }
    if (element.getAttribute('aria-label')) {
      const match = unique(element, `${tag}[aria-label="${cssEscape(element.getAttribute('aria-label'))}"]`, 'aria-label', 0.84);
      if (match) return match;
    }
    const label = labelText(element);
    if (label && element.id) {
      const match = unique(element, `label[for="${cssEscape(element.id)}"] + ${tag}`, 'label', 0.72);
      if (match) return match;
    }
    const classes = stableClasses(element);
    if (classes.length) {
      const match = unique(element, `${tag}.${classes.map(cssEscape).join('.')}`, 'class', 0.58);
      if (match) return match;
    }
    const path = nthPath(element);
    return result(element, path, 'nth-of-type', 0.35);
  }

  window.FreeAuditSelector = {
    generateSelector,
    isRandomLike,
    labelText
  };
})();
