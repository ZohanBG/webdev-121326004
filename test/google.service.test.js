// Sign in with Google and account linking, called directly on the services. Google itself is never called:
// the flow uses a fake client, and the real client talks to a local stand-in for Google's token endpoint.
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { signIn, userForSession } from '../src/services/auth.js';
import { startGoogleSignIn, finishGoogleSignIn, signInWithGoogle, createGoogleClient } from '../src/services/google.js';
import { setPassword, getAccount } from '../src/services/account.js';
import { createBooking, listMine } from '../src/services/bookings.js';
import { freshDb, userByEmail, workstationIds, PASSWORD, STUDENT } from './helpers.js';

const NOW = new Date('2026-11-23T07:30:00Z');

let db;
beforeEach(async () => {
  db = await freshDb();
});
afterEach(async () => {
  await db.close();
});

const identities = async () => (await db.query('SELECT user_id, provider, provider_account_id FROM identities ORDER BY id')).rows;
const usersWith = async (email) => (await db.query('SELECT id, password_hash FROM users WHERE lower(email) = lower($1)', [email])).rows;
const base64url = (buffer) => buffer.toString('base64url');

describe('linking rules', () => {
  test('AC-19 a password account that signs in with Google (same verified email) stays one account with the same bookings; the old password stops working', async () => {
    const student = await userByEmail(db, STUDENT);
    const ws = await workstationIds(db);
    const booking = await createBooking(db, student, { workstationId: ws.NL01, date: '2026-11-24', block: 3 }, NOW);
    const before = await signIn(db, { email: STUDENT, password: PASSWORD });

    const { user, token } = await signInWithGoogle(db, { sub: 'g-123', email: 'Student@LabSpot.test', emailVerified: true });

    expect(user.id).toBe(student.id);
    expect(await usersWith(STUDENT)).toEqual([{ id: student.id, password_hash: null }]);
    expect(await identities()).toEqual([{ user_id: student.id, provider: 'google', provider_account_id: 'g-123' }]);
    await expect(signIn(db, { email: STUDENT, password: PASSWORD })).rejects.toMatchObject({ name: 'WrongCredentials' });
    expect(await userForSession(db, before.token)).toBeNull(); // the other session ended
    expect(await userForSession(db, token)).toMatchObject({ id: student.id });
    expect((await listMine(db, user, NOW)).map((b) => b.id)).toEqual([booking.id]);
  });

  test('AC-19 a returning Google user is found by their Google id, even after changing their email at Google', async () => {
    const first = await signInWithGoogle(db, { sub: 'g-777', email: 'new@labspot.test', emailVerified: true });
    const again = await signInWithGoogle(db, { sub: 'g-777', email: 'renamed@labspot.test', emailVerified: true });
    expect(again.user.id).toBe(first.user.id);
    expect(await identities()).toHaveLength(1);
  });

  test('a second Google account with the same verified email links to the same user, and leaves that user signed in elsewhere', async () => {
    const first = await signInWithGoogle(db, { sub: 'g-A', email: 'two@labspot.test', emailVerified: true });
    const second = await signInWithGoogle(db, { sub: 'g-B', email: 'two@labspot.test', emailVerified: true });
    expect(second.user.id).toBe(first.user.id);
    expect((await identities()).map((i) => i.provider_account_id)).toEqual(['g-A', 'g-B']);
    expect(await userForSession(db, first.token)).toMatchObject({ id: first.user.id }); // no password was cleared, so no session ended
  });

  test('a verified email with no account becomes a new student account with no password', async () => {
    const { user } = await signInWithGoogle(db, { sub: 'g-555', email: 'Fresh@LabSpot.test', emailVerified: true });
    expect(user).toMatchObject({ email: 'fresh@labspot.test', role: 'student' });
    expect(await usersWith('fresh@labspot.test')).toEqual([{ id: user.id, password_hash: null }]);
  });

  test('AC-21 a Google sign-in whose email Google has not verified is not linked to an existing account, and is refused', async () => {
    await expect(signInWithGoogle(db, { sub: 'g-999', email: STUDENT, emailVerified: false }))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'Google has not verified this email address, so LabSpot cannot sign you in with it.' });
    expect(await identities()).toEqual([]);
    expect((await usersWith(STUDENT))[0].password_hash).not.toBeNull();
    await expect(signInWithGoogle(db, { sub: 'g-998', email: 'nobody@labspot.test', emailVerified: false }))
      .rejects.toMatchObject({ name: 'Forbidden' });
    expect(await usersWith('nobody@labspot.test')).toEqual([]);
  });
});

