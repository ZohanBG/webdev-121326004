// The pieces every page uses for its four states: loading placeholders, empty states and notices.
import { el } from './format.js';

/** A symbol only the eye needs. The word next to it is what a screen reader reads. */
export function symbol(char) {
  const span = el('span', 'symbol', char);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

const SYMBOL = { success: '✓', error: '!' };

/** A success or error notice: a ✓ or ! as well as the colour. `content` is text and nodes. */
export function showMessage(box, kind, ...content) {
  const body = el('div', 'message-body');
  body.append(...content);
  box.className = `message ${kind}`;
  box.replaceChildren(symbol(SYMBOL[kind]), body);
  box.hidden = false;
}

/**
 * Loading: the region is marked busy and shows its placeholders, which have a fixed height so nothing
 * jumps when the content arrives; the status line says what is loading, to screen readers only.
 */
export function showLoading(region, status, text) {
  region.setAttribute('aria-busy', 'true');
  region.querySelector('.placeholders').hidden = false;
  status.className = 'status';
  status.replaceChildren(el('span', 'visually-hidden', text));
  status.hidden = false;
}

/** The answer is in (content, empty or error): the placeholders go and the region is no longer busy. */
export function doneLoading(region) {
  region.querySelector('.placeholders').hidden = true;
  region.setAttribute('aria-busy', 'false');
}

/** An empty state: what this list is for and what to do next. */
export function showEmpty(status, ...content) {
  status.className = 'status empty';
  status.replaceChildren(...content);
  status.hidden = false;
}
