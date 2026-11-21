// The top bar every signed-in page shares: links for the user's role, who is signed in, and Sign out.
import { api, signOut } from './api.js';
import { el } from './format.js';

const LINKS = {
  student: [['/labs', 'Labs'], ['/day', 'Day'], ['/my-bookings', 'My bookings'], ['/account', 'Account']],
  staff: [['/labs', 'Labs'], ['/day', 'Day'], ['/staff/labs', 'Manage labs'], ['/staff/bookings', 'All bookings'], ['/account', 'Account']],
};

/** Fills <nav id="nav"> and #who, and returns the signed-in user, or sends a visitor to /login. */
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
  const who = document.querySelector('#who');
  if (who && user) {
    // a long email is cut with "…" on a phone; the title and the Account page show all of it
    who.replaceChildren(el('span', 'visually-hidden', 'Signed in as '), user.email);
    who.title = user.email;
  }
  return user;
}
