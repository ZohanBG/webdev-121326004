// Measures the pages in headless Chrome (or Edge) over the DevTools protocol, for docs/UI.md.
// It never uses .env or the development database: it starts its own copy of the app on an in-process
// PGlite database with the test seed and the test password from test/helpers.js, a fixed clock
// (Monday 2026-11-23, 11:00 in Sofia) and a fake model client, so nothing reaches Gemini.
//
//   node scripts/ui/measure.mjs [out-dir] [--chrome=<path to chrome or msedge>]
//
// Writes a screenshot per page, width and theme and report.json into out-dir (default: a folder in the
// system temp directory), prints a summary, and exits with 1 if a page scrolls sideways, a script fails,
// a Tab stop has no focus ring or the theme button misbehaves. Needs Chrome or Edge; no extra packages.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? join(tmpdir(), 'labspot-ui');
const chromeArg = args.find((a) => a.startsWith('--chrome='))?.slice('--chrome='.length);
const CHROME = chromeArg ?? [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((path) => existsSync(path));
if (!CHROME) {
  console.error('No Chrome or Edge found. Pass its path: node scripts/ui/measure.mjs --chrome=/path/to/chrome');
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const h = await import(new URL('../../test/helpers.js', import.meta.url).href);
const NOW = new Date('2026-11-23T09:00:00Z'); // Monday, 11:00 in Sofia: blocks 1 and 2 have started
const MON = '2026-11-23';
const TUE = '2026-11-24';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { pages: [], states: [], theme: [], keyboard: null, sweeps: {}, problems: [] };

// ---- the app on its own test database
const db = await h.freshDb();
const ws = await h.workstationIds(db);
const model = {
  model: 'fake',
  complete: async () => ({
    stopReason: 'end_turn',
    text: JSON.stringify({ slotId: `${ws.NL03}:${MON}:5`, features: ['quiet', 'dual-monitor'], reason: 'A quiet seat with two monitors, free this afternoon.' }),
  }),
};
const app = await h.startApp(db, { now: () => NOW, model });
const cookieOf = async (email) => (await h.login(app.base, email)).cookie;
const call = async (cookie, method, path, body) => {
  const res = await fetch(app.base + path, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
};
const student = await cookieOf(h.STUDENT);
const student2 = await cookieOf(h.STUDENT2);
const staff = await cookieOf(h.STAFF);
await call(student2, 'POST', '/api/bookings', { workstationId: ws.NL01, date: MON, block: 3 }); // Taken for the student
await call(student, 'POST', '/api/bookings', { workstationId: ws.NL03, date: MON, block: 4 }); // Yours
await call(student, 'POST', '/api/bookings', { workstationId: ws.GL02, date: TUE, block: 3 });
const gone = await call(student, 'POST', '/api/bookings', { workstationId: ws.GL01, date: TUE, block: 5 });
await call(staff, 'DELETE', `/api/bookings/${gone.id}`); // "Cancelled by lab staff"

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
let current = '';
async function waitFor(expression, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await pause(40);
  }
  throw new Error(`timed out waiting for ${expression} on ${current}`);
}

let expectForbidden = false;
listeners.add((m) => {
  if (m.method === 'Runtime.exceptionThrown') report.problems.push(`${current}: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') report.problems.push(`${current}: console.error ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    const text = `${m.params.entry.text} ${m.params.entry.url ?? ''}`;
    // expected: the "Not allowed" page is served with 403, the wrong-password check gets 401, the held
    // request is answered with 500 on purpose, and there is no favicon yet
    const expected = (expectForbidden && text.includes('403')) || text.includes('/api/auth/login')
      || text.includes('500 (Internal Server Error)') || text.includes('/favicon.ico');
    if (!expected) report.problems.push(`${current}: ${text}`);
  }
});
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Log.enable');

async function viewport(width, theme, motion = 'no-preference') {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: motion }] });
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
  current = path;
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: app.base + path });
  await loaded;
  await waitFor(ready);
  await pause(60);
}
async function shot(name) {
  const { cssContentSize } = await send('Page.getLayoutMetrics');
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 5000), scale: 1 },
  });
  writeFileSync(join(out, `${name}.png`), Buffer.from(r.data, 'base64'));
}

