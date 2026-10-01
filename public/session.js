(function () {
  const state = {
    csrfToken: null,
    csrfSupported: true
  };

  const PUBLIC_PATHS = new Set([
    '/login',
    '/login.html',
    '/register',
    '/register.html',
    '/signup',
    '/signup.html'
  ]);

  function isPublicPath(pathname) {
    return PUBLIC_PATHS.has(pathname);
  }

  async function ensureCsrfToken(force = false) {
    if (!state.csrfSupported) return null;
    if (state.csrfToken && !force) return state.csrfToken;
    try {
      const resp = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
      if (!resp.ok) throw new Error('Failed to fetch CSRF token');
      const data = await resp.json();
      state.csrfToken = data.csrfToken;
      return state.csrfToken;
    } catch (_err) {
      state.csrfSupported = false;
      state.csrfToken = null;
      return null;
    }
  }

  function getCsrfToken() {
    return state.csrfToken;
  }

  function clearCsrfToken() {
    state.csrfToken = null;
  }

  function redirectToLogin() {
    window.location.replace('/login');
  }

  async function logout() {
    try {
      const token = await ensureCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-CSRF-Token'] = token;
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers
      });
    } catch (err) {
      console.error('Failed to logout', err);
    } finally {
      clearCsrfToken();
      redirectToLogin();
    }
  }

  function bindLogoutButtons(root = document) {
    root.querySelectorAll('[data-action="logout"]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        await logout();
      });
    });
  }

  async function enforceSession() {
    if (isPublicPath(window.location.pathname)) return;
    try {
      const resp = await fetch('/auth/me', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (resp.status === 401) {
        redirectToLogin();
      }
    } catch (_err) {
      redirectToLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindLogoutButtons();
    enforceSession();
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      enforceSession();
    }
  });

  window.__session = {
    ensureCsrfToken,
    getCsrfToken,
    clearCsrfToken,
    bindLogoutButtons,
    enforceSession,
    logout
  };
})();

