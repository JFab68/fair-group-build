(function() {
  'use strict';

  let csrfToken = '';

  async function fetchCsrfToken() {
    const res = await fetch('/api/csrf-token');
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  function showError(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  function hideError(containerId) {
    const el = document.getElementById(containerId);
    if (el) {
      el.classList.add('hidden');
    }
  }

  function showSuccess(containerId, message) {
    const el = document.getElementById(containerId);
    if (el) {
      el.textContent = message;
      el.classList.remove('hidden');
    }
  }

  // --- Login ---
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    fetchCsrfToken();
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('login-error');

      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (res.ok) {
          window.location.href = '/dashboard.html';
        } else {
          showError('login-error', data.error);
        }
      } catch {
        showError('login-error', 'Connection error. Please try again.');
      }
    });
  }

  // --- Signup ---
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    fetchCsrfToken();

    let currentStep = 1;
    const totalSteps = 3;

    function showStep(step) {
      for (let i = 1; i <= totalSteps; i++) {
        const stepEl = document.getElementById(`step-${i}`);
        const indicatorEl = document.getElementById(`indicator-${i}`);
        if (stepEl) stepEl.classList.toggle('hidden', i !== step);
        if (indicatorEl) {
          indicatorEl.classList.toggle('bg-navy', i <= step);
          indicatorEl.classList.toggle('text-white', i <= step);
          indicatorEl.classList.toggle('bg-gray-200', i > step);
        }
      }
      currentStep = step;
    }

    document.querySelectorAll('[data-next-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nextStep = parseInt(btn.dataset.nextStep, 10);
        if (currentStep === 1) {
          const fn = document.getElementById('firstName').value;
          const ln = document.getElementById('lastName').value;
          const em = document.getElementById('email').value;
          const pw = document.getElementById('password').value;
          const cpw = document.getElementById('confirmPassword').value;
          if (!fn || !ln || !em || !pw) {
            showError('signup-error', 'Please fill in all required fields.');
            return;
          }
          if (pw.length < 8) {
            showError('signup-error', 'Password must be at least 8 characters.');
            return;
          }
          if (pw !== cpw) {
            showError('signup-error', 'Passwords do not match.');
            return;
          }
          hideError('signup-error');
        }
        showStep(nextStep);
      });
    });

    document.querySelectorAll('[data-prev-step]').forEach(btn => {
      btn.addEventListener('click', () => {
        showStep(parseInt(btn.dataset.prevStep, 10));
      });
    });

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('signup-error');

      const interestAreas = Array.from(document.querySelectorAll('input[name="interestAreas"]:checked'))
        .map(cb => cb.value).join(', ');

      const body = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value,
        phone: document.getElementById('phone').value,
        city: document.getElementById('city').value,
        county: document.getElementById('county').value,
        interestAreas,
        statement: document.getElementById('statement').value,
      };

      try {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (res.ok) {
          document.getElementById('signup-form').classList.add('hidden');
          showSuccess('signup-success', data.message);
        } else {
          showError('signup-error', data.error || data.errors?.[0]?.msg || 'Registration failed.');
        }
      } catch {
        showError('signup-error', 'Connection error. Please try again.');
      }
    });

    showStep(1);
  }

  function setupPasswordToggle(buttonId, inputId) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    const input = document.getElementById(inputId);
    if (!input) return;
    button.addEventListener('click', () => {
      const isPassword = input.getAttribute('type') === 'password';
      input.setAttribute('type', isPassword ? 'text' : 'password');
      button.textContent = isPassword ? 'Hide' : 'Show';
      button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });
  }

  setupPasswordToggle('toggle-password', 'password');
  setupPasswordToggle('toggle-confirm-password', 'confirmPassword');

  const statement = document.getElementById('statement');
  const statementCount = document.getElementById('statement-count');
  if (statement && statementCount) {
    const updateStatementCount = () => {
      const len = statement.value.trim().length;
      statementCount.textContent = `${len} / 2,000`;
    };
    updateStatementCount();
    statement.addEventListener('input', updateStatementCount);
  }
  // --- Password Reset ---
  const resetRequestForm = document.getElementById('reset-request-form');
  if (resetRequestForm) {
    fetchCsrfToken();
    resetRequestForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('reset-error');

      const email = document.getElementById('email').value;
      try {
        const res = await fetch('/api/password-reset/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (res.ok) {
          showSuccess('reset-success', data.message);
          resetRequestForm.classList.add('hidden');
        } else {
          showError('reset-error', data.error);
        }
      } catch {
        showError('reset-error', 'Connection error. Please try again.');
      }
    });
  }

  const resetConfirmForm = document.getElementById('reset-confirm-form');
  if (resetConfirmForm) {
    fetchCsrfToken();
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
      document.getElementById('reset-request-section')?.classList.add('hidden');
      document.getElementById('reset-confirm-section')?.classList.remove('hidden');
    }

    resetConfirmForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError('reset-error');

      const password = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmNewPassword').value;

      if (password !== confirmPassword) {
        showError('reset-error', 'Passwords do not match.');
        return;
      }

      try {
        const res = await fetch('/api/password-reset/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (res.ok) {
          showSuccess('reset-success', data.message);
          resetConfirmForm.classList.add('hidden');
        } else {
          showError('reset-error', data.error);
        }
      } catch {
        showError('reset-error', 'Connection error. Please try again.');
      }
    });
  }
})();