// overflow: the page scrolls sideways, or a visible element ends right of the viewport or spills out of its box
const MEASURE = `(() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const name = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (n.classList.length ? '.' + [...n.classList].join('.') : '');
  const offenders = [];
  for (const node of document.querySelectorAll('body *')) {
    if (node.closest('[hidden], .visually-hidden, [aria-hidden="true"].placeholders')) continue;
    const cs = getComputedStyle(node);
    if (cs.clipPath !== 'none' || cs.display === 'none' || cs.display === 'contents') continue;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.right > vw + 0.5) offenders.push(name(node) + ' ends at ' + Math.round(r.right));
    else if (cs.display !== 'inline' && !node.classList.contains('who') && cs.overflowX === 'visible' && node.scrollWidth > node.clientWidth + 1)
      offenders.push(name(node) + ' content ' + node.scrollWidth + ' > box ' + node.clientWidth);
  }
  const top = (sel) => document.querySelector(sel)?.getBoundingClientRect().top;
  const navLinks = [...document.querySelectorAll('#nav a')].map((a) => Math.round(a.getBoundingClientRect().top));
  const who = document.querySelector('#who');
  const ws = document.querySelector('.workstation');
  return {
    clientWidth: vw, scrollbar: innerWidth - vw, horizontalScroll: de.scrollWidth > vw,
    offenders: offenders.slice(0, 8),
    header: document.querySelector('#nav') ? {
      oneRow: Math.abs(top('#nav') - top('.brand')) < 2,
      navLines: new Set(navLinks).size,
      whoTruncated: who ? who.scrollWidth > who.clientWidth : null,
    } : null,
    dayLayout: ws ? (getComputedStyle(ws).display === 'grid' ? 'grid' : 'cards') : null,
  };
})()`;
const THEME_STATE = `(() => {
  let kept = null;
  try { kept = localStorage.getItem('labspot-theme'); } catch {}
  const b = document.querySelector('#theme-toggle');
  const first = document.querySelector('head script');
  return { dataTheme: document.documentElement.dataset.theme ?? null, kept, bodyBg: getComputedStyle(document.body).backgroundColor,
    button: b.innerText.trim().replace(/\\s+/g, ' '), name: b.getAttribute('aria-label'),
    themeScriptFirst: first?.getAttribute('src') === '/theme.js' && !first.type && !first.defer && !first.async };
})()`;

async function page(label, path, ready) {
  for (const theme of ['light', 'dark']) {
    for (const width of [380, 768, 1280]) {
      await viewport(width, theme);
      await open(path, ready);
      report.pages.push({ page: label, width, theme, ...(await evaluate(MEASURE)) });
      await shot(`${label}-${width}-${theme}`);
    }
  }
}

