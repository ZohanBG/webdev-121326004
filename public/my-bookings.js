// My upcoming bookings, grouped by day, each with Cancel.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, groupBy, longDate, readableDate } from './format.js';
import { showLoading, doneLoading, showEmpty, showMessage } from './ui.js';

const notice = document.querySelector('#mine-notice');
const status = document.querySelector('#mine-status');
const errorBox = document.querySelector('#mine-error');
const errorText = document.querySelector('#mine-error-text');
const region = document.querySelector('#mine-region');
const list = document.querySelector('#mine');

function showNoBookings() {
  const link = el('a', 'button', 'Pick a free slot');
  link.href = '/day';
  showEmpty(status, el('p', '', 'You have no upcoming bookings.'), link);
}

function renderBooking(b) {
  const item = el('li', 'booking');
  const text = el('div', 'booking-text');
  text.append(el('p', 'booking-when', `${b.start}–${b.end}`), el('p', 'muted', `${b.workstation}, ${b.lab}`));
  if (b.cancelledByStaff) {
    item.classList.add('booking-cancelled');
    item.append(text, el('span', 'badge badge-neutral', 'Cancelled by lab staff'));
    return item;
  }
  const button = el('button', 'danger', 'Cancel');
  button.type = 'button';
  button.setAttribute('aria-label', `Cancel ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end}`);
  button.addEventListener('click', () => cancel(b, button));
  item.append(text, button);
  return item;
}

function renderDay([date, bookings]) {
  const section = el('section', 'day-group');
  const title = el('h2', 'group-title', longDate(date));
  title.id = `day-${date}`;
  section.setAttribute('aria-labelledby', title.id);
  const items = el('ul', 'booking-list');
  items.append(...bookings.map(renderBooking));
  section.append(title, items);
  return section;
}

async function load() {
  showLoading(region, status, 'Loading your bookings…');
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api('/api/bookings');
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
  if (result.data.length === 0) {
    showNoBookings();
    return;
  }
  list.replaceChildren(...[...groupBy(result.data, (b) => b.date)].map(renderDay));
  status.hidden = true;
  list.hidden = false;
}

async function cancel(b, button) {
  button.disabled = true;
  button.textContent = 'Cancelling…';
  const result = await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
  if (result.ok) showMessage(notice, 'success', `Cancelled ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end}.`);
  else showMessage(notice, 'error', result.error);
  await load();
}

document.querySelector('#mine-retry').addEventListener('click', load);
await renderNav();
load();
