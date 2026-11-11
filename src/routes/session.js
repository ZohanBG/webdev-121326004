import { userForSession } from '../services/auth.js';

export const COOKIE = 'labspot_session';
const TOKEN = /^[0-9a-f]{64}$/;

function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

const cookieOptions = (req) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: Boolean(req.app.locals.secureCookies),
  path: '/',
});

export function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE, token, { ...cookieOptions(req), expires: expiresAt });
}

export function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE, cookieOptions(req));
}

/** 401 for an API call without a session, before any service is called. */
export function requireSignIn(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
  next();
}

/** Puts the signed-in user, or null, on req.user for every request. */
export async function loadUser(req, res, next) {
  const token = readCookie(req.headers.cookie, COOKIE);
  req.sessionToken = token && TOKEN.test(token) ? token : null;
  req.user = req.sessionToken ? await userForSession(req.app.locals.db, req.sessionToken) : null;
  next();
}
