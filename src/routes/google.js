import express from 'express';
import { startGoogleSignIn, finishGoogleSignIn } from '../services/google.js';
import { ServiceError } from '../services/errors.js';
import { setSessionCookie } from './session.js';

const router = express.Router();
const STATE_COOKIE = 'labspot_oauth_state';

const stateCookieOptions = (req) => ({
  httpOnly: true,
  sameSite: 'lax', // Google sends the browser back with a top-level GET, which Lax allows
  secure: Boolean(req.app.locals.secureCookies),
  path: '/api/auth/google',
});
const backToLogin = (res, message) => res.redirect(`/login?error=${encodeURIComponent(message)}`);

router.get('/', async (req, res) => {
  const { db, google, now } = req.app.locals;
  if (!google) return backToLogin(res, 'Sign in with Google is not set up on this server. Sign in with your password.');
  const { state, url } = await startGoogleSignIn(db, google, now());
  res.cookie(STATE_COOKIE, state, { ...stateCookieOptions(req), maxAge: 10 * 60 * 1000 });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { db, google, now } = req.app.locals;
  res.clearCookie(STATE_COOKIE, stateCookieOptions(req));
  if (!google) return backToLogin(res, 'Sign in with Google is not set up on this server. Sign in with your password.');
  if (req.query.error) return backToLogin(res, 'Sign in with Google was cancelled.');
  try {
    const cookieState = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('='))
      .find(([name]) => name === STATE_COOKIE)?.[1];
    const { token, expiresAt } = await finishGoogleSignIn(db, google, { code: req.query.code, state: req.query.state, cookieState }, now());
    setSessionCookie(req, res, token, expiresAt);
    res.redirect('/labs');
  } catch (error) {
    // a refusal the person should read goes back to the sign-in page; anything else is a real error
    if (error instanceof ServiceError) return backToLogin(res, error.message);
    throw error;
  }
});

export default router;
