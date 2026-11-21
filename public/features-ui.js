// Feature chips, shared by the day view and the staff page. The list comes from GET /api/features,
// which reads the one list in code, so no page keeps its own copy of the ids or labels.
import { api } from './api.js';
import { el } from './format.js';

let groups = null;
let labels = new Map();

/** The grouped list, fetched once per page. Resolves to null when it could not be loaded. */
export async function loadFeatures() {
  if (groups) return groups;
  const result = await api('/api/features');
  if (!result.ok) return null;
  groups = result.data;
  labels = new Map(groups.flatMap((g) => g.features.map((f) => [f.id, f.label])));
  return groups;
}

/** The label a person reads; the id only if the list could not be loaded. */
export const labelOf = (id) => labels.get(id) ?? id;

/** Read-only chips for the features a workstation has. */
export function featureTags(ids, ariaLabel = 'Features') {
  const list = el('ul', 'chips');
  list.setAttribute('aria-label', ariaLabel);
  for (const id of ids) list.append(el('li', 'chip', labelOf(id)));
  return list;
}

/**
 * Toggle chips grouped by category. Each chip is a real button with aria-pressed, so it is reachable
 * with Tab and switched with Enter or Space. `selected` is a Set of ids; `onChange` gets the new Set.
 */
export function chipGroups(selected, onChange, { idPrefix = 'chips' } = {}) {
  const wrap = el('div', 'chip-groups');
  groups.forEach((group, index) => {
    const titleId = `${idPrefix}-group-${index}`;
    const box = el('div', 'chip-group');
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', titleId);
    const title = el('p', 'chip-group-title', group.group);
    title.id = titleId;
    const row = el('div', 'chip-row');
    for (const feature of group.features) {
      // "+" (add it) or "✓" (on), as well as the fill, so the state is not colour alone. Screen readers skip
      // the symbol and read aria-pressed. Both symbols take about the same space, so a press does not move the row.
      const tick = el('span', 'chip-tick');
      tick.setAttribute('aria-hidden', 'true');
      const chip = el('button', 'chip-toggle');
      chip.append(tick, el('span', '', feature.label));
      chip.type = 'button';
      chip.dataset.feature = feature.id;
      const show = (on) => {
        chip.setAttribute('aria-pressed', String(on));
        tick.textContent = on ? '✓' : '+';
      };
      show(selected.has(feature.id));
      chip.addEventListener('click', () => {
        const next = new Set(selected);
        if (next.has(feature.id)) next.delete(feature.id);
        else next.add(feature.id);
        selected = next;
        show(next.has(feature.id));
        onChange(next);
      });
      row.append(chip);
    }
    box.append(title, row);
    wrap.append(box);
  });
  return wrap;
}

/** The ids currently pressed inside a chipGroups element. */
export const pressedIn = (container) => [...container.querySelectorAll('.chip-toggle[aria-pressed="true"]')].map((b) => b.dataset.feature);
