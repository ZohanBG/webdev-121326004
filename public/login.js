import { api } from './api.js';

const form = document.querySelector('#login-form');
const errorBox = document.querySelector('#login-error');
const button = form.querySelector('button[type="submit"]');

// a refusal from Sign in with Google comes back as ?error=<a sentence to show>
const sent = new URLSearchParams(location.search).get('error');
if (sent) {
  errorBox.textContent = sent;
  errorBox.hidden = false;
  history.replaceState(null, '', '/login');
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  button.disabled = true;
  button.textContent = 'Signing in…';

  const result = await api('/api/auth/login', {
    method: 'POST',
    body: { email: form.email.value, password: form.password.value },
  });
  if (result.ok) {
    location.assign('/labs');
    return;
  }

  errorBox.textContent = result.error;
  errorBox.hidden = false;
  button.disabled = false;
  button.textContent = 'Sign in';
  form.password.value = '';
  form.password.focus();
});
