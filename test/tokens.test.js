// The dark theme is written twice in public/tokens.css: for the system's setting (prefers-color-scheme)
// and for a dark theme picked with the button in the top bar ([data-theme="dark"]). The copies must match.
import { readFileSync } from 'node:fs';
import { describe, test, expect } from 'vitest';

const css = readFileSync(new URL('../public/tokens.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The declarations inside the first rule whose selector is exactly `selector`. */
function block(selector) {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}
const tokens = (text) => Object.fromEntries([...text.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

describe('the theme tokens', () => {
  test('a dark theme picked in the top bar has exactly the values of the system dark theme', () => {
    const system = tokens(block(':root:not([data-theme="light"])'));
    const picked = tokens(block(':root[data-theme="dark"]'));
    expect(Object.keys(system).length).toBeGreaterThan(20);
    expect(picked).toEqual(system);
  });

  test('the dark theme only changes tokens that the light theme defines', () => {
    const light = tokens(block(':root'));
    const dark = tokens(block(':root[data-theme="dark"]'));
    expect(Object.keys(dark).filter((name) => !(name in light))).toEqual([]);
  });
});
