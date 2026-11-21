// Light or dark. The default is the system's setting (prefers-color-scheme, in tokens.css); the button in
// the top bar switches to the other theme, and the pick is kept in this browser (localStorage).
// Only a pick that differs from the system is kept, so picking the system's theme again goes back to
// following the system. Loaded as a plain script in <head>, so the theme is set before the page is drawn
// and never flashes the other one.
(() => {
  const KEY = 'labspot-theme';
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');

  // localStorage can be missing or throw (private windows, blocked site data); the theme then lasts for this page
  const read = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const write = (value) => {
    try {
      if (value) localStorage.setItem(KEY, value);
      else localStorage.removeItem(KEY);
    } catch { /* not kept */ }
  };

  const systemTheme = () => (system.matches ? 'dark' : 'light');
  const current = () => root.dataset.theme ?? systemTheme();

  /** The button names the theme it switches to: "☾ Dark" in the light theme, "☀ Light" in the dark one. */
  function label() {
    const button = document.querySelector('#theme-toggle');
    if (!button) return;
    const next = current() === 'dark' ? 'light' : 'dark';
    button.querySelector('.symbol').textContent = next === 'dark' ? '☾' : '☀';
    button.querySelector('.theme-word').textContent = next === 'dark' ? 'Dark' : 'Light';
    button.setAttribute('aria-label', `Switch to the ${next} theme`);
    button.title = `Switch to the ${next} theme`;
  }

  function pick(theme) {
    if (theme === systemTheme()) {
      delete root.dataset.theme;
      write(null);
    } else {
      root.dataset.theme = theme;
      write(theme);
    }
    label();
  }

  const kept = read();
  if (kept === 'light' || kept === 'dark') root.dataset.theme = kept;
  // while following the system, a change there (e.g. the evening switch) changes the button too
  system.addEventListener('change', label);
  document.addEventListener('DOMContentLoaded', () => {
    label();
    document.querySelector('#theme-toggle')?.addEventListener('click', () => pick(current() === 'dark' ? 'light' : 'dark'));
  });
})();
