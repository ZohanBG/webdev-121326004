// Staff: add labs and workstations, change features, take a workstation out of service.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el } from './format.js';

const FEATURES = [['quiet', 'Quiet'], ['dual-monitor', 'Dual monitor'], ['gpu', 'GPU']];

const notice = document.querySelector('#staff-notice');
const status = document.querySelector('#staff-status');
const errorBox = document.querySelector('#staff-error');
const errorText = document.querySelector('#staff-error-text');
const content = document.querySelector('#staff-labs');
const labSelect = document.querySelector('#ws-lab');

function showNotice(text, kind) {
  notice.className = `message ${kind}`;
  notice.textContent = text;
  notice.hidden = false;
  notice.scrollIntoView({ block: 'nearest' });
}

async function act(button, busyText, request, successText) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  const result = await request();
  button.disabled = false;
  button.textContent = original;
  if (result.ok) {
    showNotice(successText, 'success');
    await load();
  } else {
    showNotice(result.error, 'error');
  }
  return result.ok;
}

function renderWorkstation(ws) {
  const item = el('li', 'staff-ws');
  const head = el('div', 'staff-ws-head');
  head.append(el('h4', '', ws.label), el('span', ws.inService ? 'badge' : 'badge badge-off', ws.inService ? 'In service' : 'Out of service'));

  const features = el('fieldset', 'features features-inline');
  features.append(el('legend', 'visually-hidden', `${ws.label} features`));
  for (const [value, label] of FEATURES) {
    const box = el('input');
    box.type = 'checkbox';
    box.value = value;
    box.checked = ws.features.includes(value);
    const wrap = el('label');
    wrap.append(box, ` ${label}`);
    features.append(wrap);
  }
  const save = el('button', 'secondary', 'Save features');
  save.type = 'button';
  save.setAttribute('aria-label', `Save features of ${ws.label}`);
  save.addEventListener('click', () => {
    const chosen = [...features.querySelectorAll('input:checked')].map((b) => b.value);
    act(save, 'Saving…', () => api(`/api/workstations/${ws.id}`, { method: 'PATCH', body: { features: chosen } }), `Saved the features of ${ws.label}.`);
  });

  const toggle = el('button', 'secondary', ws.inService ? 'Take out of service' : 'Put back in service');
  toggle.type = 'button';
  toggle.setAttribute('aria-label', `${ws.inService ? 'Take out of service' : 'Put back in service'}: ${ws.label}`);
  toggle.addEventListener('click', () => act(
    toggle,
    'Saving…',
    () => api(`/api/workstations/${ws.id}`, { method: 'PATCH', body: { inService: !ws.inService } }),
    ws.inService ? `${ws.label} is out of service.` : `${ws.label} is back in service.`,
  ));

  const actions = el('div', 'actions');
  actions.append(save, toggle);
  item.append(head, features, actions);
  return item;
}

function renderLab(lab) {
  const section = el('section', 'card staff-lab');
  section.append(el('h3', '', `${lab.name} · Room ${lab.room}`));
  if (lab.workstations.length === 0) {
    section.append(el('p', 'muted', 'No workstations yet. Add one with the form above.'));
  } else {
    const list = el('ul', 'staff-ws-list');
    list.append(...lab.workstations.map(renderWorkstation));
    section.append(list);
  }
  return section;
}

async function load() {
  status.textContent = 'Loading labs…';
  status.hidden = false;
  errorBox.hidden = true;
  content.hidden = true;

  const result = await api('/api/admin/labs');
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
  const selected = labSelect.value;
  labSelect.replaceChildren(...result.data.map((lab) => {
    const option = el('option', '', `${lab.name} (${lab.room})`);
    option.value = lab.id;
    return option;
  }));
  if (selected) labSelect.value = selected;

  if (result.data.length === 0) {
    status.textContent = 'No labs yet. Add the first one with the form above.';
    return;
  }
  content.replaceChildren(...result.data.map(renderLab));
  status.hidden = true;
  content.hidden = false;
}

document.querySelector('#add-lab').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const name = form.name.value;
  const ok = await act(form.querySelector('button'), 'Adding…',
    () => api('/api/labs', { method: 'POST', body: { name, room: form.room.value } }), `Added the lab ${name.trim()}.`);
  if (ok) form.reset();
});

document.querySelector('#add-workstation').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const label = form.label.value;
  const features = [...form.querySelectorAll('input[name="features"]:checked')].map((b) => b.value);
  const ok = await act(form.querySelector('button'), 'Adding…',
    () => api('/api/workstations', { method: 'POST', body: { labId: Number(form.labId.value), label, features } }),
    `Added the workstation ${label.trim()}.`);
  if (ok) {
    form.label.value = '';
    form.querySelectorAll('input[name="features"]').forEach((b) => { b.checked = false; });
  }
});

document.querySelector('#staff-retry').addEventListener('click', load);
await renderNav();
load();
