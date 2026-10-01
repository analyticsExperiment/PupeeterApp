(function () {
  const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const object = value => value !== null && typeof value === 'object';
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  const primitive = value => typeof value === 'string' ? JSON.stringify(value) : String(value);
  const brief = value => Array.isArray(value) ? `Array(${value.length})` : object(value) ? `{${Object.keys(value).length}}` : primitive(value);

  // A self-contained element survives the reports' existing HTML-based modal Back stack.
  class JsonInspector extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      try { this.config = JSON.parse(this.getAttribute('data-config')); }
      catch { this.textContent = 'Unable to display captured JSON.'; return; }
      this.replaceChildren();
      this.snapshots = this.config.snapshots || [{ label: this.config.label || 'JSON', value: this.config.value }];
      this.active = 0;
      this.mode = 'tree';
      this.query = '';
      this.classList.add('json-inspector');
      this.setAttribute('aria-label', this.config.label || 'JSON inspector');
      const bar = element('div', 'ji-toolbar');
      if (this.snapshots.length > 1) {
        const group = element('div', 'ji-segments');
        group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Captured snapshot');
        this.snapshotButtons = this.snapshots.map((snapshot, i) => {
          const button = this.button(snapshot.label, () => { this.active = i; this.refresh(); });
          group.append(button); return button;
        });
        bar.append(group);
      }
      this.search = element('input', 'ji-search');
      this.search.type = 'search'; this.search.placeholder = 'Filter keys or values';
      this.search.setAttribute('aria-label', 'Filter JSON keys or values');
      this.search.addEventListener('input', () => { this.query = this.search.value.trim().toLowerCase(); this.refresh(); });
      this.search.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.search.value) {
          event.stopPropagation(); this.search.value = ''; this.query = ''; this.refresh();
        }
      });
      bar.append(this.search);
      const modes = element('div', 'ji-segments');
      modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'JSON view');
      this.treeButton = this.button('Tree', () => { this.mode = 'tree'; this.refresh(); });
      this.rawButton = this.button('JSON', () => { this.mode = 'raw'; this.refresh(); });
      modes.append(this.treeButton, this.rawButton);
      bar.append(modes);
      this.expand = this.iconButton('unfold-vertical', 'Expand one level', () => {
        const branches = [...this.tree.querySelectorAll('details:not([open])')].filter(node => !node.parentElement.closest('details:not([open])'));
        branches.slice(0, 100).forEach(node => { node.populate(); node.open = true; });
        this.status.textContent = `Expanded ${Math.min(100, branches.length)} branches.`;
      });
      this.collapse = this.iconButton('fold-vertical', 'Collapse all', () => {
        this.tree.querySelectorAll('details').forEach(node => { node.open = false; });
        this.status.textContent = 'All branches collapsed.';
      });
      this.copy = this.iconButton('copy', 'Copy JSON', async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(this.value(), null, 2)); this.status.textContent = 'JSON copied.'; }
        catch { this.mode = 'raw'; this.refresh(); this.status.textContent = 'Clipboard unavailable. Select and copy from the JSON view.'; }
      });
      const commands = element('div', 'ji-commands');
      commands.append(this.expand, this.collapse, this.copy);
      bar.append(commands);
      this.info = element('div', 'ji-info');
      this.count = element('span');
      this.status = element('span', 'ji-status'); this.status.setAttribute('role', 'status');
      this.info.append(this.count, this.status);
      this.tree = element('div', 'ji-tree'); this.tree.tabIndex = 0;
      this.tree.setAttribute('role', 'region'); this.tree.setAttribute('aria-label', 'Captured JSON');
      this.append(bar, this.info, this.tree);
      this.refresh();
    }

    button(label, action) {
      const button = element('button', '', label); button.type = 'button';
      button.addEventListener('click', action); return button;
    }

    iconButton(icon, label, action) {
      const button = this.button('', action); button.className = 'ji-icon';
      button.title = label; button.setAttribute('aria-label', label);
      const img = element('img'); img.src = `/vendor/lucide/${icon}.svg`; img.alt = '';
      button.append(img); return button;
    }

    value() { return this.snapshots[this.active].value; }

    matches(value, key) {
      return !this.query || String(key).toLowerCase().includes(this.query) || String(JSON.stringify(value)).toLowerCase().includes(this.query);
    }

    text(parent, text, className) {
      const span = element('span', className);
      const value = String(text);
      const index = this.query ? value.toLowerCase().indexOf(this.query) : -1;
      if (index < 0) span.textContent = value;
      else span.append(document.createTextNode(value.slice(0, index)), element('mark', '', value.slice(index, index + this.query.length)), document.createTextNode(value.slice(index + this.query.length)));
      parent.append(span);
    }

    branch(value, key, path, autoOpen = false) {
      if (!object(value)) {
        const row = element('div', 'ji-leaf'); row.title = path;
        this.text(row, `${key}: `, 'ji-key'); this.text(row, primitive(value), `ji-value ji-${type(value)}`);
        return row;
      }
      const entries = Object.entries(value);
      const node = element('details', 'ji-branch');
      const summary = element('summary', 'ji-row'); summary.title = path;
      this.text(summary, `${key}: `, 'ji-key');
      if (typeof value.event === 'string') this.text(summary, value.event, 'ji-event');
      this.text(summary, Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`, 'ji-type');
      const preview = entries.filter(([name]) => name !== 'event').slice(0, 3).map(([name, item]) => `${name}: ${brief(item)}`).join(', ');
      this.text(summary, preview.slice(0, 200) + (preview.length > 200 || entries.length > 3 ? ' ...' : ''), 'ji-preview');
      const children = element('div', 'ji-children');
      node.append(summary, children);
      node.populate = () => {
        if (node.loaded) return;
        node.loaded = true;
        this.appendBatch(children, entries, (item, name) => this.branch(item, Array.isArray(value) ? `[${name}]` : name, `${path}[${JSON.stringify(name)}]`));
        if (!entries.length) children.append(element('div', 'ji-empty', Array.isArray(value) ? 'Empty array []' : 'Empty object {}'));
      };
      summary.addEventListener('click', () => { if (!node.open) node.populate(); });
      summary.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight') { event.preventDefault(); node.populate(); node.open = true; }
        if (event.key === 'ArrowLeft') { event.preventDefault(); node.open = false; }
      });
      node.addEventListener('toggle', () => { if (node.open) node.populate(); });
      if (autoOpen) { node.populate(); node.open = true; }
      return node;
    }

    appendBatch(host, entries, render) {
      let offset = 0;
      const more = this.button('', () => { more.remove(); append(); });
      more.className = 'ji-more';
      const append = () => {
        entries.slice(offset, offset + 100).forEach(([key, value]) => host.append(render(value, key)));
        offset += 100;
        if (offset < entries.length) { more.textContent = `Show next ${Math.min(100, entries.length - offset)} (${entries.length - offset} remaining)`; host.append(more); }
      };
      append();
    }

    refresh() {
      const value = this.value();
      this.snapshotButtons?.forEach((button, i) => button.setAttribute('aria-pressed', String(i === this.active)));
      this.treeButton.setAttribute('aria-pressed', String(this.mode === 'tree'));
      this.rawButton.setAttribute('aria-pressed', String(this.mode === 'raw'));
      this.expand.disabled = this.collapse.disabled = this.mode !== 'tree';
      this.search.disabled = this.mode === 'raw';
      this.tree.replaceChildren(); this.tree.scrollTop = 0; this.status.textContent = '';
      const entries = object(value) ? Object.entries(value) : [['value', value]];
      const filtered = entries.filter(([key, item]) => this.matches(item, key));
      this.count.textContent = `${this.snapshots[this.active].label} / ${entries.length} ${Array.isArray(value) ? 'entries' : 'properties'}${this.query && this.mode === 'tree' ? ` / ${filtered.length} matching` : ''}`;
      if (this.mode === 'raw') {
        this.tree.append(element('pre', 'ji-raw', JSON.stringify(value, null, 2))); return;
      }
      if (!entries.length) { this.tree.append(element('div', 'ji-empty', 'No entries in this snapshot.')); return; }
      if (!filtered.length) { this.tree.append(element('div', 'ji-empty', 'No matching keys or values.')); return; }
      this.appendBatch(this.tree, filtered, (item, key) => this.branch(item, Array.isArray(value) ? `[${key}]` : key, `${this.config.label || 'JSON'}[${JSON.stringify(key)}]`, key === filtered[0][0]));
    }
  }
  customElements.define('json-inspector', JsonInspector);
  window.FreeAuditJson = {
    render(value, options = {}) { return `<json-inspector data-config="${escape(JSON.stringify({ value, ...options }))}"></json-inspector>`; },
    dataLayer(value) {
      if (Array.isArray(value) || value == null) return this.render(value ?? [], { label: 'dataLayer' });
      const snapshots = [['after', 'After'], ['before', 'Before'], ['added', 'Added']]
        .filter(([key]) => Object.prototype.hasOwnProperty.call(value, key))
        .map(([key, label]) => ({ label, value: value[key] }));
      return this.render(value, { label: 'dataLayer', ...(snapshots.length ? { snapshots } : {}) });
    }
  };
})();
