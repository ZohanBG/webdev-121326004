// Staff: every booking on a day, with who made it, and Cancel.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, isoDate, longDate, readableDate } from './format.js';

const dateInput = document.querySelector('#all-date');
const heading = document.querySelector('#all-heading');
const notice = document.querySelector('#all-notice');
const status = document.querySelector('#all-status');
const errorBox = document.querySelector('#all-error');
const errorText = document.querySelector('#all-error-text');
const list = document.querySelector('#all');

function showNotice(text, kind) {
  notice.className = `message ${kind}`;
  notice.textContent = text;
  notice.hidden = false;
}

function renderBooking(b) {
  const item = el('li', 'booking');
  const text = el('div', 'booking-text');
  text.append(el('p', 'booking-when', `${b.start}–${b.end} · ${b.workstation}, ${b.lab}`), el('p', 'muted', b.email));
  const button = el('button', 'secondary', 'Cancel');
  button.type = 'button';
  button.setAttribute('aria-label', `Cancel the booking of ${b.email} on ${b.workstation}, ${b.start}–${b.end}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Cancelling…';
    const result = await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
    if (result.ok) showNotice(`Cancelled ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end} for ${b.email}.`, 'success');
    else showNotice(result.error, 'error');
    await load();
  });
  item.append(text, button);
  return item;
}

async function load() {
  heading.textContent = dateInput.value ? longDate(dateInput.value) : '';
  status.textContent = 'Loading bookings…';
  status.hidden = false;
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api(`/api/admin/bookings?date=${encodeURIComponent(dateInput.value)}`);
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
    status.textContent = 'No bookings on this day. Pick another date.';
    return;
  }
  list.replaceChildren(...result.data.map(renderBooking));
  status.hidden = true;
  list.hidden = false;
}

dateInput.addEventListener('change', () => {
  history.replaceState(null, '', `/staff/bookings?date=${dateInput.value}`);
  notice.hidden = true;
  load();
});
document.querySelector('#all-picker').addEventListener('submit', (e) => e.preventDefault());
document.querySelector('#all-retry').addEventListener('click', load);

await renderNav();
dateInput.value = new URLSearchParams(location.search).get('date') || isoDate(new Date());
load();
