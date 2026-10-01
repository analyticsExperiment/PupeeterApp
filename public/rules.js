(function() {
  const CONDITION_FIELDS = [
    { value: "initialUrl", label: "Initial URL", placeholder: "https://www.example.com/start", type: "text" },
    { value: "finalUrl", label: "Final URL", placeholder: "https://www.example.com/final", type: "text" },
    { value: "pageTitle", label: "Page Title", placeholder: "Expected title fragment", type: "text" },
    { value: "initialStatusCode", label: "Initial Status Code", placeholder: "200", type: "number" },
    { value: "finalStatusCode", label: "Final Status Code", placeholder: "200", type: "number" },
    { value: "tagVendor", label: "Tag Vendor", placeholder: "Adobe Analytics", type: "text" },
    { value: "tagName", label: "Tag Name", placeholder: "Google Analytics 4", type: "text" },
    { value: "requestUrl", label: "Request URL", placeholder: "/collect or /track", type: "text" },
    { value: "cookieName", label: "Cookie Name", placeholder: "_ga", type: "text" },
    { value: "dataLayer", label: "dataLayer", placeholder: "event or ecommerce.items", type: "text" },
    { value: "consoleText", label: "Console Text", placeholder: "Expected console fragment", type: "text" }
  ];

  const ASSERTION_TYPES = [
    { value: "tagPresence", label: "Tag Presence" },
    { value: "tagParam", label: "Tag Parameter" },
    { value: "requestUrl", label: "Request URL" },
    { value: "pageField", label: "Page Field" },
    { value: "cookie", label: "Cookie" },
    { value: "dataLayer", label: "dataLayer" },
    { value: "console", label: "Console" }
  ];

  const TEXT_OPERATORS = [
    { value: "contains", label: "contains" },
    { value: "notContains", label: "does not contain" },
    { value: "equals", label: "equals" },
    { value: "notEquals", label: "does not equal" },
    { value: "startsWith", label: "starts with" },
    { value: "endsWith", label: "ends with" },
    { value: "matchesRegex", label: "matches regex" },
    { value: "exists", label: "exists" },
    { value: "notExists", label: "does not exist" }
  ];

  const NUMERIC_OPERATORS = [
    { value: "equals", label: "equals" },
    { value: "notEquals", label: "does not equal" },
    { value: "greaterThan", label: "greater than" },
    { value: "greaterThanOrEqual", label: "greater than or equal" },
    { value: "lessThan", label: "less than" },
    { value: "lessThanOrEqual", label: "less than or equal" },
    { value: "exists", label: "exists" },
    { value: "notExists", label: "does not exist" }
  ];

  const COUNT_OPERATORS = [
    { value: "exists", label: "exists" },
    { value: "notExists", label: "does not exist" },
    { value: "countEquals", label: "count equals" },
    { value: "countAtLeast", label: "count at least" },
    { value: "countAtMost", label: "count at most" }
  ];

  const FIELD_OPERATORS = [
    ...NUMERIC_OPERATORS,
    ...TEXT_OPERATORS.filter((option) => !NUMERIC_OPERATORS.some((item) => item.value === option.value))
  ];

  const state = {
    ruleOptions: []
  };

  function closeCatalogPopovers(except) {
    document.querySelectorAll(".catalog-combobox-popover[data-open='true']").forEach((popover) => {
      if (popover !== except && typeof popover.__close === "function") popover.__close();
    });
  }

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function ruleOptionsHtml(selected) {
    const selectedValue = String(selected || "");
    const options = [`<option value="">Any detected tag</option>`];
    let hasSelectedValue = !selectedValue;
    for (const option of state.ruleOptions) {
      const value = String(option.name || "");
      const category = option.category ? ` (${option.category})` : "";
      if (value === selectedValue) hasSelectedValue = true;
      options.push(`<option value="${escapeText(value)}"${value === selectedValue ? " selected" : ""}>${escapeText(value)}${escapeText(category)}</option>`);
    }
    if (!hasSelectedValue) {
      options.push(`<option value="${escapeText(selectedValue)}" selected>${escapeText(selectedValue)} (custom)</option>`);
    }
    return options.join("");
  }

  function operatorOptionsHtml(options, selected) {
    const selectedValue = String(selected || "");
    return options.map((option) => (
      `<option value="${escapeText(option.value)}"${option.value === selectedValue ? " selected" : ""}>${escapeText(option.label)}</option>`
    )).join("");
  }

  function fieldOptionsHtml(selected) {
    const selectedValue = String(selected || "");
    return CONDITION_FIELDS.map((field) => (
      `<option value="${escapeText(field.value)}"${field.value === selectedValue ? " selected" : ""}>${escapeText(field.label)}</option>`
    )).join("");
  }

  function assertionTypeOptionsHtml(selected) {
    const selectedValue = String(selected || "");
    return ASSERTION_TYPES.map((type) => (
      `<option value="${escapeText(type.value)}"${type.value === selectedValue ? " selected" : ""}>${escapeText(type.label)}</option>`
    )).join("");
  }

  function getConditionFieldMeta(subject) {
    return CONDITION_FIELDS.find((field) => field.value === subject) || CONDITION_FIELDS[0];
  }

  function getConditionOperators(subject) {
    const meta = getConditionFieldMeta(subject);
    return meta.type === "number" ? NUMERIC_OPERATORS : TEXT_OPERATORS;
  }

  function getAssertionMeta(type) {
    switch (type) {
      case "tagPresence":
        return {
          operators: COUNT_OPERATORS,
          usesTag: true,
          fieldPlaceholder: "Optional tag name override",
          valuePlaceholder: "Expected count",
          description: "Verify whether a tag fired on the page."
        };
      case "tagParam":
        return {
          operators: TEXT_OPERATORS,
          usesTag: true,
          fieldPlaceholder: "Query parameter or request key (for example: pageName, cid)",
          valuePlaceholder: "Expected parameter value",
          description: "Validate a query parameter on matching tag requests."
        };
      case "requestUrl":
        return {
          operators: TEXT_OPERATORS,
          usesTag: true,
          fieldPlaceholder: "Optional notes",
          valuePlaceholder: "Expected request URL fragment",
          description: "Validate the request URL for a tag or any detected request."
        };
      case "pageField":
        return {
          operators: FIELD_OPERATORS,
          usesTag: false,
          fieldPlaceholder: "initialUrl, finalUrl, pageTitle, initialStatusCode, finalStatusCode",
          valuePlaceholder: "Expected page field value",
          description: "Validate a core page property."
        };
      case "cookie":
        return {
          operators: TEXT_OPERATORS,
          usesTag: false,
          fieldPlaceholder: "Cookie name",
          valuePlaceholder: "Expected cookie value",
          description: "Validate cookie presence or value."
        };
      case "dataLayer":
        return {
          operators: TEXT_OPERATORS,
          usesTag: false,
          fieldPlaceholder: "dataLayer key path (for example: event, ecommerce.items.0.id)",
          valuePlaceholder: "Expected dataLayer value",
          description: "Validate a key or text fragment from dataLayer."
        };
      case "console":
        return {
          operators: TEXT_OPERATORS,
          usesTag: false,
          fieldPlaceholder: "Optional console level (log, warn, error)",
          valuePlaceholder: "Expected console message fragment",
          description: "Validate captured console output."
        };
      default:
        return {
          operators: TEXT_OPERATORS,
          usesTag: false,
          fieldPlaceholder: "Field",
          valuePlaceholder: "Expected value",
          description: ""
        };
    }
  }

  function catalogItems(includeAny) {
    const items = state.ruleOptions.map((option) => ({
      value: String(option.name || ""),
      label: String(option.name || ""),
      category: String(option.category || "")
    })).filter((option) => option.value);
    if (includeAny) {
      return [{ value: "", label: "Any detected tag", category: "All captured tag requests" }, ...items];
    }
    return items;
  }

  function displayCatalogValue(value, includeAny) {
    const selectedValue = String(value || "");
    if (!selectedValue && includeAny) return "Any detected tag";
    const match = state.ruleOptions.find((option) => String(option.name || "") === selectedValue);
    return match ? String(match.name || "") : selectedValue;
  }

  function optionMatches(item, query) {
    if (!query) return true;
    const haystack = `${item.label} ${item.category}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function setSourceValue(source, value, includeAny) {
    source.value = value;
    const wrapper = source.__catalogWrapper;
    const trigger = wrapper && wrapper.querySelector(".catalog-combobox-input");
    if (trigger) trigger.value = displayCatalogValue(value, includeAny);
    source.dispatchEvent(new Event("input", { bubbles: true }));
    source.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function positionCatalogPopover(wrapper, popover) {
    const trigger = wrapper.querySelector(".catalog-combobox-input");
    if (!trigger || !popover) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const width = Math.min(Math.max(rect.width, 280), viewportWidth - 24);
    const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
    let top = rect.bottom + gap;
    let maxHeight = Math.min(340, viewportHeight - top - 12);
    if (maxHeight < 180 && rect.top > viewportHeight - rect.bottom) {
      maxHeight = Math.min(340, rect.top - 12);
      top = Math.max(12, rect.top - maxHeight - gap);
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.width = `${width}px`;
    popover.style.maxHeight = `${Math.max(180, maxHeight)}px`;
  }

  function openCatalogCombobox(source, config) {
    const wrapper = source.__catalogWrapper;
    if (!wrapper || source.disabled) return;
    closeCatalogPopovers();
    wrapper.classList.add("is-open");

    const popover = document.createElement("div");
    popover.className = "catalog-combobox-popover";
    popover.dataset.open = "true";
    popover.innerHTML = `
      <input class="catalog-combobox-search" type="search" placeholder="Search vendor or category..." autocomplete="off" />
      <div class="catalog-combobox-options" role="listbox"></div>
    `;

    const search = popover.querySelector(".catalog-combobox-search");
    const optionsRoot = popover.querySelector(".catalog-combobox-options");
    const includeAny = Boolean(config.includeAny);
    const allItems = catalogItems(includeAny);

    function close() {
      wrapper.classList.remove("is-open");
      popover.remove();
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      window.removeEventListener("resize", onWindowMove);
      window.removeEventListener("scroll", onWindowMove, true);
    }

    function choose(item) {
      setSourceValue(source, item.value, includeAny);
      close();
    }

    function renderOptions() {
      const query = search.value.trim();
      const matches = allItems.filter((item) => optionMatches(item, query)).slice(0, 120);
      optionsRoot.innerHTML = matches.length ? "" : '<div class="catalog-combobox-empty">No matching tags</div>';
      for (const item of matches) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "catalog-combobox-option";
        button.setAttribute("role", "option");
        button.dataset.value = item.value;
        button.innerHTML = `
          <span class="catalog-combobox-option-name">${escapeText(item.label)}</span>
          <span class="catalog-combobox-option-category">${escapeText(item.category || "Uncategorized")}</span>
        `;
        button.addEventListener("click", () => choose(item));
        optionsRoot.appendChild(button);
      }
    }

    function onDocumentPointerDown(event) {
      if (wrapper.contains(event.target) || popover.contains(event.target)) return;
      close();
    }

    function onDocumentKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "ArrowDown" && document.activeElement === search) {
        const first = popover.querySelector(".catalog-combobox-option");
        if (first) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "Enter" && document.activeElement?.classList.contains("catalog-combobox-option")) {
        document.activeElement.click();
      }
    }

    function onWindowMove() {
      if (popover.isConnected) positionCatalogPopover(wrapper, popover);
    }

    search.addEventListener("input", renderOptions);
    popover.__close = close;
    document.body.appendChild(popover);
    renderOptions();
    positionCatalogPopover(wrapper, popover);
    setTimeout(() => {
      document.addEventListener("pointerdown", onDocumentPointerDown, true);
      document.addEventListener("keydown", onDocumentKeyDown, true);
      window.addEventListener("resize", onWindowMove);
      window.addEventListener("scroll", onWindowMove, true);
      search.focus();
    }, 0);
  }

  function enhanceCatalogField(source, config = {}) {
    if (!source) return;
    const includeAny = Boolean(config.includeAny);
    source.classList.add("catalog-combobox-source");
    source.setAttribute("aria-hidden", "true");
    source.tabIndex = -1;

    let wrapper = source.__catalogWrapper;
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "catalog-combobox";
      wrapper.innerHTML = `
        <input class="catalog-combobox-input" type="text" readonly autocomplete="off" />
        <button class="catalog-combobox-button" type="button" aria-label="Open tag picker">v</button>
      `;
      source.insertAdjacentElement("afterend", wrapper);
      source.__catalogWrapper = wrapper;
      wrapper.__catalogSource = source;
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openCatalogCombobox(source, wrapper.__catalogConfig || {});
      };
      wrapper.querySelector(".catalog-combobox-input").addEventListener("click", open);
      wrapper.querySelector(".catalog-combobox-input").addEventListener("focus", open);
      wrapper.querySelector(".catalog-combobox-button").addEventListener("click", open);
      wrapper.addEventListener("keydown", (event) => {
        if (["Enter", " ", "ArrowDown"].includes(event.key)) open(event);
      });
    }

    wrapper.__catalogConfig = {
      includeAny,
      placeholder: config.placeholder || "Select tag"
    };
    wrapper.querySelector(".catalog-combobox-input").placeholder = wrapper.__catalogConfig.placeholder;
    wrapper.querySelector(".catalog-combobox-input").value = displayCatalogValue(source.value, includeAny);
    wrapper.querySelector(".catalog-combobox-input").disabled = source.disabled;
    wrapper.querySelector(".catalog-combobox-button").disabled = source.disabled;
    wrapper.classList.toggle("is-disabled", source.disabled);
  }

  function destroyCatalogField(source) {
    if (!source) return;
    const wrapper = source.__catalogWrapper;
    if (wrapper) {
      closeCatalogPopovers();
      wrapper.remove();
      source.__catalogWrapper = null;
    }
    source.classList.remove("catalog-combobox-source");
    source.removeAttribute("aria-hidden");
    source.removeAttribute("tabindex");
  }

  function buildConditionRow(condition) {
    const row = document.createElement("div");
    row.className = "rule-row rule-condition-row";
    const subject = String(condition && condition.subject ? condition.subject : "finalUrl");
    const operator = String(condition && condition.operator ? condition.operator : "contains");
    const value = condition && condition.value != null ? String(condition.value) : "";
    row.innerHTML = `
      <select class="rule-condition-subject">${fieldOptionsHtml(subject)}</select>
      <select class="rule-condition-operator"></select>
      <input class="rule-condition-value" value="${escapeText(value)}" />
      <button type="button" class="rule-row-delete">X</button>
    `;
    updateConditionRow(row, operator);
    return row;
  }

  function buildAssertionRow(assertion) {
    const row = document.createElement("div");
    row.className = "rule-row rule-assertion-row";
    const type = String(assertion && assertion.type ? assertion.type : "tagPresence");
    const operator = String(assertion && assertion.operator ? assertion.operator : (type === "tagPresence" ? "exists" : "contains"));
    const tag = assertion && assertion.tag != null ? String(assertion.tag) : "";
    const field = assertion && assertion.field != null ? String(assertion.field) : "";
    const value = assertion && assertion.value != null ? String(assertion.value) : "";
    const description = assertion && assertion.description != null ? String(assertion.description) : "";
    row.innerHTML = `
      <select class="rule-assertion-type">${assertionTypeOptionsHtml(type)}</select>
      <select class="rule-assertion-tag">${ruleOptionsHtml(tag)}</select>
      <input class="rule-assertion-field" value="${escapeText(field)}" />
      <select class="rule-assertion-operator"></select>
      <input class="rule-assertion-value" value="${escapeText(value)}" />
      <input class="rule-assertion-description" value="${escapeText(description)}" placeholder="Description (optional)" />
      <button type="button" class="rule-row-delete">X</button>
    `;
    updateAssertionRow(row, operator);
    return row;
  }

  function buildRuleCard(rule) {
    const card = document.createElement("div");
    card.className = "rule-card is-open";
    const name = rule && rule.name != null ? String(rule.name) : "";
    const whenMode = String(rule && rule.whenMode ? rule.whenMode : "all");
    const expectMode = String(rule && rule.expectMode ? rule.expectMode : "all");
    const evaluationLimit = Number(rule && rule.evaluationLimit) > 0 ? Number(rule.evaluationLimit) : 1;
    card.innerHTML = `
      <div class="rule-card-header">
        <div class="rule-card-left">
          <span class="rule-card-index">1</span>
          <div class="rule-card-title-stack">
            <input class="rule-name" value="${escapeText(name)}" placeholder="Rule name" />
            <div class="rule-card-summary" data-rule-summary>Rule details</div>
          </div>
        </div>
        <div class="rule-card-actions">
          <button type="button" class="rule-toggle" aria-expanded="true">Collapse</button>
          <button type="button" class="rule-move-up">Up</button>
          <button type="button" class="rule-move-down">Dn</button>
          <button type="button" class="rule-delete">Remove Rule</button>
        </div>
      </div>
      <div class="rule-card-body">
        <div class="rule-panels">
          <div class="rule-panel">
            <div class="rule-panel-header">
              <div>
                <h3>When</h3>
                <p class="muted">Apply this rule only when the current page matches these conditions.</p>
              </div>
              <div class="rule-panel-actions">
                <select class="rule-when-mode">
                  <option value="all"${whenMode === "all" ? " selected" : ""}>All conditions</option>
                  <option value="any"${whenMode === "any" ? " selected" : ""}>Any condition</option>
                </select>
                <button type="button" class="rule-add-condition">+ Add Condition</button>
              </div>
            </div>
            <div class="rule-conditions"></div>
          </div>
          <div class="rule-panel">
            <div class="rule-panel-header">
              <div>
                <h3>Expect</h3>
                <p class="muted">Validate tags, request params, page properties, cookies, or dataLayer values.</p>
              </div>
              <div class="rule-panel-actions">
                <select class="rule-expect-mode">
                  <option value="all"${expectMode === "all" ? " selected" : ""}>All expectations</option>
                  <option value="any"${expectMode === "any" ? " selected" : ""}>Any expectation</option>
                </select>
                <button type="button" class="rule-add-assertion">+ Add Expectation</button>
              </div>
            </div>
            <div class="rule-assertions"></div>
          </div>
        </div>
        <div class="rule-card-footer">
          <label>Evaluation Limit</label>
          <input class="rule-evaluation-limit" type="number" min="1" value="${evaluationLimit}" />
          <span class="muted">Inspect up to this many matching requests per page when a rule targets a tag.</span>
        </div>
      </div>
    `;

    const conditions = Array.isArray(rule && rule.conditions) && rule.conditions.length ? rule.conditions : [{ subject: "finalUrl", operator: "contains", value: "" }];
    const assertions = Array.isArray(rule && rule.assertions) && rule.assertions.length ? rule.assertions : [{ type: "tagPresence", operator: "exists", tag: "", value: "1" }];
    const conditionsRoot = card.querySelector(".rule-conditions");
    const assertionsRoot = card.querySelector(".rule-assertions");
    conditions.forEach((condition) => conditionsRoot.appendChild(buildConditionRow(condition)));
    assertions.forEach((assertion) => assertionsRoot.appendChild(buildAssertionRow(assertion)));
    updateRuleCardSummary(card);
    return card;
  }

  function updateRuleCardSummary(card) {
    const summary = card && card.querySelector("[data-rule-summary]");
    if (!summary) return;
    const conditions = card.querySelectorAll(".rule-condition-row").length;
    const assertions = card.querySelectorAll(".rule-assertion-row").length;
    const mode = card.querySelector(".rule-when-mode")?.value === "any" ? "any condition" : "all conditions";
    const expectMode = card.querySelector(".rule-expect-mode")?.value === "any" ? "any expectation" : "all expectations";
    summary.textContent = `${conditions} ${conditions === 1 ? "condition" : "conditions"} (${mode}) • ${assertions} ${assertions === 1 ? "expectation" : "expectations"} (${expectMode})`;
  }

  function toggleRuleCard(card, forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : card.classList.contains("is-collapsed");
    card.classList.toggle("is-collapsed", !shouldOpen);
    card.classList.toggle("is-open", shouldOpen);
    const toggle = card.querySelector(".rule-toggle");
    if (toggle) {
      toggle.textContent = shouldOpen ? "Collapse" : "Open";
      toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
    }
  }

  function updateConditionRow(row, operatorValue) {
    const subject = row.querySelector(".rule-condition-subject").value;
    const operatorSelect = row.querySelector(".rule-condition-operator");
    const valueInput = row.querySelector(".rule-condition-value");
    const meta = getConditionFieldMeta(subject);
    const operators = getConditionOperators(subject);
    const selectedOperator = operatorValue || operatorSelect.value || operators[0].value;
    operatorSelect.innerHTML = operatorOptionsHtml(operators, selectedOperator);
    valueInput.placeholder = meta.placeholder;
    valueInput.type = meta.type === "number" ? "number" : "text";
    if (subject === "tagVendor" || subject === "tagName") {
      valueInput.removeAttribute("list");
      enhanceCatalogField(valueInput, { includeAny: false, placeholder: meta.placeholder || "Select tag" });
    } else {
      destroyCatalogField(valueInput);
      valueInput.removeAttribute("list");
    }
  }

  function updateAssertionRow(row, operatorValue) {
    const type = row.querySelector(".rule-assertion-type").value;
    const tagSelect = row.querySelector(".rule-assertion-tag");
    const fieldInput = row.querySelector(".rule-assertion-field");
    const operatorSelect = row.querySelector(".rule-assertion-operator");
    const valueInput = row.querySelector(".rule-assertion-value");
    const descriptionInput = row.querySelector(".rule-assertion-description");
    const meta = getAssertionMeta(type);
    const selectedTag = tagSelect.value;
    tagSelect.innerHTML = ruleOptionsHtml(selectedTag);
    tagSelect.disabled = !meta.usesTag;
    tagSelect.classList.toggle("is-disabled", !meta.usesTag);
    enhanceCatalogField(tagSelect, { includeAny: true, placeholder: meta.usesTag ? "Any detected tag" : "Not used for this expectation" });
    operatorSelect.innerHTML = operatorOptionsHtml(meta.operators, operatorValue || operatorSelect.value || meta.operators[0].value);
    fieldInput.placeholder = meta.fieldPlaceholder;
    valueInput.placeholder = meta.valuePlaceholder;
    valueInput.type = operatorSelect.value.includes("count") ? "number" : "text";
    descriptionInput.placeholder = meta.description || "Description (optional)";
  }

  function updateRuleOrdering() {
    const cards = Array.from(document.querySelectorAll("#rulesList .rule-card"));
    cards.forEach((card, index) => {
      const indexEl = card.querySelector(".rule-card-index");
      const up = card.querySelector(".rule-move-up");
      const down = card.querySelector(".rule-move-down");
      if (indexEl) indexEl.textContent = String(index + 1);
      if (up) up.disabled = index === 0;
      if (down) down.disabled = index === cards.length - 1;
    });
  }

  function addRule(rule) {
    const root = document.getElementById("rulesList");
    if (!root) return;
    root.appendChild(buildRuleCard(rule || {}));
    updateRuleOrdering();
  }

  function moveRule(card, direction) {
    const parent = card.parentElement;
    if (!parent) return;
    if (direction < 0 && card.previousElementSibling) {
      parent.insertBefore(card, card.previousElementSibling);
    } else if (direction > 0 && card.nextElementSibling) {
      parent.insertBefore(card.nextElementSibling, card);
    }
    updateRuleOrdering();
  }

  function collectConditionRow(row) {
    return {
      subject: row.querySelector(".rule-condition-subject").value,
      operator: row.querySelector(".rule-condition-operator").value,
      value: row.querySelector(".rule-condition-value").value.trim()
    };
  }

  function collectAssertionRow(row) {
    return {
      type: row.querySelector(".rule-assertion-type").value,
      tag: row.querySelector(".rule-assertion-tag").disabled ? "" : row.querySelector(".rule-assertion-tag").value,
      field: row.querySelector(".rule-assertion-field").value.trim(),
      operator: row.querySelector(".rule-assertion-operator").value,
      value: row.querySelector(".rule-assertion-value").value.trim(),
      description: row.querySelector(".rule-assertion-description").value.trim()
    };
  }

  function collectRules() {
    return Array.from(document.querySelectorAll("#rulesList .rule-card"))
      .map((card, index) => {
        const name = card.querySelector(".rule-name").value.trim();
        const conditions = Array.from(card.querySelectorAll(".rule-condition-row")).map(collectConditionRow).filter((row) => row.subject);
        const assertions = Array.from(card.querySelectorAll(".rule-assertion-row")).map(collectAssertionRow).filter((row) => row.type);
        if (!name && !conditions.length && !assertions.length) return null;
        return {
          id: `rule-${index + 1}`,
          name: name || `Rule ${index + 1}`,
          whenMode: card.querySelector(".rule-when-mode").value,
          expectMode: card.querySelector(".rule-expect-mode").value,
          evaluationLimit: Number(card.querySelector(".rule-evaluation-limit").value || 1),
          conditions,
          assertions
        };
      })
      .filter(Boolean);
  }

  function setRuleOptions(options) {
    state.ruleOptions = Array.isArray(options) ? options.slice() : [];
    const datalist = document.getElementById("ruleTagOptions");
    if (datalist) {
      datalist.innerHTML = state.ruleOptions.map((option) => (
        `<option value="${escapeText(option.name || '')}"></option>`
      )).join("");
    }
    document.querySelectorAll(".rule-assertion-tag").forEach((select) => {
      const currentValue = select.value;
      select.innerHTML = ruleOptionsHtml(currentValue);
    });
    document.querySelectorAll(".rule-condition-row").forEach((row) => updateConditionRow(row));
  }

  function init(options) {
    setRuleOptions(options && options.ruleOptions ? options.ruleOptions : []);
    const addButton = document.getElementById("addRule");
    const root = document.getElementById("rulesList");
    if (!addButton || !root) return;
    if (!root.dataset.bound) {
      root.dataset.bound = "true";
      root.addEventListener("change", (event) => {
        const conditionRow = event.target.closest(".rule-condition-row");
        if (conditionRow && event.target.classList.contains("rule-condition-subject")) {
          updateConditionRow(conditionRow);
        }
        if (conditionRow && event.target.classList.contains("rule-condition-operator")) {
          const valueInput = conditionRow.querySelector(".rule-condition-value");
          valueInput.type = getConditionFieldMeta(conditionRow.querySelector(".rule-condition-subject").value).type === "number" ? "number" : "text";
        }
        const assertionRow = event.target.closest(".rule-assertion-row");
        if (assertionRow && event.target.classList.contains("rule-assertion-type")) {
          updateAssertionRow(assertionRow);
        }
        if (assertionRow && event.target.classList.contains("rule-assertion-operator")) {
          const valueInput = assertionRow.querySelector(".rule-assertion-value");
          valueInput.type = event.target.value.includes("count") ? "number" : "text";
        }
        const card = event.target.closest(".rule-card");
        if (card) updateRuleCardSummary(card);
      });
      root.addEventListener("input", (event) => {
        const card = event.target.closest(".rule-card");
        if (card) updateRuleCardSummary(card);
      });
      root.addEventListener("click", (event) => {
        const deleteRow = event.target.closest(".rule-row-delete");
        if (deleteRow) {
          const row = deleteRow.closest(".rule-row");
          const parent = row && row.parentElement;
          if (row) row.remove();
          if (parent && !parent.children.length) {
            if (parent.classList.contains("rule-conditions")) parent.appendChild(buildConditionRow({ subject: "finalUrl", operator: "contains", value: "" }));
            if (parent.classList.contains("rule-assertions")) parent.appendChild(buildAssertionRow({ type: "tagPresence", operator: "exists", tag: "", value: "1" }));
          }
          const card = parent && parent.closest(".rule-card");
          if (card) updateRuleCardSummary(card);
          return;
        }

        const card = event.target.closest(".rule-card");
        if (!card) return;
        if (event.target.closest(".rule-toggle")) {
          toggleRuleCard(card);
          return;
        }
        if (event.target.closest(".rule-add-condition")) {
          card.querySelector(".rule-conditions").appendChild(buildConditionRow({ subject: "finalUrl", operator: "contains", value: "" }));
          updateRuleCardSummary(card);
          return;
        }
        if (event.target.closest(".rule-add-assertion")) {
          card.querySelector(".rule-assertions").appendChild(buildAssertionRow({ type: "tagPresence", operator: "exists", tag: "", value: "1" }));
          updateRuleCardSummary(card);
          return;
        }
        if (event.target.closest(".rule-delete")) {
          card.remove();
          if (!root.children.length) addRule();
          updateRuleOrdering();
          return;
        }
        if (event.target.closest(".rule-move-up")) {
          moveRule(card, -1);
          return;
        }
        if (event.target.closest(".rule-move-down")) {
          moveRule(card, 1);
        }
      });
      addButton.addEventListener("click", () => addRule());
    }
    if (!root.children.length) addRule();
    updateRuleOrdering();
  }

  function summarizeRuleStatus(ruleResults, status) {
    return (Array.isArray(ruleResults) ? ruleResults : []).filter((rule) => rule.status === status).length;
  }

  function renderRuleSummaryBlock(results) {
    const summary = results && results.ruleSummary;
    if (!summary || !summary.rules || !summary.rules.length) return "";
    const totals = summary.totals || {};
    const rows = summary.rules.map((rule) => `
      <tr>
        <td>${escapeText(rule.name)}</td>
        <td>${rule.failedPages || 0}</td>
        <td>${rule.passedPages || 0}</td>
        <td>${rule.skippedPages || 0}</td>
      </tr>
    `).join("");
    return `
      <div class="rule-summary-block">
        <div class="flow-header">
          <h2>Rule Results</h2>
          <button type="button" class="pill" id="viewRulesSummary">Open Details</button>
        </div>
        <div class="summary rule-summary-cards">
          <div class="card"><div class="muted">Configured Rules</div><div style="font-size:22px">${totals.configuredRules || 0}</div></div>
          <div class="card"><div class="muted">Passed Evaluations</div><div style="font-size:22px">${totals.passedEvaluations || 0}</div></div>
          <div class="card"><div class="muted">Failed Evaluations</div><div style="font-size:22px">${totals.failedEvaluations || 0}</div></div>
          <div class="card"><div class="muted">Not Applied</div><div style="font-size:22px">${totals.skippedEvaluations || 0}</div></div>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>Rule</th>
              <th>Pages Failed</th>
              <th>Pages Passed</th>
              <th>Not Applied</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderPageRuleMeta(page) {
    const failed = summarizeRuleStatus(page && page.ruleResults, "failed");
    const passed = summarizeRuleStatus(page && page.ruleResults, "passed");
    const skipped = summarizeRuleStatus(page && page.ruleResults, "skipped");
    return `rules: ${passed} passed, ${failed} failed, ${skipped} not applied`;
  }

  function renderRuleCheckRows(results) {
    const rows = (Array.isArray(results) ? results : []).map((row) => `
      <tr>
        <td>${escapeText(row.subject || row.tag || row.field || "-")}</td>
        <td>${escapeText(row.operator || "-")}</td>
        <td class="code break">${escapeText(row.expected || "-")}</td>
        <td class="code break">${escapeText(row.actual || "-")}</td>
        <td>${row.passed ? '<span class="pill">Pass</span>' : '<span class="pill rule-pill-failed">Fail</span>'}</td>
      </tr>
    `).join("");
    return rows || '<tr><td colspan="5" class="muted">No checks recorded</td></tr>';
  }

  function openRuleSummaryModal(results) {
    if (!results || !results.ruleSummary) return;
    const summary = results.ruleSummary;
    const ruleRows = summary.rules.map((rule) => `
      <tr>
        <td>${escapeText(rule.name)}</td>
        <td>${rule.failedPages || 0}</td>
        <td>${rule.passedPages || 0}</td>
        <td>${rule.skippedPages || 0}</td>
      </tr>
    `).join("");
    const html = `
      <div class="muted" style="margin-bottom:12px;">Rules are evaluated after request capture completes on each page.</div>
      <table class="table">
        <thead>
          <tr>
            <th>Rule</th>
            <th>Pages Failed</th>
            <th>Pages Passed</th>
            <th>Not Applied</th>
          </tr>
        </thead>
        <tbody>${ruleRows}</tbody>
      </table>
    `;
    showModal("Rule Results", html, { push: true, state: { type: "rules-summary" } });
  }

  function openPageRulesModal(page) {
    const ruleResults = Array.isArray(page && page.ruleResults) ? page.ruleResults : [];
    const sections = ruleResults.map((rule, index) => `
      <details class="rule-result-card" ${index === 0 ? "open" : ""}>
        <summary class="flex" style="justify-content:space-between; align-items:center;">
          <strong>${escapeText(rule.name)}</strong>
          <span class="pill ${rule.status === "failed" ? "rule-pill-failed" : rule.status === "passed" ? "rule-pill-passed" : ""}">${escapeText(rule.status)}</span>
        </summary>
        <div class="muted" style="margin:6px 0 10px;">${escapeText(rule.summary || "")}</div>
        <div class="rule-result-section">
          <h4>Conditions</h4>
          <table class="table">
            <thead><tr><th>Field</th><th>Operator</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
            <tbody>${renderRuleCheckRows(rule.when && rule.when.results)}</tbody>
          </table>
        </div>
        <div class="rule-result-section">
          <h4>Expectations</h4>
          <table class="table">
            <thead><tr><th>Field</th><th>Operator</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
            <tbody>${renderRuleCheckRows(rule.expect && rule.expect.results)}</tbody>
          </table>
        </div>
      </details>
    `).join("");

    const html = `
      <div class="muted" style="margin-bottom:12px;">${escapeText((page && page.url) || "")}</div>
      ${sections || '<div class="muted">No rules were configured for this audit.</div>'}
    `;
    showModal("Page Rule Results", html, { push: true, state: { type: "page-rules", pageUrl: page && page.url ? page.url : "" } });
  }

  window.RuleBuilder = {
    init,
    addRule,
    collectRules,
    setRuleOptions,
    renderRuleSummaryBlock,
    renderPageRuleMeta,
    openRuleSummaryModal,
    openPageRulesModal
  };
})();
