// The screenshots behind docs/UI.md's Evidence section, taken in headless Chrome (or Edge) against a LOCAL
// TEST SERVER: the real app on an in-process PGlite database with the test seed and the test password from
// test/helpers.js, a fixed clock (Monday 2026-11-23, 11:00 in Sofia) and a fake model client that can wait,
// answer or fail. It never reads .env and never touches the live site.
//
//   node scripts/ui/screenshots.mjs [out-dir] [--chrome=<path>]      (default out-dir: docs/ui)
//
// Where a fact is not visible on the page itself (an accessibility name, the title, a size, a contrast
// ratio), a yellow box marked "Annotation" is added to the page before the screenshot.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? join(repo, 'docs', 'ui');
const CHROME = args.find((a) => a.startsWith('--chrome='))?.slice('--chrome='.length) ?? [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => existsSync(path));
if (!CHROME) {
  console.error('No Chrome or Edge found. Pass its path: --chrome=/path/to/chrome');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const h = await import(new URL('../../test/helpers.js', import.meta.url).href);
const NOW = new Date('2026-11-23T09:00:00Z'); // Monday, 11:00 in Sofia
const MON = '2026-11-23';
const TUE = '2026-11-24';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const facts = {};

// ---- the app on its own test database, with a fake model whose behaviour each screenshot picks
const db = await h.freshDb();
const ws = await h.workstationIds(db);
let modelMode = 'answer';
const model = {
  model: 'fake',
  complete: async () => {
    if (modelMode === 'wait') await pause(4000);
    if (modelMode === 'fail') throw Object.assign(new Error('fake provider failure'), { status: 503 });
    return {
      stopReason: 'end_turn',
      text: JSON.stringify({ slotId: `${ws.NL03}:${MON}:5`, features: ['quiet', 'dual-monitor'], reason: 'A quiet seat with two monitors, free this afternoon.' }),
    };
  },
};
const app = await h.startApp(db, { now: () => NOW, model });
const cookieOf = async (email) => (await h.login(app.base, email)).cookie;
const call = async (cookie, method, path, body) => {
  const res = await fetch(app.base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
};
const student = await cookieOf(h.STUDENT);
const student2 = await cookieOf(h.STUDENT2); // has no bookings: the empty state
await call(student, 'POST', '/api/bookings', { workstationId: ws.NL03, date: MON, block: 4 });
await call(student, 'POST', '/api/bookings', { workstationId: ws.GL02, date: TUE, block: 3 });

// ---- Chrome with a throw-away profile, and a small DevTools client
const profile = mkdtempSync(join(tmpdir(), 'labspot-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++) {
  try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await pause(100); }
}
let targets;
for (let i = 0; i < 100 && !targets; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await pause(100); }
}
const sock = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { sock.onopen = r; });
let nextId = 1;
const pending = new Map();
const listeners = new Set();
sock.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
  } else for (const f of listeners) f(m);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject, method });
  sock.send(JSON.stringify({ id, method, params }));
});
const once = (method) => new Promise((resolve) => {
  const f = (m) => { if (m.method === method) { listeners.delete(f); resolve(m.params); } };
  listeners.add(f);
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await pause(40);
  }
  throw new Error(`timed out waiting for ${expression}`);
}
await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');

