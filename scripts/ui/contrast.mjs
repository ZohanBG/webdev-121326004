// WCAG 2.2 contrast ratio of every colour pair the pages use, read straight from public/tokens.css
// (the light values in :root, the dark ones in the dark blocks), printed as the Markdown table in docs/UI.md.
// Text needs 4.5:1; edges of controls and the focus ring (non-text, WCAG 1.4.11) need 3:1.
//   node scripts/ui/contrast.mjs        (exits with 1 if a required pair fails)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../public/tokens.css', import.meta.url), 'utf8');
const darkAt = css.indexOf('@media (prefers-color-scheme: dark)');
const colours = (text) => Object.fromEntries([...text.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = colours(css.slice(0, darkAt));
const dark = { ...light, ...colours(css.slice(darkAt)) };

const lum = (hex) => {
  const [r, g, b] = hex.slice(1).match(/../g).map((h) => parseInt(h, 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, needed, where it is used]
const pairs = [
  ['text', 'bg', 4.5, 'body text on the page'],
  ['text', 'surface', 4.5, 'text on a card'],
  ['muted', 'bg', 4.5, 'intro lines, the cancelled booking'],
  ['muted', 'surface', 4.5, 'muted text on a card, empty states, feature tags'],
  ['muted', 'taken-bg', 4.5, 'neutral badge, time in a Taken block'],
  ['muted', 'yours-bg', 4.5, 'time in a Yours block'],
  ['text', 'taken-bg', 4.5, 'a Taken block'],
  ['text', 'yours-bg', 4.5, 'a hovered chip, the suggestion card'],
  ['primary-hover', 'yours-bg', 4.5, 'Yours, the Suggestion label'],
  ['primary', 'bg', 4.5, 'a link on the page'],
  ['primary', 'surface', 4.5, 'nav links, secondary buttons'],
  ['primary', 'yours-bg', 4.5, 'a hovered nav link or secondary button'],
  ['on-primary', 'primary', 4.5, 'a primary button, a pressed chip'],
  ['on-primary', 'primary-hover', 4.5, 'a hovered primary button or pressed chip'],
  ['error', 'error-bg', 4.5, 'an error notice (and its ! disc, reversed)'],
  ['success', 'success-bg', 4.5, 'a success notice and badge (and the ✓ disc)'],
  ['danger', 'surface', 4.5, 'the Cancel button'],
  ['danger', 'danger-bg', 4.5, 'the Out of service badge'],
  ['danger-hover', 'danger-bg', 4.5, 'a hovered Cancel button'],
  ['border-strong', 'surface', 3, 'edges of inputs, chips, date fields on a card'],
  ['border-strong', 'bg', 3, 'the date field on the page, chips in the editor panel'],
  ['focus', 'bg', 3, 'focus ring on the page'],
  ['focus', 'surface', 3, 'focus ring on a card'],
  ['focus', 'yours-bg', 3, 'focus ring in the suggestion card'],
  ['border', 'surface', null, 'decorative lines only (card edges, dividers)'],
];

let failed = 0;
console.log('| Pair | Used for | Light | Dark | Needs | Result |');
console.log('|---|---|---|---|---|---|');
for (const [fg, bg, need, where] of pairs) {
  const l = ratio(light[fg], light[bg]);
  const d = ratio(dark[fg], dark[bg]);
  const ok = need === null || (l >= need && d >= need);
  if (!ok) failed++;
  const result = need === null ? 'no requirement' : ok ? 'pass' : 'FAIL';
  console.log(`| \`${fg}\` on \`${bg}\` | ${where} | ${l.toFixed(2)}:1 | ${d.toFixed(2)}:1 | ${need === null ? '—' : `${need}:1`} | ${result} |`);
}
console.log(failed ? `\n${failed} required pair(s) fail.` : `\nAll ${pairs.filter((p) => p[2] !== null).length} required pairs pass in both themes.`);
process.exitCode = failed ? 1 : 0;
