// Staff: add labs and workstations, change features, take a workstation out of service.
import { api } from './api.js';
import { renderNav } from './nav.js';
import { el } from './format.js';
import { loadFeatures, featureTags, chipGroups, pressedIn } from './features-ui.js';
import { symbol, showLoading, doneLoading, showEmpty, showMessage } from './ui.js';

let featuresReady = false;

const notice = document.querySelector('#staff-notice');
const status = document.querySelector('#staff-status');
const errorBox = document.querySelector('#staff-error');
const errorText = document.querySelector('#staff-error-text');
const region = document.querySelector('#staff-region');
const content = document.querySelector('#staff-labs');
const labSelect = document.querySelector('#ws-lab');

function showNotice(text, kind) {
  showMessage(notice, kind, text);
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
  const state = el('span', ws.inService ? 'badge' : 'badge badge-off');
  state.append(symbol(ws.inService ? '✓' : '⏸'), ws.inService ? 'In service' : 'Out of service');
  head.append(el('h4', '', ws.label), state);

  const current = ws.features.length ? featureTags(ws.features, `${ws.label} features`) : el('p', 'muted', 'No features listed.');

  // the grouped chips open only for the workstation being edited, so the page stays short
  const editor = el('div', 'feature-editor');
  editor.hidden = true;
  const edit = el('button', 'secondary', 'Edit features');
  edit.type = 'button';
  edit.setAttribute('aria-label', `Edit features of ${ws.label}`);
  edit.setAttribute('aria-expanded', 'false');
  edit.disabled = !featuresReady;
  edit.addEventListener('click', () => {
    const open = editor.hidden;
    editor.hidden = !open;
    edit.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const chips = chipGroups(new Set(ws.features), () => {}, { idPrefix: `ws-${ws.id}` });
    const save = el('button', '', 'Save features');
    save.type = 'button';
    save.setAttribute('aria-label', `Save features of ${ws.label}`);
    save.addEventListener('click', () => act(
      save,
      'Saving…',
      () => api(`/api/workstations/${ws.id}`, { method: 'PATCH', body: { features: pressedIn(chips) } }),
      `Saved the features of ${ws.label}.`,
    ));
    const cancel = el('button', 'secondary', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => {
      editor.hidden = true;
      edit.setAttribute('aria-expanded', 'false');
      edit.focus();
    });
    const buttons = el('div', 'actions');
    buttons.append(save, cancel);
    editor.replaceChildren(chips, buttons);
    editor.querySelector('.chip-toggle')?.focus();
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
  actions.append(edit, toggle);
  item.append(head, current, actions, editor);
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
  showLoading(region, status, 'Loading labs…');
  errorBox.hidden = true;
  content.hidden = true;

  const result = await api('/api/admin/labs');
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
  const selected = labSelect.value;
  labSelect.replaceChildren(...result.data.map((lab) => {
    const option = el('option', '', `${lab.name} (${lab.room})`);
    option.value = lab.id;
    return option;
  }));
  if (selected) labSelect.value = selected;

  if (result.data.length === 0) {
    showEmpty(status, 'No labs yet. Add the first one with the form above.');
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
  const ok = await act(form.querySelector('button[type="submit"]'), 'Adding…',
    () => api('/api/labs', { method: 'POST', body: { name, room: form.room.value } }), `Added the lab ${name.trim()}.`);
  if (ok) form.reset();
});

const newFeatures = document.querySelector('#ws-features');

function resetNewFeatures() {
  newFeatures.replaceChildren(chipGroups(new Set(), () => {}, { idPrefix: 'new-ws' }));
}

document.querySelector('#add-workstation').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const label = form.label.value;
  // the chips are buttons too, so the submit button is named explicitly
  const ok = await act(form.querySelector('button[type="submit"]'), 'Adding…',
    () => api('/api/workstations', { method: 'POST', body: { labId: Number(form.labId.value), label, features: pressedIn(newFeatures) } }),
    `Added the workstation ${label.trim()}.`);
  if (ok) {
    form.label.value = '';
    resetNewFeatures();
  }
});

document.querySelector('#staff-retry').addEventListener('click', load);
await renderNav();
newFeatures.replaceChildren(el('p', 'muted', 'Loading features…'));
featuresReady = Boolean(await loadFeatures());
if (featuresReady) resetNewFeatures();
else newFeatures.replaceChildren(el('p', 'muted', 'The feature list is not available right now; a workstation can still be added without features.'));
load();
