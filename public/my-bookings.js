// My upcoming bookings, each with Cancel.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, readableDate } from './format.js';

const notice = document.querySelector('#mine-notice');
const status = document.querySelector('#mine-status');
const errorBox = document.querySelector('#mine-error');
const errorText = document.querySelector('#mine-error-text');
const list = document.querySelector('#mine');

function showNotice(text, kind) {
  notice.className = `message ${kind}`;
  notice.textContent = text;
  notice.hidden = false;
}

function showEmpty() {
  status.replaceChildren('You have no upcoming bookings. ');
  const link = el('a', '', 'Pick a free slot in the day view.');
  link.href = '/day';
  status.append(link);
  status.hidden = false;
}

function renderBooking(b) {
  const item = el('li', 'booking');
  const text = el('div', 'booking-text');
  text.append(el('p', 'booking-when', `${readableDate(b.date)} · ${b.start}–${b.end}`), el('p', 'muted', `${b.workstation}, ${b.lab}`));
  if (b.cancelledByStaff) {
    item.classList.add('booking-cancelled');
    item.append(text, el('span', 'badge badge-off', 'Cancelled by lab staff'));
    return item;
  }
  const button = el('button', 'secondary', 'Cancel');
  button.type = 'button';
  button.setAttribute('aria-label', `Cancel ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end}`);
  button.addEventListener('click', () => cancel(b, button));
  item.append(text, button);
  return item;
}

async function load() {
  status.textContent = 'Loading your bookings…';
  status.hidden = false;
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api('/api/bookings');
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
  if (result.data.length === 0) {
    showEmpty();
    return;
  }
  list.replaceChildren(...result.data.map(renderBooking));
  status.hidden = true;
  list.hidden = false;
}

async function cancel(b, button) {
  button.disabled = true;
  button.textContent = 'Cancelling…';
  const result = await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
  if (result.ok) showNotice(`Cancelled ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end}.`, 'success');
  else showNotice(result.error, 'error');
  await load();
}

document.querySelector('#mine-retry').addEventListener('click', load);
await renderNav();
load();
