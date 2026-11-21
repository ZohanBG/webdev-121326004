// Ways to sign in, and setting a password (after a Google link cleared it, no current password is needed).
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el } from './format.js';
import { showLoading, doneLoading, showMessage } from './ui.js';

const status = document.querySelector('#account-status');
const errorBox = document.querySelector('#account-error');
const errorText = document.querySelector('#account-error-text');
const region = document.querySelector('#account-region');
const content = document.querySelector('#account');
const form = document.querySelector('#password-form');
const notice = document.querySelector('#password-notice');
const button = form.querySelector('button[type="submit"]');

const ROLE = { student: 'Student', staff: 'Lab staff' };

function method(name, on) {
  const item = el('li');
  item.append(el('span', '', name), el('span', on ? 'badge' : 'badge badge-neutral', on ? 'On' : 'Off'));
  return item;
}

async function load() {
  showLoading(region, status, 'Loading your account…');
  errorBox.hidden = true;
  content.hidden = true;

  const result = await api('/api/account');
  if (result.status === 401) {
    location.assign('/login');
    return;
  }
  doneLoading(region);
  if (!result.ok) {
    status.hidden = true;
    errorText.textContent = result.error;
    errorBox.hidden = false;
    return;
  }
  const account = result.data;
  const google = account.providers.includes('google');
  document.querySelector('#account-email').textContent = account.email;
  document.querySelector('#account-role').textContent = ROLE[account.role] ?? account.role;
  document.querySelector('#methods').replaceChildren(
    method('Email and password', account.hasPassword),
    method('Google', google),
  );
  document.querySelector('#google-hint').hidden = google;
  document.querySelector('#password-title').textContent = account.hasPassword ? 'Change your password' : 'Set a password';
  document.querySelector('#current-wrap').hidden = !account.hasPassword;
  status.hidden = true;
  content.hidden = false;
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
  showMessage(notice, result.ok ? 'success' : 'error',
    result.ok ? 'Saved. You can now sign in with your email and this password.' : result.error);
  if (result.ok) {
    form.reset();
    await load();
  }
});

document.querySelector('#account-retry').addEventListener('click', load);
await renderNav();
load();
