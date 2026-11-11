import { api, signOut } from './api.js';

const status = document.querySelector('#labs-status');
const errorBox = document.querySelector('#labs-error');
const errorText = document.querySelector('#labs-error-text');
const list = document.querySelector('#labs');

function renderLab(lab) {
  const item = document.createElement('li');
  const name = document.createElement('p');
  name.className = 'lab-name';
  name.textContent = lab.name;
  const room = document.createElement('span');
  room.className = 'muted';
  room.textContent = `Room ${lab.room}`;
  const count = document.createElement('span');
  count.textContent = `${lab.activeWorkstations} active workstation${lab.activeWorkstations === 1 ? '' : 's'}`;
  item.append(name, room, count);
  return item;
}

async function load() {
  status.textContent = 'Loading labs…';
  status.hidden = false;
  errorBox.hidden = true;
  list.hidden = true;

  const result = await api('/api/labs');
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
    status.textContent = 'No labs are open for booking yet. Check back later, or ask the lab staff.';
    return;
  }
  list.replaceChildren(...result.data.map(renderLab));
  status.hidden = true;
  list.hidden = false;
}

document.querySelector('#sign-out').addEventListener('click', signOut);
document.querySelector('#labs-retry').addEventListener('click', load);
load();
