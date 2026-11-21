// Staff: every booking on a day, by lab, with who made it, and Cancel.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, groupBy, isoDate, longDate, readableDate, weekdayFrom } from './format.js';
import { showLoading, doneLoading, showEmpty, showMessage } from './ui.js';

const dateInput = document.querySelector('#all-date');
const heading = document.querySelector('#all-heading');
const notice = document.querySelector('#all-notice');
const status = document.querySelector('#all-status');
const errorBox = document.querySelector('#all-error');
const errorText = document.querySelector('#all-error-text');
const region = document.querySelector('#all-region');
const list = document.querySelector('#all');

function renderBooking(b) {
  const item = el('li', 'booking');
  const text = el('div', 'booking-text');
  text.append(el('p', 'booking-when', `${b.start}–${b.end} · ${b.workstation}`), el('p', 'muted', b.email));
  const button = el('button', 'danger', 'Cancel');
  button.type = 'button';
  button.setAttribute('aria-label', `Cancel the booking of ${b.email} on ${b.workstation}, ${b.start}–${b.end}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Cancelling…';
    const result = await api(`/api/bookings/${b.id}`, { method: 'DELETE' });
    if (result.ok) showMessage(notice, 'success', `Cancelled ${b.workstation} on ${readableDate(b.date)}, ${b.start}–${b.end} for ${b.email}.`);
    else showMessage(notice, 'error', result.error);
    await load();
  });
  item.append(text, button);
  return item;
}

function renderLab([lab, bookings], index) {
  const section = el('section', 'day-group');
  const title = el('h2', 'group-title', lab);
  title.id = `lab-group-${index}`;
  section.setAttribute('aria-labelledby', title.id);
  const items = el('ul', 'booking-list');
  items.append(...bookings.map(renderBooking));
  section.append(title, items);
  return section;
}

async function load() {
  heading.textContent = dateInput.value ? longDate(dateInput.value) : '';
  showLoading(region, status, 'Loading bookings…');
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api(`/api/admin/bookings?date=${encodeURIComponent(dateInput.value)}`);
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
    showEmpty(status, 'No bookings on this day. Pick another date.');
    return;
  }
  list.replaceChildren(...[...groupBy(result.data, (b) => b.lab)].map(renderLab));
  status.hidden = true;
  list.hidden = false;
}

function go(date) {
  dateInput.value = date;
  history.replaceState(null, '', `/staff/bookings?date=${date}`);
  notice.hidden = true;
  load();
}

dateInput.addEventListener('change', () => go(dateInput.value));
document.querySelector('#all-prev').addEventListener('click', () => go(weekdayFrom(dateInput.value || isoDate(new Date()), -1)));
document.querySelector('#all-next').addEventListener('click', () => go(weekdayFrom(dateInput.value || isoDate(new Date()), 1)));
document.querySelector('#all-picker').addEventListener('submit', (e) => e.preventDefault());
document.querySelector('#all-retry').addEventListener('click', load);

await renderNav();
dateInput.value = new URLSearchParams(location.search).get('date') || isoDate(new Date());
load();
