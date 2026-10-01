(function () {
  const ACTION_OPTIONS = [
    'click',
    'type',
    'waitForSelector',
    'waitForTimeout',
    'hover',
    'scroll',
    'navigate',
    'openUrl',
    'navigateToUrl',
    'pageRefresh',
    'switchToIFrame',
    'switchToMainFrame',
    'executeJavaScript',
    'fillFormField',
    'selectDropdownOption',
    'checkCheckbox',
    'uncheckCheckbox',
    'uploadFile',
    'pressKey',
    'waitForNavigation',
    'waitForNetworkIdle',
    'waitForRequestMatching',
    'waitForResponseMatching',
    'captureStepSnapshot',
    'assertElementExists',
    'assertElementText',
    'assertUrlContains'
  ];

  function escapeHtml(value) {
    return window.FreeAuditApi
      ? window.FreeAuditApi.escapeHtml(value)
      : String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  function looksLikeJavaScriptSnippet(value) {
    const text = String(value || '').trim();
    return Boolean(text && /(document\.|window\.|querySelector|querySelectorAll|=>|function\s*\(|\.click\s*\(|return\s+|console\.|await\s+)/i.test(text));
  }

  function updateRowUI(row) {
    const action = String(row.querySelector('.action')?.value || '').toLowerCase();
    row.dataset.action = action;
    const selector = row.querySelector('.selector');
    const value = row.querySelector('.value');
    if (!selector || !value) return;
    if (action === 'navigate' || action === 'openurl' || action === 'navigatetourl') {
      selector.placeholder = 'URL to navigate';
      value.placeholder = 'optional notes';
    } else if (action === 'pagerefresh' || action === 'refresh' || action === 'reload') {
      selector.placeholder = 'not required';
      value.placeholder = 'not required';
    } else if (action === 'switchtoiframe') {
      selector.placeholder = 'iframe selector';
      value.placeholder = 'or frame name/url contains';
    } else if (action === 'switchtomainframe' || action === 'waitfortimeout' || action === 'waitfornavigation' || action === 'waitfornetworkidle' || action === 'capturestepsnapshot') {
      selector.placeholder = 'not required';
      value.placeholder = 'not required';
    } else if (action === 'presskey') {
      selector.placeholder = 'optional focused selector';
      value.placeholder = 'key, for example Enter, Tab, Escape';
    } else if (action === 'waitforrequestmatching' || action === 'waitforresponsematching' || action === 'asserturlcontains') {
      selector.placeholder = 'not required';
      value.placeholder = 'URL fragment to match';
    } else if (action === 'selectdropdownoption') {
      selector.placeholder = 'select element selector';
      value.placeholder = 'option value or label';
    } else if (action === 'checkcheckbox' || action === 'uncheckcheckbox' || action === 'assertelementexists') {
      selector.placeholder = 'selector';
      value.placeholder = 'not required';
    } else if (action === 'uploadfile') {
      selector.placeholder = 'file input selector';
      value.placeholder = 'local file path';
    } else if (action === 'assertelementtext') {
      selector.placeholder = 'selector';
      value.placeholder = 'expected text fragment';
    } else if (action === 'executejavascript') {
      if (!value.value.trim() && looksLikeJavaScriptSnippet(selector.value)) {
        value.value = selector.value;
        selector.value = '';
      }
      selector.placeholder = 'optional selector/context';
      value.placeholder = 'JavaScript to execute in page context';
    } else {
      selector.placeholder = 'selector';
      value.placeholder = 'value (for type)';
    }
  }

  function updateOrder(container) {
    Array.from(container.querySelectorAll('.step')).forEach((row, index) => {
      row.querySelector('.step-index').textContent = String(index + 1);
      row.querySelector('.move-up').disabled = index === 0;
      row.querySelector('.move-down').disabled = index === container.querySelectorAll('.step').length - 1;
    });
  }

  function buildStepRow(step = {}) {
    const row = document.createElement('div');
    row.className = 'step template-step';
    row.innerHTML = `
      <div class="step-seq">
        <span class="step-index">1</span>
        <div class="step-move">
          <button class="move-up" type="button">Up</button>
          <button class="move-down" type="button">Dn</button>
        </div>
      </div>
      <select class="action">${ACTION_OPTIONS.map((action) => `<option value="${action}">${escapeHtml(action)}</option>`).join('')}</select>
      <input class="selector" placeholder="selector" />
      <textarea class="value" rows="2" placeholder="value"></textarea>
      <input class="timeout" placeholder="timeout ms" type="number" />
      <button class="del" type="button">X</button>
    `;
    row.querySelector('.action').value = step.action || 'click';
    row.querySelector('.selector').value = step.selector || '';
    row.querySelector('.value').value = step.value || '';
    row.querySelector('.timeout').value = step.timeout || '';
    row.querySelector('.action').addEventListener('change', () => updateRowUI(row));
    row.querySelector('.move-up').addEventListener('click', () => {
      const previous = row.previousElementSibling;
      if (previous) row.parentElement.insertBefore(row, previous);
      updateOrder(row.parentElement);
    });
    row.querySelector('.move-down').addEventListener('click', () => {
      const next = row.nextElementSibling;
      if (next) row.parentElement.insertBefore(next, row);
      updateOrder(row.parentElement);
    });
    row.querySelector('.del').addEventListener('click', () => {
      const parent = row.parentElement;
      row.remove();
      if (parent) updateOrder(parent);
    });
    updateRowUI(row);
    return row;
  }

  function addStep(container, step = {}) {
    container.appendChild(buildStepRow(step));
    updateOrder(container);
  }

  function setSteps(container, steps = []) {
    container.innerHTML = '';
    (Array.isArray(steps) && steps.length ? steps : [{ action: 'click' }]).forEach((step) => addStep(container, step));
  }

  function collectSteps(container) {
    return Array.from(container.querySelectorAll('.step')).map((row) => {
      const action = row.querySelector('.action').value;
      const selector = row.querySelector('.selector').value.trim();
      const value = row.querySelector('.value').value;
      const timeout = row.querySelector('.timeout').value;
      const step = { action };
      if (action === 'navigate' || action === 'openUrl' || action === 'navigateToUrl') {
        if (selector) step.value = selector;
        else if (value) step.value = value;
      } else if (action === 'executeJavaScript') {
        if (value) step.value = value;
        if (selector) step.selector = selector;
      } else {
        if (selector) step.selector = selector;
        if (value) step.value = value;
      }
      if (timeout) step.timeout = Number(timeout);
      return step;
    });
  }

  window.FreeAuditActionBuilder = {
    ACTION_OPTIONS,
    addStep,
    setSteps,
    collectSteps
  };
})();
