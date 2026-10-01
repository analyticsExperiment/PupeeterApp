document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('registerForm');
  const errorEl = document.getElementById('registerError');
  const displayNameEl = document.getElementById('displayName');
  const usernameEl = document.getElementById('username');
  const passwordEl = document.getElementById('password');
  const confirmPasswordEl = document.getElementById('confirmPassword');
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

  if (!form || !usernameEl || !passwordEl || !confirmPasswordEl) {
    showError('Failed to initialize registration form. Please refresh.');
    return;
  }

  await session.ensureCsrfToken().catch(() => null);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();

    const username = usernameEl.value.trim();
    const password = passwordEl.value;
    const confirmPassword = confirmPasswordEl.value;
    const displayName = (displayNameEl?.value || '').trim();

    if (!username || !password || !confirmPassword) {
      showError('Username, password, and confirm password are required.');
      return;
    }

    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
      showError('Username must be 3-32 chars and use letters, numbers, ., _, or -.');
      return;
    }

    if (password.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      showError('Password and confirm password must match.');
      return;
    }

    const payload = {
      username,
      password,
      displayName
    };

    try {
      const token = session.getCsrfToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['X-CSRF-Token'] = token;

      const resp = await fetch('/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload)
      });

      if (resp.status === 409) {
        throw new Error('Username already exists.');
      }

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Unable to create account.');
      }

      session.clearCsrfToken();
      window.location.replace('/');
    } catch (err) {
      console.error('Registration failed', err);
      showError(err.message || 'Registration failed. Try again.');
    }
  });
});