describe('setting a password at /account', () => {
  test('AC-20 a person signed in through Google sets a new password, and then signs in with email and password to the same account', async () => {
    const { user } = await signInWithGoogle(db, { sub: 'g-123', email: STUDENT, emailVerified: true });
    expect(await getAccount(db, user)).toEqual({ email: STUDENT, role: 'student', hasPassword: false, providers: ['google'] });

    await setPassword(db, user, { password: 'a-brand-new-password' });
    const again = await signIn(db, { email: STUDENT, password: 'a-brand-new-password' });
    expect(again.user.id).toBe(user.id);
    expect(await getAccount(db, user)).toMatchObject({ hasPassword: true });
  });

  test('AC-20 a password shorter than 10 characters is refused, and changing an existing password needs the current one', async () => {
    const student = await userByEmail(db, STUDENT);
    await expect(setPassword(db, student, { password: 'short' }))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'The new password needs at least 10 characters.' });
    await expect(setPassword(db, student, { password: 'another-long-one' }))
      .rejects.toMatchObject({ name: 'Forbidden', message: 'Your current password is not right.' });
    await setPassword(db, student, { password: 'another-long-one', currentPassword: PASSWORD });
    await expect(signIn(db, { email: STUDENT, password: 'another-long-one' })).resolves.toMatchObject({ user: { id: student.id } });
    await expect(setPassword(db, null, { password: 'x' })).rejects.toMatchObject({ name: 'NotSignedIn' });
    await expect(setPassword(db, student, undefined)).rejects.toMatchObject({ name: 'InvalidInput' });
    await expect(getAccount(db, null)).rejects.toMatchObject({ name: 'NotSignedIn' });
  });
});

describe('the flow: state and PKCE', () => {
  /** A fake Google that checks the PKCE pair and answers with the profile stored for each code. */
  function fakeGoogle(profiles) {
    const seen = [];
    return {
      seen,
      authUrl: ({ state, codeChallenge }) => `https://accounts.example/auth?state=${state}&code_challenge=${codeChallenge}`,
      exchangeCode: async ({ code, codeVerifier }) => {
        seen.push({ code, codeVerifier });
        if (!profiles[code]) throw new Error('invalid_grant');
        return profiles[code];
      },
    };
  }
  const paramsOf = (url) => new URL(url).searchParams;

  test('start stores only a hash of the state, and the challenge is the SHA-256 of a verifier that stays on the server', async () => {
    const google = fakeGoogle({});
    const { url, state } = await startGoogleSignIn(db, google, NOW);
    expect(paramsOf(url).get('state')).toBe(state);
    const { rows } = await db.query('SELECT state_hash, code_verifier FROM oauth_attempts');
    expect(rows).toHaveLength(1);
    expect(rows[0].state_hash).toBe(createHash('sha256').update(state).digest('hex'));
    expect(paramsOf(url).get('code_challenge')).toBe(base64url(createHash('sha256').update(rows[0].code_verifier).digest()));
    expect(url).not.toContain(rows[0].code_verifier);
  });

  test('finish signs the person in with the verifier from the start, and a state can be used only once', async () => {
    const google = fakeGoogle({ 'code-1': { sub: 'g-1', email: 'flow@labspot.test', emailVerified: true } });
    const { state } = await startGoogleSignIn(db, google, NOW);
    const { rows: [attempt] } = await db.query('SELECT code_verifier FROM oauth_attempts');

    const session = await finishGoogleSignIn(db, google, { code: 'code-1', state, cookieState: state }, NOW);
    expect(session.user).toMatchObject({ email: 'flow@labspot.test' });
    expect(google.seen).toEqual([{ code: 'code-1', codeVerifier: attempt.code_verifier }]);
    await expect(finishGoogleSignIn(db, google, { code: 'code-1', state, cookieState: state }, NOW))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'The sign-in with Google could not be confirmed. Try again.' });
  });

  test('finish refuses a state that does not match the browser cookie, a missing state, and an expired one', async () => {
    const google = fakeGoogle({ c: { sub: 'g', email: 'x@labspot.test', emailVerified: true } });
    const { state } = await startGoogleSignIn(db, google, NOW);
    for (const input of [{ code: 'c', state, cookieState: 'other' }, { code: 'c', state: undefined, cookieState: undefined }, { code: '', state, cookieState: state }]) {
      await expect(finishGoogleSignIn(db, google, input, NOW)).rejects.toMatchObject({ name: 'InvalidInput' });
    }
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    await expect(finishGoogleSignIn(db, google, { code: 'c', state, cookieState: state }, later))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'The sign-in with Google could not be confirmed. Try again.' });
    expect(google.seen).toEqual([]);
  });

  test('when Google refuses the code, the person is told to try again or use their password', async () => {
    const google = fakeGoogle({});
    const { state } = await startGoogleSignIn(db, google, NOW);
    await expect(finishGoogleSignIn(db, google, { code: 'bad', state, cookieState: state }, NOW))
      .rejects.toMatchObject({ name: 'InvalidInput', message: 'Sign in with Google did not work. Try again, or sign in with your password.' });
  });
});

