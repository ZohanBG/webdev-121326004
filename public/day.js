// The day view: every workstation with its six blocks, and Book on the free ones.
// All rules live on the server; this page only shows what /api/slots says and sends what the user pressed.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, isoDate, longDate } from './format.js';

const dateInput = document.querySelector('#date');
const heading = document.querySelector('#day-heading');
const notice = document.querySelector('#day-notice');
const status = document.querySelector('#day-status');
const errorBox = document.querySelector('#day-error');
const errorText = document.querySelector('#day-error-text');
const content = document.querySelector('#day-content');

const STATE_LABEL = { free: 'Free', taken: 'Taken', yours: 'Yours', past: 'Past' };
const FEATURE_LABEL = { quiet: 'Quiet', 'dual-monitor': 'Dual monitor', gpu: 'GPU' };
let user = null;

const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
function weekdayFrom(date, step) {
  const d = new Date(`${date}T12:00:00`);
  do d.setDate(d.getDate() + step); while (isWeekend(d));
  return isoDate(d);
}
function firstOpenDay() {
  const d = new Date();
  while (isWeekend(d)) d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function showNotice(text, kind) {
  notice.className = `message ${kind}`;
  notice.replaceChildren(el('span', '', text));
  if (kind === 'success') {
    const link = el('a', '', 'See my bookings');
    link.href = '/my-bookings';
    notice.append(' ', link);
  }
  notice.hidden = false;
}

function renderBlock(ws, block) {
  const item = el('li', `block block-${block.state}`);
  item.append(el('span', 'block-time', `${block.start}–${block.end}`));
  if (block.state === 'free' && user?.role !== 'staff') {
    const button = el('button', '', 'Book');
    button.type = 'button';
    button.setAttribute('aria-label', `Book ${ws.label}, ${block.start}–${block.end}`);
    button.addEventListener('click', () => book(ws, block, button));
    item.append(button);
  } else {
    item.append(el('span', 'block-state', STATE_LABEL[block.state]));
  }
  return item;
}

function renderWorkstation(ws) {
  const item = el('li', 'workstation');
  const head = el('div', 'workstation-head');
  head.append(el('h3', 'workstation-label', ws.label));
  const features = el('ul', 'chips');
  features.setAttribute('aria-label', 'Features');
  for (const f of ws.features) features.append(el('li', 'chip', FEATURE_LABEL[f] ?? f));
  if (ws.features.length) head.append(features);
  const blocks = el('ol', 'blocks');
  blocks.setAttribute('aria-label', `${ws.label} blocks`);
  blocks.append(...ws.blocks.map((b) => renderBlock(ws, b)));
  item.append(head, blocks);
  return item;
}

function renderLab(lab) {
  const section = el('section', 'lab-day');
  section.append(el('h2', '', `${lab.name} · Room ${lab.room}`));
  const list = el('ul', 'workstations');
  list.append(...lab.workstations.map(renderWorkstation));
  section.append(list);
  return section;
}

async function load() {
  const date = dateInput.value;
  heading.textContent = date ? longDate(date) : '';
  status.textContent = 'Loading the day…';
  status.hidden = false;
  errorBox.hidden = true;
  content.hidden = true;

  const result = await api(`/api/slots?date=${encodeURIComponent(date)}`);
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
  if (result.data.labs.length === 0) {
    status.textContent = 'No workstations are open for booking yet. Ask the lab staff to add one.';
    return;
  }
  content.replaceChildren(...result.data.labs.map(renderLab));
  status.hidden = true;
  content.hidden = false;
}

async function book(ws, block, button) {
  button.disabled = true;
  button.textContent = 'Booking…';
  const result = await api('/api/bookings', {
    method: 'POST',
    body: { workstationId: ws.id, date: dateInput.value, block: block.block },
  });
  if (result.ok) showNotice(`Booked ${ws.label} on ${longDate(dateInput.value)}, ${block.start}–${block.end}.`, 'success');
  else showNotice(result.error, 'error');
  await load();
}

function go(date) {
  dateInput.value = date;
  history.replaceState(null, '', `/day?date=${date}`);
  notice.hidden = true;
  load();
}

document.querySelector('#prev-day').addEventListener('click', () => go(weekdayFrom(dateInput.value || firstOpenDay(), -1)));
document.querySelector('#next-day').addEventListener('click', () => go(weekdayFrom(dateInput.value || firstOpenDay(), 1)));
dateInput.addEventListener('change', () => go(dateInput.value));
document.querySelector('#day-picker').addEventListener('submit', (e) => e.preventDefault());
document.querySelector('#day-retry').addEventListener('click', load);

user = await renderNav();
dateInput.value = new URLSearchParams(location.search).get('date') || firstOpenDay();
load();
