import { api } from './api.js';
import { renderNav } from './nav.js';
import { el } from './format.js';
import { showLoading, doneLoading, showEmpty } from './ui.js';

const status = document.querySelector('#labs-status');
const errorBox = document.querySelector('#labs-error');
const errorText = document.querySelector('#labs-error-text');
const region = document.querySelector('#labs-region');
const list = document.querySelector('#labs');

function renderLab(lab) {
  const item = el('li', 'card lab-card');
  const n = lab.activeWorkstations;
  const count = el('p', 'lab-count');
  count.append(el('span', 'badge badge-neutral', `${n} active workstation${n === 1 ? '' : 's'}`));
  item.append(el('h2', 'lab-name', lab.name), el('p', 'muted', `Room ${lab.room}`), count);
  if (n > 0) {
    const link = el('a', 'button secondary', 'See free slots');
    link.href = `/day#lab-${lab.id}`;
    link.setAttribute('aria-label', `See free slots in ${lab.name}`);
    item.append(link);
  } else {
    item.append(el('p', 'muted lab-none', 'Nothing to book here yet.'));
  }
  return item;
}

async function load() {
  showLoading(region, status, 'Loading labs…');
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api('/api/labs');
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
    showEmpty(status, 'No labs are open for booking yet. Check back later, or ask the lab staff.');
    return;
  }
  list.replaceChildren(...result.data.map(renderLab));
  status.hidden = true;
  list.hidden = false;
}

document.querySelector('#labs-retry').addEventListener('click', load);
await renderNav();
load();
