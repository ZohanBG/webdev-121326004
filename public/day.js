// The day view: every workstation with its six blocks, and Book on the free ones.
// All rules live on the server; this page only shows what /api/slots says and sends what the user pressed.
// The date and the feature filter live in the URL, so a reload or Back shows the same view.
// One markup for every width: styles.css lays a lab out as a grid (a row per workstation, a column per
// block) on a wide screen and as a card per workstation on a narrow one.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el, firstOpenDay, longDate, weekdayFrom } from './format.js';
import { loadFeatures, labelOf, featureTags, chipGroups } from './features-ui.js';
import { symbol, showLoading, doneLoading, showEmpty, showMessage } from './ui.js';

const dateInput = document.querySelector('#date');
const heading = document.querySelector('#day-heading');
const notice = document.querySelector('#day-notice');
const status = document.querySelector('#day-status');
const errorBox = document.querySelector('#day-error');
const errorText = document.querySelector('#day-error-text');
const region = document.querySelector('#day-region');
const content = document.querySelector('#day-content');
const filterBox = document.querySelector('#filter-chips');
const filterStatus = document.querySelector('#filter-status');
const clearButton = document.querySelector('#filter-clear');
const suggestForm = document.querySelector('#suggest');
const suggestButton = document.querySelector('#suggest-button');
const suggestResult = document.querySelector('#suggest-result');

// every state is a symbol and a word, never colour alone; screen readers get the word only
const STATE = { free: ['○', 'Free'], taken: ['●', 'Taken'], yours: ['★', 'Yours'], past: ['–', 'Past'] };
let user = null;
let chosen = new Set();
// "See free slots" on the labs page links to /day#lab-<id>; the lab is scrolled to once it is drawn
let jumpTo = location.hash.slice(1);

/** The view as a URL: /day?date=…&features=a,b */
function urlFor(date, features) {
  const params = new URLSearchParams({ date });
  if (features.size) params.set('features', [...features].join(','));
  return `/day?${params}`;
}

/** Reads the date and the filter from the URL (on start, and when Back or Forward changes it). */
function readUrl() {
  const params = new URLSearchParams(location.search);
  dateInput.value = params.get('date') || firstOpenDay();
  chosen = new Set((params.get('features') ?? '').split(',').filter(Boolean));
}

function showNotice(text, kind) {
  if (kind !== 'success') {
    showMessage(notice, kind, text);
    return;
  }
  const link = el('a', '', 'See my bookings');
  link.href = '/my-bookings';
  showMessage(notice, kind, text, ' ', link);
}

function stateLabel(state) {
  const [char, word] = STATE[state];
  const label = el('span', 'block-state');
  label.append(symbol(char), word);
  return label;
}

function renderBlock(ws, block) {
  const item = el('li', `block block-${block.state}`);
  item.append(el('span', 'block-time', `${block.start}–${block.end}`), stateLabel(block.state));
  if (block.state === 'free' && user?.role !== 'staff') {
    const button = el('button', 'block-book', 'Book');
    button.type = 'button';
    button.setAttribute('aria-label', `Book ${ws.label}, ${block.start}–${block.end}`);
    button.addEventListener('click', () => book(ws, block, button));
    item.append(button);
  }
  return item;
}

function renderWorkstation(ws) {
  const item = el('li', 'workstation');
  const head = el('div', 'workstation-head');
  head.append(el('h3', 'workstation-label', ws.label));
  if (ws.features.length) head.append(featureTags(ws.features, `${ws.label} features`));
  const blocks = el('ol', 'blocks');
  blocks.setAttribute('aria-label', `${ws.label} blocks`);
  blocks.append(...ws.blocks.map((b) => renderBlock(ws, b)));
  item.append(head, blocks);
  return item;
}

/** The times above the grid's columns. Every block also carries its own time, so this row is for the eye only. */
function timeHeader(blocks) {
  const row = el('div', 'grid-head');
  row.setAttribute('aria-hidden', 'true');
  const times = el('div', 'grid-times');
  times.append(...blocks.map((b) => el('span', '', `${b.start}–${b.end}`)));
  row.append(el('span', 'grid-corner', 'Workstation'), times);
  return row;
}

function renderLab(lab) {
  const section = el('section', 'card lab-day');
  section.id = `lab-${lab.id}`;
  const title = el('h2', '', `${lab.name} · Room ${lab.room}`);
  title.id = `lab-${lab.id}-title`;
  section.setAttribute('aria-labelledby', title.id);
  const list = el('ul', 'workstations');
  list.append(...lab.workstations.map(renderWorkstation));
  section.append(title, timeHeader(lab.workstations[0].blocks), list);
  return section;
}

/** What the symbols mean. A screen reader already hears the word on every block, so this line is for the eye. */
function legend() {
  const line = el('p', 'legend');
  line.setAttribute('aria-hidden', 'true');
  for (const state of ['free', 'taken', 'yours', 'past']) {
    const [char, word] = STATE[state];
    const item = el('span', `legend-item block-${state}`);
    item.append(el('span', 'symbol', char), word);
    line.append(item);
  }
  return line;
}

/** Empty because of the filter: say so, and offer the way out. */
function showFilteredEmpty() {
  const clear = el('button', 'secondary', 'Clear filters');
  clear.type = 'button';
  clear.addEventListener('click', clearFilters);
  showEmpty(status, el('p', '', 'No workstation has all of these features on this day.'), clear);
}

