// Sign in with Google and the account page through real HTTP requests, with a fake Google client.
import { describe, test, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { freshDb, startApp, login, PASSWORD, STUDENT } from './helpers.js';

let db;
let app;
afterEach(async () => {
  await app.close();
  await db.close();
});

/** A fake Google: it accepts a code only together with the verifier whose challenge the app sent at the start. */
function fakeGoogle(profiles) {
  const challenges = new Map();
  return {
    authUrl: ({ state, codeChallenge }) => {
      challenges.set(state, codeChallenge);
      return `https://accounts.example/auth?state=${state}`;
    },
    exchangeCode: async ({ code, codeVerifier }) => {
      const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
      if (![...challenges.values()].includes(challenge)) throw new Error('PKCE mismatch');
      return profiles[code];
    },
  };
}

async function start(google) {
  db = await freshDb();
  app = await startApp(db, { google });
}

/** Runs the browser's part: start, follow Google back to the callback with `code`, keep the cookies. */
async function googleSignIn(code, { tamperState = false } = {}) {
  const begin = await fetch(`${app.base}/api/auth/google`, { redirect: 'manual' });
  const state = new URL(begin.headers.get('location')).searchParams.get('state');
  const stateCookie = begin.headers.get('set-cookie').split(';')[0];
  const back = await fetch(`${app.base}/api/auth/google/callback?code=${code}&state=${tamperState ? 'forged' : state}`, {
    headers: { cookie: stateCookie },
    redirect: 'manual',
  });
  const session = (back.headers.getSetCookie?.() ?? [back.headers.get('set-cookie')]).find((c) => c?.startsWith('labspot_session=') && !c.startsWith('labspot_session=;'));
  return { begin, back, cookie: session?.split(';')[0] ?? null };
}

describe('Sign in with Google', () => {
  test('starting sends the browser to Google with a state, and keeps the state in an HttpOnly cookie', async () => {
    await start(fakeGoogle({}));
    const begin = await fetch(`${app.base}/api/auth/google`, { redirect: 'manual' });
    expect(begin.status).toBe(302);
    expect(begin.headers.get('location')).toMatch(/^https:\/\/accounts\.example\/auth\?state=[\w-]{43}$/);
    expect(begin.headers.get('set-cookie')).toMatch(/^labspot_oauth_state=[\w-]{43};.*HttpOnly/);
  });

  test('AC-19 a password account that signs in with Google lands on the same account and bookings; one users row, one Google identity, and the old password no longer works', async () => {
    await start(fakeGoogle({ good: { sub: 'g-1', email: STUDENT, emailVerified: true } }));
    const { cookie: before } = await login(app.base);
    await fetch(`${app.base}/api/bookings`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: before },
      body: JSON.stringify({ workstationId: 1, date: nextWeekday(), block: 6 }),
    });

    const { back, cookie } = await googleSignIn('good');
    expect(back.status).toBe(302);
    expect(back.headers.get('location')).toBe('/labs');
    const me = await (await fetch(`${app.base}/api/auth/me`, { headers: { cookie } })).json();
    expect(me.user.email).toBe(STUDENT);
    expect(await (await fetch(`${app.base}/api/bookings`, { headers: { cookie } })).json()).toHaveLength(1);

    expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email = $1', [STUDENT])).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM identities WHERE provider = 'google'")).rows[0].n).toBe(1);
    expect((await login(app.base, STUDENT, PASSWORD)).res.status).toBe(401);
  });

  test('AC-20 after Google, a new password set at /account signs in to the same account with the same bookings', async () => {
    await start(fakeGoogle({ good: { sub: 'g-1', email: STUDENT, emailVerified: true } }));
    const { cookie } = await googleSignIn('good');
    expect((await fetch(`${app.base}/account`, { headers: { cookie } })).status).toBe(200);
    expect(await (await fetch(`${app.base}/api/account`, { headers: { cookie } })).json())
      .toEqual({ email: STUDENT, role: 'student', hasPassword: false, providers: ['google'] });

    const set = await fetch(`${app.base}/api/account/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ password: 'my-new-password-1' }),
    });
    expect(set.status).toBe(204);
    await fetch(`${app.base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
    const again = await login(app.base, STUDENT, 'my-new-password-1');
    expect(again.res.status).toBe(200);
    expect((await again.res.json()).user.email).toBe(STUDENT);
  });

  test('AC-21 a Google email that Google has not verified is not linked: back to /login with a readable refusal, no session, no identity row', async () => {
    await start(fakeGoogle({ unverified: { sub: 'g-2', email: STUDENT, emailVerified: false } }));
    const { back, cookie } = await googleSignIn('unverified');
    expect(back.status).toBe(302);
    expect(decodeURIComponent(back.headers.get('location')))
      .toBe('/login?error=Google has not verified this email address, so LabSpot cannot sign you in with it.');
    expect(cookie).toBeNull();
    expect((await db.query('SELECT count(*)::int AS n FROM identities')).rows[0].n).toBe(0);
  });

  test('a callback whose state does not match the cookie is refused, as is a cancelled sign-in', async () => {
    await start(fakeGoogle({ good: { sub: 'g-1', email: STUDENT, emailVerified: true } }));
    const { back, cookie } = await googleSignIn('good', { tamperState: true });
    expect(decodeURIComponent(back.headers.get('location'))).toBe('/login?error=The sign-in with Google could not be confirmed. Try again.');
    expect(cookie).toBeNull();
    const cancelled = await fetch(`${app.base}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(decodeURIComponent(cancelled.headers.get('location'))).toBe('/login?error=Sign in with Google was cancelled.');
  });

  test('without Google set up, both steps send the person back to /login with a readable message', async () => {
    await start(null);
    for (const path of ['/api/auth/google', '/api/auth/google/callback?code=x&state=y']) {
      const res = await fetch(`${app.base}${path}`, { redirect: 'manual' });
      expect(decodeURIComponent(res.headers.get('location')))
        .toBe('/login?error=Sign in with Google is not set up on this server. Sign in with your password.');
    }
  });

  test('a failure that is not a refusal is a real error: 500, with no details shown', async () => {
    const google = fakeGoogle({});
    await start(google);
    await db.query('DROP TABLE oauth_attempts');
    const res = await fetch(`${app.base}/api/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Something went wrong on our side. Try again.' });
  });
});

describe('/account', () => {
  test('AC-39 changing an existing password with a wrong current password gets 403 "Your current password is not right." and password_hash does not change; 400 for a short new one', async () => {
    await start(null);
    const { cookie } = await login(app.base);
    const post = (body) => fetch(`${app.base}/api/account/password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body),
    });
    const hash = async () => (await db.query('SELECT password_hash FROM users WHERE email = $1', [STUDENT])).rows[0].password_hash;
    const before = await hash();
    const wrong = await post({ password: 'another-password-1', currentPassword: 'not-my-password' });
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: 'Your current password is not right.' });
    expect(await hash()).toBe(before);
    expect((await post({ password: 'another-password-1' })).status).toBe(403);
    expect((await post({ password: 'short', currentPassword: PASSWORD })).status).toBe(400);
    expect((await post({ password: 'another-password-1', currentPassword: PASSWORD })).status).toBe(204);
    expect((await fetch(`${app.base}/api/account`)).status).toBe(401);
  });
});

function nextWeekday() {
  const d = new Date();
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
