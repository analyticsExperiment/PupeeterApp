(function () {
  async function getCsrfHeaders(headers = {}) {
    const out = { ...headers };
    if (window.__session && typeof window.__session.ensureCsrfToken === 'function') {
      const token = await window.__session.ensureCsrfToken();
      if (token) out['X-CSRF-Token'] = token;
    }
    return out;
  }

  async function apiFetch(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = { ...(options.headers || {}) };
    const init = {
      credentials: 'same-origin',
      cache: method === 'GET' ? 'no-store' : 'no-cache',
      ...options,
      headers
    };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      init.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      init.headers = await getCsrfHeaders(headers);
    }

    const resp = await fetch(url, init);
    if (resp.status === 401) {
      window.location.replace('/login');
      throw new Error('Unauthorized');
    }
    return resp;
  }

  async function apiJson(url, options = {}) {
    const resp = await apiFetch(url, options);
    let data = null;
    try {
      data = await resp.json();
    } catch (_) {
      data = null;
    }
    if (!resp.ok) {
      const err = new Error((data && data.error) || `Request failed (${resp.status})`);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateTime(ts) {
    if (!ts) return '-';
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
  }

  function formatDuration(start, end) {
    if (!start || !end) return '-';
    const diff = Number(end) - Number(start);
    if (!Number.isFinite(diff) || diff < 0) return '-';
    const seconds = Math.floor(diff / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins >= 60) {
      const hours = Math.floor(mins / 60);
      return `${hours}h ${mins % 60}m ${secs}s`;
    }
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  window.FreeAuditApi = {
    apiFetch,
    apiJson,
    escapeHtml,
    formatDateTime,
    formatDuration
  };
})();
