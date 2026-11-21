import express from 'express';
import { signIn, signOut } from '../services/auth.js';
import { setSessionCookie, clearSessionCookie, requireSignIn } from './session.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  // req.ip is the caller's address as the proxy reports it (trust proxy 1, src/app.js)
  const { token, expiresAt, user } = await signIn(req.app.locals.db, req.body ?? {}, { ip: req.ip, now: req.app.locals.now() });
  setSessionCookie(req, res, token, expiresAt);
  res.json({ user });
});

router.post('/logout', async (req, res) => {
  if (req.sessionToken) await signOut(req.app.locals.db, req.sessionToken);
  clearSessionCookie(req, res);
  res.status(204).end();
});

/** Who is signed in, so a page can show the right navigation. */
router.get('/me', requireSignIn, (req, res) => {
  res.json({ user: req.user });
});

export default router;
