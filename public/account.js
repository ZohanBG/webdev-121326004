// Ways to sign in, and setting a password (after a Google link cleared it, no current password is needed).
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el } from './format.js';

const status = document.querySelector('#account-status');
const errorBox = document.querySelector('#account-error');
const errorText = document.querySelector('#account-error-text');
const card = document.querySelector('#account');
const form = document.querySelector('#password-form');
const notice = document.querySelector('#password-notice');
const button = form.querySelector('button[type="submit"]');

function method(name, on) {
  const item = el('li');
  item.append(el('span', '', name), el('span', on ? 'badge' : 'badge badge-off', on ? 'On' : 'Off'));
  return item;
}

async function load() {
  status.textContent = 'Loading your account…';
  status.hidden = false;
  errorBox.hidden = true;
  card.hidden = true;

  const result = await api('/api/account');
  if (result.status === 401) {
    location.assign('/login');
    return;
  }
  if (!result.ok) {
    status.hidden = true;
    errorText.textContent = result.error;
    errorBox.hidden = false;
    return;
  }
  const account = result.data;
  document.querySelector('#account-email').textContent = account.email;
  document.querySelector('#methods').replaceChildren(
    method('Email and password', account.hasPassword),
    method('Google', account.providers.includes('google')),
  );
  document.querySelector('#password-title').textContent = account.hasPassword ? 'Change your password' : 'Set a password';
  document.querySelector('#current-wrap').hidden = !account.hasPassword;
  status.hidden = true;
  card.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  button.textContent = 'Saving…';
  const result = await api('/api/account/password', {
    method: 'POST',
    body: { password: form.password.value, currentPassword: form.currentPassword.value || undefined },
  });
  button.disabled = false;
  button.textContent = 'Save password';
  notice.className = `message ${result.ok ? 'success' : 'error'}`;
  notice.textContent = result.ok ? 'Saved. You can now sign in with your email and this password.' : result.error;
  notice.hidden = false;
  if (result.ok) {
    form.reset();
    await load();
  }
});

document.querySelector('#account-retry').addEventListener('click', load);
await renderNav();
load();