function describeFilter(count) {
  if (!chosen.size) return '';
  const names = [...chosen].map(labelOf).join(', ');
  return `${count} workstation${count === 1 ? '' : 's'} with ${names}.`;
}

async function load() {
  const date = dateInput.value;
  heading.textContent = date ? longDate(date) : '';
  showLoading(region, status, 'Loading the day…');
  errorBox.hidden = true;
  content.hidden = true;
  clearButton.hidden = chosen.size === 0;

  const params = new URLSearchParams({ date });
  if (chosen.size) params.set('features', [...chosen].join(','));
  const result = await api(`/api/slots?${params}`);
  if (result.status === 401) {
    location.assign('/login');
    return;
  }
  doneLoading(region);
  if (!result.ok) {
    status.hidden = true;
    filterStatus.textContent = '';
    errorText.textContent = result.error;
    errorBox.hidden = false;
    return;
  }
  const count = result.data.labs.reduce((n, lab) => n + lab.workstations.length, 0);
  filterStatus.textContent = describeFilter(count);
  if (result.data.labs.length === 0) {
    if (chosen.size) showFilteredEmpty();
    else showEmpty(status, 'No workstations are open for booking yet. Ask the lab staff to add one.');
    return;
  }
  content.replaceChildren(legend(), ...result.data.labs.map(renderLab));
  status.hidden = true;
  content.hidden = false;
  if (jumpTo) {
    document.getElementById(jumpTo)?.scrollIntoView({ block: 'start' });
    jumpTo = '';
  }
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

/**
 * A suggestion in two labelled parts: the workstation's features from LabSpot's database (facts), and
 * the model's reason (its words). Nothing is booked until the student presses Book.
 */
function showSuggestion(s) {
  const title = el('p', 'suggestion-label', 'Suggestion');
  const what = el('p', 'suggestion-what', `${s.workstation}, ${s.lab} · ${longDate(s.date)}, ${s.start}–${s.end}`);

  const facts = el('div', 'suggestion-part');
  facts.append(el('h3', '', 'Workstation features'), el('p', 'muted part-note', "From LabSpot's records"));
  facts.append(s.features.length ? featureTags(s.features, `${s.workstation} features`) : el('p', '', 'No listed features.'));

  const words = el('div', 'suggestion-part');
  words.append(el('h3', '', 'Why the model picked it'), el('p', 'muted part-note', "The model's own words"), el('p', 'suggestion-reason', s.reason));

  const book = el('button', '', 'Book this slot');
  book.type = 'button';
  book.addEventListener('click', async () => {
    book.disabled = true;
    book.textContent = 'Booking…';
    const result = await api('/api/bookings', { method: 'POST', body: { workstationId: s.workstationId, date: s.date, block: s.block } });
    suggestResult.hidden = true;
    if (result.ok) showNotice(`Booked ${s.workstation} on ${longDate(s.date)}, ${s.start}–${s.end}.`, 'success');
    else showNotice(result.error, 'error');
    if (dateInput.value === s.date) await load();
    else go(s.date);
  });
  suggestResult.replaceChildren(title, what, facts, words, book);
  suggestResult.className = 'suggestion';
  suggestResult.hidden = false;
}

suggestForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  suggestButton.disabled = true;
  suggestButton.textContent = 'Finding a slot…';
  suggestResult.hidden = true;
  const result = await api('/api/suggestions', { method: 'POST', body: { text: suggestForm.text.value } });
  suggestButton.disabled = false;
  suggestButton.textContent = 'Suggest a slot';
  if (result.ok && result.data.suggestion) {
    showSuggestion(result.data.suggestion);
  } else {
    // the fallback, the daily limit, or a request the server refused: the day view below still works
    suggestResult.replaceChildren(el('p', '', result.ok ? result.data.message : result.error));
    suggestResult.className = 'suggestion suggestion-off';
    suggestResult.hidden = false;
  }
});

/** A new date replaces the history entry; a new filter adds one, so Back undoes it. */
function go(date) {
  dateInput.value = date;
  history.replaceState(null, '', urlFor(date, chosen));
  notice.hidden = true;
  load();
}

function setFilter(next) {
  chosen = next;
  history.pushState(null, '', urlFor(dateInput.value, chosen));
  load();
}

function renderFilter() {
  filterBox.replaceChildren(chipGroups(chosen, setFilter, { idPrefix: 'filter' }));
}

function clearFilters() {
  setFilter(new Set());
  renderFilter();
  filterBox.querySelector('.chip-toggle')?.focus();
}

async function startFilter() {
  filterBox.replaceChildren(el('p', 'muted', 'Loading features…'));
  if (await loadFeatures()) {
    renderFilter();
  } else {
    filterBox.replaceChildren(el('p', 'muted', 'The feature filter is not available right now. The day view below still works.'));
  }
}

document.querySelector('#prev-day').addEventListener('click', () => go(weekdayFrom(dateInput.value || firstOpenDay(), -1)));
document.querySelector('#next-day').addEventListener('click', () => go(weekdayFrom(dateInput.value || firstOpenDay(), 1)));
dateInput.addEventListener('change', () => go(dateInput.value));
document.querySelector('#day-picker').addEventListener('submit', (e) => e.preventDefault());
document.querySelector('#day-retry').addEventListener('click', load);
clearButton.addEventListener('click', clearFilters);
window.addEventListener('popstate', () => {
  readUrl();
  renderFilter();
  load();
});

user = await renderNav();
suggestForm.hidden = user?.role === 'staff';
readUrl();
await startFilter();
load();
