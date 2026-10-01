(function () {
  const NAV_ITEMS = [
    { href: '/dashboard.html', label: 'Dashboard', match: ['/dashboard.html'] },
    { href: '/', label: 'Create Audit', match: ['/', '/index.html', '/create-audit.html'] },
    { href: '/audits.html', label: 'Audit History', match: ['/audits.html'] },
    { href: '/audit-configs.html', label: 'Audit Configs', match: ['/audit-configs.html'] },
    { href: '/action-templates.html?type=pre', label: 'Pre-Audit Actions', match: ['/action-templates.html'], query: 'pre' },
    { href: '/action-templates.html?type=post', label: 'On Page Actions', match: ['/action-templates.html'], query: 'post' },
    { href: '/rule-sets.html', label: 'Rules', match: ['/rule-sets.html'] },
    { href: '/interaction-configs.html', label: 'Interaction Configs', match: ['/interaction-configs.html'] },
    { href: '/interaction-flow-templates.html', label: 'Interaction Flow Templates', match: ['/interaction-flow-templates.html'] },
    { href: '/interaction-runs.html', label: 'Interaction Runs', match: ['/interaction-runs.html', '/interaction-report.html'] },
    { href: '/settings.html', label: 'Settings', match: ['/settings.html'] }
  ];

  function isActive(item) {
    const path = window.location.pathname;
    if (['/', '/index.html'].includes(path) && new URLSearchParams(window.location.search).has('auditId')) return item.href === '/audits.html';
    if (!item.match.includes(path)) return false;
    if (!item.query) return true;
    return new URLSearchParams(window.location.search).get('type') === item.query;
  }

  function initials(user) {
    const text = String(user?.displayName || user?.username || 'User').trim();
    return text.split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'U';
  }

  async function loadUser() {
    try {
      const resp = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.user || null;
    } catch (_) {
      return null;
    }
  }

  function renderSidebar(user) {
    const nav = NAV_ITEMS.map((item) => {
      const active = isActive(item) ? ' active' : '';
      return `<a class="app-nav-link${active}" ${active ? 'aria-current="page"' : ''} href="${item.href}"><span>${item.label}</span></a>`;
    }).join('');
    return `
      <aside class="app-sidebar">
        <div class="app-brand">
          <div class="app-brand-mark">FA</div>
          <div>
            <div class="app-brand-name">Free Audit</div>
            <div class="app-brand-sub">Audit Console</div>
          </div>
        </div>
        <button class="app-nav-toggle" type="button" aria-label="Toggle navigation" aria-expanded="false" aria-controls="app-navigation">&#9776;</button>
        <nav id="app-navigation" class="app-nav" aria-label="Main navigation">${nav}</nav>
        <div class="app-user-card">
          <div class="app-avatar"></div>
          <div class="app-user-meta">
            <strong>${window.FreeAuditApi ? window.FreeAuditApi.escapeHtml(user?.displayName || user?.username || 'User') : 'User'}</strong>
            <span>${window.FreeAuditApi ? window.FreeAuditApi.escapeHtml(user?.username || '') : ''}</span>
          </div>
          <button class="app-logout" data-action="logout" type="button">Logout</button>
        </div>
      </aside>
    `;
  }

  function applyLayout(user) {
    if (document.body.classList.contains('app-shell-ready')) return;
    const content = document.querySelector('.container');
    if (!content) return;
    document.body.classList.add('app-shell-ready');
    content.classList.add('app-content');

    const shell = document.createElement('div');
    shell.className = 'app-shell';
    const main = document.createElement('main');
    main.className = 'app-main';
    shell.innerHTML = renderSidebar(user);

    content.parentNode.insertBefore(shell, content);
    main.appendChild(content);
    shell.appendChild(main);
    shell.querySelector('.app-avatar').textContent = initials(user);
    const sidebar = shell.querySelector('.app-sidebar');
    const toggle = shell.querySelector('.app-nav-toggle');
    const setExpanded = (expanded) => {
      sidebar.classList.toggle('is-expanded', expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
    };
    toggle.addEventListener('click', () => setExpanded(toggle.getAttribute('aria-expanded') !== 'true'));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('is-expanded')) {
        setExpanded(false);
        toggle.focus();
      }
    });
    document.addEventListener('click', (event) => {
      if (!sidebar.contains(event.target)) setExpanded(false);
    });

    if (window.__session && typeof window.__session.bindLogoutButtons === 'function') {
      window.__session.bindLogoutButtons(shell);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const user = await loadUser();
    applyLayout(user);
  });
})();
