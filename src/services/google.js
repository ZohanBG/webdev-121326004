// Sign in with Google: the authorization-code flow on the server, with state and PKCE, and the
// linking rules from SPEC.md (Auth). Google is reached only through the client below, so tests can
// pass a fake one, and the real one can be pointed at a local stand-in.
import crypto from 'node:crypto';
import { transaction } from '../data/db.js';
import * as users from '../data/users.js';
import * as sessions from '../data/sessions.js';
import * as identities from '../data/identities.js';
import * as attempts from '../data/oauthAttempts.js';
import { InvalidInput, Forbidden } from './errors.js';
import { openSession, hashToken } from './auth.js';

const ATTEMPT_MINUTES = 10;
const NOT_CONFIRMED = 'The sign-in with Google could not be confirmed. Try again.';
const GOOGLE_FAILED = 'Sign in with Google did not work. Try again, or sign in with your password.';
const NOT_VERIFIED = 'Google has not verified this email address, so LabSpot cannot sign you in with it.';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const randomString = () => crypto.randomBytes(32).toString('base64url');
const challengeFor = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

/**
 * The real client, or null when Google sign-in is not set up (no client id, secret or public address).
 * The secret is used only here, on the server, in the code exchange.
 */
export function createGoogleClient({
  clientId,
  clientSecret,
  redirectUri,
  tokenUrl = 'https://oauth2.googleapis.com/token',
  now = () => new Date(),
}) {
  if (!clientId || !clientSecret || !redirectUri) return null;
  return {
    authUrl({ state, codeChallenge }) {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },

    /**
     * Swaps the code for an ID token. The token comes straight from Google's token endpoint over
     * HTTPS, so its claims are read without checking the signature, as Google's documentation allows,
     * but who issued it, for which app, and until when are still checked.
     */
    async exchangeCode({ code, codeVerifier }) {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, code_verifier: codeVerifier, client_id: clientId, client_secret: clientSecret,
          redirect_uri: redirectUri, grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`token endpoint answered ${res.status}`);
      const { id_token: idToken } = await res.json();
      const claims = JSON.parse(Buffer.from(String(idToken).split('.')[1] ?? '', 'base64url').toString('utf8'));
      if (!ISSUERS.includes(claims.iss)) throw new Error('ID token from another issuer');
      if (claims.aud !== clientId) throw new Error('ID token for another app');
      if (claims.exp * 1000 <= now().getTime()) throw new Error('ID token expired');
      return { sub: claims.sub, email: String(claims.email).toLowerCase(), emailVerified: claims.email_verified === true };
    },
  };
}

/** Step 1: a fresh state and PKCE pair. Only the state's hash is stored; the verifier never leaves the server. */
export async function startGoogleSignIn(db, google, now = new Date()) {
  const state = randomString();
  const codeVerifier = randomString();
  await attempts.insert(db, { stateHash: hashToken(state), codeVerifier, expiresAt: new Date(now.getTime() + ATTEMPT_MINUTES * 60 * 1000) });
  return { state, url: google.authUrl({ state, codeChallenge: challengeFor(codeVerifier) }) };
}

/** Step 2: Google sent the browser back. The state must match the cookie set in step 1, and works once. */
export async function finishGoogleSignIn(db, google, { code, state, cookieState } = {}, now = new Date()) {
  if (!code || !state || state !== cookieState) throw new InvalidInput(NOT_CONFIRMED);
  const codeVerifier = await attempts.take(db, hashToken(state), now);
  if (!codeVerifier) throw new InvalidInput(NOT_CONFIRMED);
  let profile;
  try {
    profile = await google.exchangeCode({ code, codeVerifier });
  } catch {
    throw new InvalidInput(GOOGLE_FAILED);
  }
  return signInWithGoogle(db, profile);
}

/**
 * The linking rules. A known Google account signs in to its user. Otherwise a verified email is linked
 * to the account with that email, or becomes a new student account. Linking clears a password set
 * before (local sign-up does not verify email, so whoever set it may not own the address) and ends that
 * account's other sessions. An unverified email is never linked or used.
 */
export async function signInWithGoogle(db, { sub, email, emailVerified }) {
  return transaction(db, async (conn) => {
    const known = await identities.findUser(conn, 'google', sub);
    if (known) return openSession(conn, known);
    if (!emailVerified) throw new Forbidden(NOT_VERIFIED);

    const address = String(email).trim().toLowerCase();
    let user = await users.findByEmail(conn, address);
    if (user) {
      if (user.password_hash) {
        await users.setPasswordHash(conn, user.id, null);
        await sessions.removeAllForUser(conn, user.id);
      }
    } else {
      user = await users.insert(conn, { email: address, role: 'student' });
    }
    await identities.insert(conn, { userId: user.id, provider: 'google', accountId: sub });
    return openSession(conn, user);
  });
}