async function viewport(width, height = 900, theme = 'light') {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
}
async function signIn(cookie) {
  await send('Network.clearBrowserCookies');
  if (!cookie) return;
  const [name, value] = cookie.split(/=(.*)/s);
  await send('Network.setCookie', { name, value, url: app.base });
}
const SETTLED = '!document.querySelector(\'[aria-busy="true"]\')';
const DAY_READY = `${SETTLED} && document.querySelector('#filter-chips .chip-toggle')`;
async function open(path, ready = SETTLED) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: app.base + path });
  await loaded;
  if (ready) await waitFor(ready);
  await pause(80);
}
async function tab(times = 1) {
  for (let i = 0; i < times; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  }
}
/** The viewport, or the whole page with full: true. */
async function shot(name, { full = false } = {}) {
  let clip;
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    clip = { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 6000), scale: 1 };
  }
  const r = await send('Page.captureScreenshot', { format: 'png', ...(full ? { captureBeyondViewport: true, clip } : {}) });
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
  console.log(`saved docs/ui/${name}.png`);
}
/** A yellow box with a fact the page does not show by itself, clearly marked as added for the screenshot. */
const annotate = (lines) => evaluate(`(() => {
  const box = document.createElement('div');
  box.setAttribute('style', 'position:fixed;right:16px;bottom:16px;max-width:460px;z-index:9999;background:#fff3b0;color:#1b1f24;border:2px solid #8a6d00;border-radius:8px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 2px 8px rgb(0 0 0 / .25)');
  box.innerHTML = '<strong>Annotation (added for this screenshot)</strong><br>' + ${JSON.stringify(lines)}.map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>');
  document.body.append(box);
})()`);
const noSideScroll = () => evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth');
async function key(name, { shift = false } = {}) {
  const codes = { Tab: 9, Enter: 13 };
  const base = { key: name, code: name, windowsVirtualKeyCode: codes[name], modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}
/** Presses Tab (or Shift+Tab) until `test` is true for the focused element; returns how many presses it took. */
async function tabTo(test, { back = false, max = 120 } = {}) {
  for (let i = 1; i <= max; i++) {
    await key('Tab', { shift: back });
    if (await evaluate(`(() => { const a = document.activeElement; return Boolean(a && (${test})); })()`)) return i;
  }
  throw new Error(`Tab never reached ${test}`);
}
const navigated = async (path) => waitFor(`location.pathname === '${path}' && document.readyState === 'complete'`);

try {
  // ---- the main flow with the keyboard alone: sign in, book, sign out (no clicks)
  await signIn(null);
  await viewport(1280, 800);
  await open('/login', 'true');
  const flow = [];
  flow.push(`Tab ×${await tabTo(`a.id === 'email'`)} to Email, typed it`);
  await send('Input.insertText', { text: h.STUDENT });
  flow.push(`Tab ×${await tabTo(`a.id === 'password'`)} to Password, typed it, Enter`);
  await send('Input.insertText', { text: h.PASSWORD });
  await key('Enter');
  await navigated('/labs');
  await waitFor(SETTLED);
  flow.push(`Tab ×${await tabTo(`a.getAttribute('href') === '/day'`)} to "Day" in the menu, Enter`);
  await key('Enter');
  await navigated('/day');
  await waitFor(DAY_READY);
  flow.push(`Tab ×${await tabTo(`a.classList.contains('block-book')`)} to the first "Book", Enter`);
  const booked = await evaluate(`document.activeElement.getAttribute('aria-label')`);
  await key('Enter');
  await waitFor(`!document.querySelector('#day-notice').hidden && ${SETTLED}`);
  await evaluate(`document.querySelector('#day-notice').scrollIntoView({ block: 'center' })`);
  facts.keyboardBooked = { button: booked, notice: await evaluate(`document.querySelector('#day-notice').innerText.replace(/\\s+/g, ' ').trim()`) };
  await shot('keyboard-booked');
  flow.push(`Shift+Tab ×${await tabTo(`a.id === 'sign-out'`, { back: true })} to "Sign out", Enter`);
  await key('Enter');
  await navigated('/login');
  flow.push('back on /login');
  facts.keyboardFlow = flow;
  // the booking made by keyboard is cancelled again, so the screenshots below start from the same data
  const { rows } = await db.query("SELECT b.id FROM bookings b JOIN users u ON u.id = b.user_id WHERE u.email = $1 AND b.status = 'active' ORDER BY b.id DESC LIMIT 1", [h.STUDENT]);
  await fetch(`${app.base}/api/bookings/${rows[0].id}`, { method: 'DELETE', headers: { cookie: student } });

  // ---- Sign in, signed out
  // ---- Sign in, signed out
  await signIn(null);
  await viewport(1280, 800);
  await open('/login', 'true');
  let stops = 0;
  while (stops < 6 && !(await evaluate(`document.activeElement?.id === 'email'`))) { await tab(); stops++; }
  facts.loginTabs = stops;
  facts.loginFocusRing = await evaluate(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + ' ' + s.outlineWidth; })()`);
  await shot('login-focus');

  const { nodes } = await send('Accessibility.getFullAXTree');
  const emailNode = nodes.find((n) => n.role?.value === 'textbox' && n.name?.value === 'Email');
  facts.emailName = emailNode ? emailNode.name.value : null;
  await evaluate(`document.activeElement.blur()`);
  await annotate([
    `Chrome's accessibility tree: the Email input has role "${emailNode?.role.value}" and name "${emailNode?.name.value}".`,
    'The name comes from <label for="email">Email</label>, not from a placeholder.',
  ]);
  await shot('login-label');

  await open('/login', 'true');
  facts.lang = await evaluate('document.documentElement.lang');
  facts.title = await evaluate('document.title');
  await annotate([`<html lang="${facts.lang}">`, `<title>${facts.title}</title>`, '(read from the page with document.documentElement.lang and document.title)']);
  await shot('login-title-lang');

  // ---- My bookings, as a student with two upcoming bookings: the four states
  await signIn(student);
  await viewport(1280, 800);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/bookings*' }] });
  let paused = once('Fetch.requestPaused');
  await open('/my-bookings', null);
  let { requestId } = await paused;
  await waitFor(`document.querySelector('#mine-region')?.getAttribute('aria-busy') === 'true'`);
  facts.loadingPlaceholders = await evaluate(`document.querySelectorAll('#mine-region .placeholder').length`);
  facts.placeholderTop = await evaluate(`Math.round(document.querySelector('#mine-region').getBoundingClientRect().top)`);
  await shot('loading');
  await send('Fetch.continueRequest', { requestId });
  await waitFor(SETTLED);
  await pause(80);
  facts.contentTop = await evaluate(`Math.round(document.querySelector('#mine').getBoundingClientRect().top)`);
  await shot('content');

  // the network fails, as when the browser is offline
  paused = once('Fetch.requestPaused');
  await open('/my-bookings', null);
  ({ requestId } = await paused);
  await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' });
  await waitFor(`!document.querySelector('#mine-error').hidden`);
  facts.errorText = await evaluate(`document.querySelector('#mine-error-text').textContent`);
  await shot('error');
  await send('Fetch.disable');

  await open('/my-bookings');
  facts.bookingsBefore = await evaluate(`document.querySelectorAll('#mine .booking').length`);
  await evaluate(`window.__sameDocument = true; document.querySelector('#mine button.danger').click()`);
  await waitFor(`!document.querySelector('#mine-notice').hidden && ${SETTLED}`);
  await pause(80);
  facts.successText = await evaluate(`document.querySelector('#mine-notice').innerText.replace(/\\s+/g, ' ').trim()`);
  facts.bookingsAfter = await evaluate(`document.querySelectorAll('#mine .booking').length`);
  facts.noReload = await evaluate('window.__sameDocument === true');
  await shot('success');

  await signIn(student2);
  await open('/my-bookings');
  facts.emptyText = await evaluate(`document.querySelector('#mine-status').innerText.replace(/\\s+/g, ' ').trim()`);
  await shot('empty');

  // ---- Day view, as a student
  await signIn(student);
  for (const width of [380, 768, 1280]) {
    await viewport(width);
    await open(`/day?date=${MON}`, DAY_READY);
    facts[`day${width}`] = {
      layout: await evaluate(`getComputedStyle(document.querySelector('.workstation')).display === 'grid' ? 'grid' : 'cards'`),
      noSideScroll: await noSideScroll(),
    };
    await shot(`day-${width}`, { full: true });
  }

  await viewport(1280, 800);
  await open(`/day?date=${MON}`, DAY_READY);
  let presses = 0;
  while (presses < 80 && !(await evaluate(`document.activeElement?.classList.contains('block-book')`))) { await tab(); presses++; }
  facts.bookTabs = presses;
  facts.bookFocus = await evaluate(`(() => { const a = document.activeElement; const s = getComputedStyle(a); return { name: a.getAttribute('aria-label'), ring: s.outlineStyle + ' ' + s.outlineWidth }; })()`);
  await shot('keyboard-book');

  await open(`/day?date=${MON}`, DAY_READY);
  facts.bookSize = await evaluate(`(() => { const b = document.querySelector('.block-book'); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); b.style.outline = '3px dashed #c2185b'; b.style.outlineOffset = '2px'; return { width: Math.round(r.width), height: Math.round(r.height), label: b.getAttribute('aria-label') }; })()`);
  await annotate([`"${facts.bookSize.label}" (dashed outline): ${facts.bookSize.width} × ${facts.bookSize.height} px.`, 'Measured with getBoundingClientRect(); the minimum is 44 px (--touch-target).']);
  await shot('touch-target');

  await open(`/day?date=${MON}`, DAY_READY);
  facts.contrast = await evaluate(`(() => {
    const rgb = (c) => c.match(/\\d+(\\.\\d+)?/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const intro = document.querySelector('.intro');
    const fg = rgb(getComputedStyle(intro).color);
    const bg = rgb(getComputedStyle(document.body).backgroundColor);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    intro.style.outline = '3px dashed #c2185b';
    return { fg: getComputedStyle(intro).color, bg: getComputedStyle(document.body).backgroundColor, ratio: ((a + 0.05) / (b + 0.05)).toFixed(2) };
  })()`);
  await annotate([
    `The intro line (dashed outline): text ${facts.contrast.fg} on ${facts.contrast.bg}.`,
    `Contrast ${facts.contrast.ratio}:1 (WCAG 2.2 formula; text needs 4.5:1).`,
    'The same pair in scripts/ui/contrast.mjs: muted on bg, 7.20:1 light, 8.71:1 dark.',
  ]);
  await shot('contrast');

  // the model feature, with the fake client
  const ask = async () => {
    await evaluate(`(() => { const f = document.querySelector('#suggest'); f.text.value = 'a quiet place with two monitors this afternoon'; f.requestSubmit(); })()`);
  };
  await open(`/day?date=${MON}`, DAY_READY);
  modelMode = 'wait';
  await ask();
  await waitFor(`document.querySelector('#suggest-button').disabled`);
  facts.thinking = await evaluate(`({ text: document.querySelector('#suggest-button').textContent, disabled: document.querySelector('#suggest-button').disabled })`);
  await evaluate(`document.querySelector('#suggest').scrollIntoView({ block: 'start' })`);
  await shot('model-thinking');
  await waitFor(`!document.querySelector('#suggest-result').hidden`);

  await open(`/day?date=${MON}`, DAY_READY);
  modelMode = 'answer';
  await ask();
  await waitFor(`!document.querySelector('#suggest-result').hidden`);
  await evaluate(`document.querySelector('#suggest').scrollIntoView({ block: 'start' })`);
  facts.suggestion = await evaluate(`document.querySelector('#suggest-result').innerText.split('\\n').filter(Boolean).slice(0, 6)`);
  await shot('model-suggestion');

  await open(`/day?date=${MON}`, DAY_READY);
  modelMode = 'fail';
  await ask();
  await waitFor(`!document.querySelector('#suggest-result').hidden`);
  await evaluate(`document.querySelector('#suggest').scrollIntoView({ block: 'start' })`);
  facts.failed = { text: await evaluate(`document.querySelector('#suggest-result').innerText.trim()`), gridStillThere: await evaluate(`!document.querySelector('#day-content').hidden && document.querySelectorAll('.block').length > 0`) };
  await viewport(1280, 1400);
  await shot('model-failed');

  // the request waterfall of the Day view: cache disabled, no throttling, every request with its start and end
  await signIn(student);
  await viewport(1280, 900);
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  const requests = new Map();
  const watch = (m) => {
    if (m.method === 'Network.requestWillBeSent') requests.set(m.params.requestId, { url: m.params.request.url, start: m.params.timestamp });
    if (m.method === 'Network.responseReceived' && requests.has(m.params.requestId)) requests.get(m.params.requestId).status = m.params.response.status;
    if (m.method === 'Network.loadingFinished' && requests.has(m.params.requestId)) requests.get(m.params.requestId).end = m.params.timestamp;
  };
  listeners.add(watch);
  await open(`/day?date=${MON}`, DAY_READY);
  await pause(300);
  listeners.delete(watch);
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  // only real network requests: Chrome's own data: URLs (the date field's icon) are not sent anywhere
  const list = [...requests.values()].filter((r) => r.end && r.url.startsWith('http')).sort((a, b) => a.start - b.start);
  const t0 = list[0].start;
  const ms = (t) => Math.round((t - t0) * 1000);
  const finish = Math.max(...list.map((r) => ms(r.end)));
  const scale = 60 / finish;
  const lines = list.map((r) => {
    const path = new URL(r.url).pathname + new URL(r.url).search;
    const bar = ' '.repeat(Math.round(ms(r.start) * scale)) + '#'.repeat(Math.max(1, Math.round((ms(r.end) - ms(r.start)) * scale)));
    return `${String(ms(r.start)).padStart(5)} ms ${String(ms(r.end)).padStart(5)} ms  ${String(r.status ?? '').padEnd(3)}  ${path.padEnd(36)} ${bar}`;
  });
  const api = list.filter((r) => r.url.includes('/api/')).map((r) => new URL(r.url).pathname);
  facts.waterfall = { requests: list.length, finishMs: finish, apiOrder: api };
  writeFileSync(join(out, 'waterfall.txt'), [
    'Request waterfall of the Day view (/day?date=2026-11-23) as a student.',
    'LOCAL TEST SERVER (in-process app, PGlite test database), not the live site. Headless Chrome, cache disabled, no throttling.',
    `Requests: ${list.length}. Finish: ${finish} ms (from the first request to the last response).`,
    `API calls, in the order they start: ${api.join(' -> ')}`,
    '',
    ' start    end    status path                                 timeline',
    ...lines,
    '',
  ].join('\n'));
  console.log('saved docs/ui/waterfall.txt');

  // dark last: the theme button keeps the pick in this browser
  await viewport(1280, 900);
  await open(`/day?date=${MON}`, DAY_READY);
  await evaluate(`document.querySelector('#theme-toggle').click()`);
  await pause(100);
  facts.dark = await evaluate(`({ theme: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor })`);
  await shot('dark', { full: true });
} finally {
  sock.close();
  chrome.kill();
  await app.close();
  await db.close();
  await pause(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

writeFileSync(join(out, 'facts.json'), `${JSON.stringify(facts, null, 1)}\n`);
console.log(JSON.stringify(facts, null, 1));
