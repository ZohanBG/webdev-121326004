// The top bar every signed-in page shares: links for the user's role, and Sign out.
import { api, signOut } from './api.js';

const LINKS = {
  student: [['/labs', 'Labs'], ['/day', 'Day'], ['/my-bookings', 'My bookings']],
  staff: [['/labs', 'Labs'], ['/day', 'Day']],
};

/** Fills <nav id="nav"> and returns the signed-in user, or sends a visitor to /login. */
export async function renderNav() {
  document.querySelector('#sign-out').addEventListener('click', signOut);
  const me = await api('/api/auth/me');
  if (me.status === 401) {
    location.assign('/login');
    return null;
  }
  const user = me.ok ? me.data.user : null;
  const links = (LINKS[user?.role] ?? LINKS.student).map(([href, label]) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (location.pathname === href) a.setAttribute('aria-current', 'page');
    return a;
  });
  document.querySelector('#nav').replaceChildren(...links);
  return user;
}
