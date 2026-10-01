document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const session = window.__session || {
    ensureCsrfToken: async () => null,
    getCsrfToken: () => null,
    clearCsrfToken: () => undefined
  };

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }

  if (!form || !usernameEl || !passwordEl) {
    showError('Failed to initialize login form. Please refresh.');
    return;
  }

  await session.ensureCsrfToken().catch(() => null);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const payload = {
      username: usernameEl.value.trim(),
      password: passwordEl.value
    };

    if (!payload.username || !payload.password) {
      showError('Username and password are required.');
      return;
    }

    try {
      const token = session.getCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-CSRF-Token'] = token;

      const resp = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload)
      });

      if (resp.status === 401) {
        throw new Error('Invalid username or password.');
      }

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Login failed. Please try again.');
      }

      session.clearCsrfToken();
      window.location.replace('/');
    } catch (err) {
      console.error('Login failed', err);
      showError(err.message || 'Login failed. Try again.');
    }
  });
});