try {
  // ---- signed out
  await signIn(null);
  await page('login', '/login', 'true');
  for (const theme of ['light', 'dark']) {
    await viewport(380, theme);
    await open('/login', 'true');
    await evaluate(`(() => { const f = document.querySelector('#login-form'); f.email.value = '${h.STUDENT}'; f.password.value = 'not-the-password'; f.requestSubmit(); })()`);
    await waitFor(`!document.querySelector('#login-error').hidden`);
    report.states.push({ state: `error: wrong password (${theme})`, text: await evaluate(`document.querySelector('#login-error').innerText`) });
    await shot(`state-login-error-380-${theme}`);
  }

  // the theme button under a light and a dark system: a click, a reload, a second click (back to the system's)
  for (const system of ['light', 'dark']) {
    await viewport(380, system);
    const ready = `document.querySelector('#theme-toggle').getAttribute('aria-label')`;
    await open('/login', ready);
    const steps = [{ step: 'start', ...(await evaluate(THEME_STATE)) }];
    await evaluate(`document.querySelector('#theme-toggle').click()`);
    steps.push({ step: 'after a click', ...(await evaluate(THEME_STATE)) });
    await shot(`theme-login-380-system-${system}-picked`);
    await open('/login', ready);
    steps.push({ step: 'after a reload', ...(await evaluate(THEME_STATE)) });
    await evaluate(`document.querySelector('#theme-toggle').click()`);
    steps.push({ step: 'after a second click', ...(await evaluate(THEME_STATE)) });
    const other = system === 'light' ? 'dark' : 'light';
    const ok = steps[0].dataTheme === null && steps[1].dataTheme === other && steps[1].kept === other
      && steps[2].dataTheme === other && steps[3].dataTheme === null && steps[3].kept === null
      && steps.every((s) => s.themeScriptFirst) && steps[1].bodyBg !== steps[0].bodyBg && steps[3].bodyBg === steps[0].bodyBg;
    report.theme.push({ system, ok, steps });
  }

  // ---- student
  await signIn(student);
  await page('labs', '/labs');
  await page('day', `/day?date=${MON}`, DAY_READY);
  await page('my-bookings', '/my-bookings');
  await page('account', '/account');
  expectForbidden = true;
  await page('forbidden', '/staff/labs', `document.querySelector('#nav a')`);
  expectForbidden = false;

  // a whole page with the other theme picked than the system's
  for (const [system, picked] of [['light', 'dark'], ['dark', 'light']]) {
    for (const width of [380, 1280]) {
      await viewport(width, system);
      await evaluate(`localStorage.setItem('labspot-theme', '${picked}')`);
      await open(`/day?date=${MON}`, DAY_READY);
      const m = await evaluate(MEASURE);
      const state = await evaluate(THEME_STATE);
      report.theme.push({ system, picked, width, ok: state.dataTheme === picked && !m.horizontalScroll && !m.offenders.length, offenders: m.offenders });
      await shot(`theme-day-${width}-system-${system}-picked-${picked}`);
      await evaluate(`localStorage.removeItem('labspot-theme')`);
    }
  }

  // loading and error: the labs request is held, then answered with a 500
  for (const theme of ['light', 'dark']) {
    for (const motion of ['no-preference', 'reduce']) {
      await viewport(768, theme, motion);
      await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/labs*' }] });
      current = `/labs (held, ${theme}, motion ${motion})`;
      const paused = once('Fetch.requestPaused');
      await send('Page.navigate', { url: `${app.base}/labs` });
      const { requestId } = await paused;
      await waitFor(`document.querySelector('#labs-status')?.textContent.includes('Loading labs')`);
      report.states.push({
        state: `loading (${theme}, reduced motion: ${motion})`,
        busy: await evaluate(`document.querySelector('#labs-region').getAttribute('aria-busy')`),
        statusVisuallyHidden: await evaluate(`!!document.querySelector('#labs-status .visually-hidden')`),
        placeholders: await evaluate(`document.querySelectorAll('#labs-region .placeholder').length`),
        animation: await evaluate(`getComputedStyle(document.querySelector('.placeholder')).animationName`),
      });
      if (motion === 'no-preference') await shot(`state-loading-768-${theme}`);
      await send('Fetch.fulfillRequest', {
        requestId, responseCode: 500, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ error: 'Something went wrong on our side. Try again.' })).toString('base64'),
      });
      await send('Fetch.disable');
      await waitFor(`!document.querySelector('#labs-error').hidden`);
      if (motion === 'no-preference') {
        report.states.push({ state: `error: labs (${theme})`, text: await evaluate(`document.querySelector('#labs-error').innerText`) });
        await shot(`state-error-768-${theme}`);
      }
    }
  }

  // empty because of the filter; the filter on; the suggestion card
  for (const theme of ['light', 'dark']) {
    await viewport(380, theme);
    await open(`/day?date=${MON}&features=plc-trainer`);
    report.states.push({ state: `empty: filter (${theme})`, text: await evaluate(`document.querySelector('#day-status').innerText`) });
    await shot(`state-empty-filter-380-${theme}`);
    await viewport(768, theme);
    await open(`/day?date=${MON}&features=quiet,dual-monitor`, DAY_READY);
    report.states.push({ state: `filter on (${theme})`, text: await evaluate(`document.querySelector('#filter-status').innerText`) });
    await shot(`state-filter-on-768-${theme}`);
  }
  for (const [width, theme] of [[1280, 'light'], [1280, 'dark'], [380, 'dark']]) {
    await viewport(width, theme);
    await open(`/day?date=${MON}`, DAY_READY);
    await evaluate(`(() => { const f = document.querySelector('#suggest'); f.text.value = 'a quiet place with two monitors this afternoon'; f.requestSubmit(); })()`);
    await waitFor(`!document.querySelector('#suggest-result').hidden`);
    report.states.push({ state: `suggestion (${width}, ${theme})`, text: await evaluate(`document.querySelector('#suggest-result').innerText`) });
    await shot(`state-suggestion-${width}-${theme}`);
  }

  // keyboard: Tab through the day view; every stop must draw the focus ring
  await viewport(1280, 'light');
  await open(`/day?date=${MON}`, DAY_READY);
  const stops = [];
  for (let i = 0; i < 45; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    stops.push(await evaluate(`(() => { const a = document.activeElement; const cs = getComputedStyle(a);
      return { name: a.getAttribute('aria-label') || a.textContent.trim().slice(0, 40) || a.id, ring: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`));
  }
  report.keyboard = { tabs: stops.length, withoutRing: stops.filter((s) => s.ring.startsWith('none')), order: stops.map((s) => s.name) };

  // success: Book on a block where the student has no other booking
  await viewport(768, 'light');
  await open(`/day?date=${MON}`, DAY_READY);
  await evaluate(`document.querySelector('[aria-label="Book NL-02, 18:00–20:00"]').click()`);
  await waitFor(`!document.querySelector('#day-notice').hidden && ${SETTLED}`);
  report.states.push({ state: 'success: booked', text: await evaluate(`document.querySelector('#day-notice').innerText`) });
  await shot('state-success-768-light');

  // ---- staff
  await signIn(staff);
  const STAFF_READY = `${SETTLED} && document.querySelector('#ws-features .chip-toggle')`;
  await page('staff-labs', '/staff/labs', STAFF_READY);
  await page('staff-bookings', `/staff/bookings?date=${TUE}`);
  await page('day-staff', `/day?date=${MON}`, DAY_READY);
  for (const theme of ['light', 'dark']) {
    await viewport(768, theme);
    await open('/staff/labs', STAFF_READY);
    await evaluate(`document.querySelector('.staff-ws .actions button').click()`);
    await waitFor(`document.querySelector('.feature-editor:not([hidden]) .chip-toggle')`);
    await shot(`state-staff-editor-768-${theme}`);
    await open('/staff/bookings?date=2026-11-27');
    report.states.push({ state: `empty: staff bookings (${theme})`, text: await evaluate(`document.querySelector('#all-status').innerText`) });
  }

  // ---- breakpoints: force each wide layout on and find the narrowest width where it still fits
  const styles = readFileSync(join(repo, 'public', 'styles.css'), 'utf8');
  const mediaBody = (query) => {
    const at = styles.indexOf(`@media (${query}) {`);
    let i = styles.indexOf('{', at) + 1;
    const start = i;
    for (let depth = 1; depth; i++) depth += styles[i] === '{' ? 1 : styles[i] === '}' ? -1 : 0;
    return styles.slice(start, i - 1);
  };
  const force = (css) => evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.append(s); })()`);
  const sweep = async (from, to, step, fits) => {
    const results = [];
    for (let width = from; width >= to; width -= step) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await pause(30);
      results.push({ width, fits: fits(await evaluate(MEASURE)) });
    }
    return { narrowestFit: Math.min(...results.filter((r) => r.fits).map((r) => r.width)), firstFailure: results.find((r) => !r.fits)?.width ?? null };
  };

  // the day grid, as a student (the Book buttons are a block's widest content)
  await signIn(student);
  await viewport(800, 'light');
  await open(`/day?date=${MON}`, DAY_READY);
  await force(mediaBody('min-width: 768px'));
  report.sweeps.dayGrid = await sweep(800, 560, 8, (m) => !m.horizontalScroll && m.offenders.length === 0);

  // the one-row top bar, as staff (the longest nav)
  await signIn(staff);
  await viewport(1100, 'light');
  await open('/staff/labs', `document.querySelector('#nav a')`);
  await force(mediaBody('min-width: 1024px'));
  report.sweeps.header = await sweep(1100, 700, 10, (m) => m.header.oneRow && m.header.navLines === 1 && !m.header.whoTruncated && !m.horizontalScroll);
} finally {
  sock.close();
  chrome.kill();
  await app.close();
  await db.close();
  await pause(300);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
const overflow = report.pages.filter((p) => p.horizontalScroll || p.offenders.length);
const themeBad = report.theme.filter((t) => !t.ok);
console.log(`Pages measured: ${report.pages.length} (380, 768 and 1280 px, light and dark); with sideways overflow: ${overflow.length}`);
for (const p of overflow) console.log(`  ${p.page} ${p.width} ${p.theme}: ${p.offenders.join('; ')}`);
console.log(`Script errors: ${report.problems.length}`);
for (const p of report.problems) console.log(`  ${p}`);
console.log(`Keyboard: ${report.keyboard.tabs} Tab stops on the day view, ${report.keyboard.withoutRing.length} without a focus ring`);
console.log(`Theme button: ${report.theme.length - themeBad.length} of ${report.theme.length} checks as expected`);
console.log(`Day grid (forced on): fits down to ${report.sweeps.dayGrid.narrowestFit} px, overflows at ${report.sweeps.dayGrid.firstFailure} px; it starts at 768 px`);
console.log(`One-row top bar (forced on, staff): fits down to ${report.sweeps.header.narrowestFit} px, wraps at ${report.sweeps.header.firstFailure} px; it starts at 1024 px`);
console.log(`Screenshots and report.json: ${out}`);
process.exitCode = overflow.length || report.problems.length || report.keyboard.withoutRing.length || themeBad.length ? 1 : 0;