describe('the real Google client', () => {
  const CONFIG = { clientId: 'client-1', clientSecret: 'secret-1', redirectUri: 'https://labspot.example/api/auth/google/callback' };
  const idToken = (claims) => `${base64url(Buffer.from('{"alg":"RS256"}'))}.${base64url(Buffer.from(JSON.stringify(claims)))}.signature`;
  const claims = (extra = {}) => ({
    iss: 'https://accounts.google.com', aud: 'client-1', sub: 'g-42', email: 'Ana@Example.com', email_verified: true,
    exp: Math.floor(NOW.getTime() / 1000) + 3600, ...extra,
  });

  async function standIn(status, body) {
    const received = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        received.push({ type: req.headers['content-type'], form: Object.fromEntries(new URLSearchParams(raw)) });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { received, url: `http://127.0.0.1:${server.address().port}/token`, close: () => new Promise((r) => server.close(r)) };
  }

  test('is off when the client id, the secret or the public address is missing', () => {
    expect(createGoogleClient({ ...CONFIG, clientId: '' })).toBeNull();
    expect(createGoogleClient({ ...CONFIG, clientSecret: undefined })).toBeNull();
    expect(createGoogleClient({ ...CONFIG, redirectUri: '' })).toBeNull();
  });

  test('builds the authorization address with the code flow, S256 PKCE, the state and openid email', () => {
    const url = new URL(createGoogleClient(CONFIG).authUrl({ state: 'st', codeChallenge: 'ch' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client-1', redirect_uri: CONFIG.redirectUri, response_type: 'code', scope: 'openid email',
      state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', prompt: 'select_account',
    });
  });

  test('exchanges the code with the verifier and secret on the server, and reads the ID token it gets back', async () => {
    const google = await standIn(200, { id_token: idToken(claims()) });
    const client = createGoogleClient({ ...CONFIG, tokenUrl: google.url, now: () => NOW });
    const profile = await client.exchangeCode({ code: 'code-9', codeVerifier: 'verifier-9' });
    await google.close();

    expect(profile).toEqual({ sub: 'g-42', email: 'ana@example.com', emailVerified: true });
    expect(google.received[0].type).toBe('application/x-www-form-urlencoded');
    expect(google.received[0].form).toEqual({
      code: 'code-9', code_verifier: 'verifier-9', client_id: 'client-1', client_secret: 'secret-1',
      redirect_uri: CONFIG.redirectUri, grant_type: 'authorization_code',
    });
  });

  test('refuses a token for another app, from another issuer, expired, or an error answer', async () => {
    for (const [status, body] of [
      [200, { id_token: idToken(claims({ aud: 'someone-else' })) }],
      [200, { id_token: idToken(claims({ iss: 'https://evil.example' })) }],
      [200, { id_token: idToken(claims({ exp: Math.floor(NOW.getTime() / 1000) - 10 })) }],
      [200, { id_token: 'not-a-jwt' }],
      [400, { error: 'invalid_grant' }],
    ]) {
      const google = await standIn(status, body);
      const client = createGoogleClient({ ...CONFIG, tokenUrl: google.url, now: () => NOW });
      await expect(client.exchangeCode({ code: 'c', codeVerifier: 'v' })).rejects.toThrow();
      await google.close();
    }
  });

  test('without a clock passed in, token expiry is checked against the real time, as in production', async () => {
    const realNow = Math.floor(Date.now() / 1000);
    for (const [exp, ok] of [[realNow + 3600, true], [realNow - 10, false]]) {
      const google = await standIn(200, { id_token: idToken(claims({ exp })) });
      const client = createGoogleClient({ ...CONFIG, tokenUrl: google.url });
      const result = client.exchangeCode({ code: 'c', codeVerifier: 'v' });
      if (ok) await expect(result).resolves.toMatchObject({ sub: 'g-42' });
      else await expect(result).rejects.toThrow('ID token expired');
      await google.close();
    }
  });

  test('an unverified email from Google arrives as emailVerified false', async () => {
    const google = await standIn(200, { id_token: idToken(claims({ email_verified: false, iss: 'accounts.google.com' })) });
    const client = createGoogleClient({ ...CONFIG, tokenUrl: google.url, now: () => NOW });
    expect(await client.exchangeCode({ code: 'c', codeVerifier: 'v' })).toMatchObject({ emailVerified: false });
    await google.close();
  });
});
