import express from 'express';
import { signIn, signOut } from '../services/auth.js';
import { setSessionCookie, clearSessionCookie } from './session.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  const { token, expiresAt, user } = await signIn(req.app.locals.db, req.body ?? {});
  setSessionCookie(req, res, token, expiresAt);
  res.json({ user });
});

router.post('/logout', async (req, res) => {
  if (req.sessionToken) await signOut(req.app.locals.db, req.sessionToken);
  clearSessionCookie(req, res);
  res.status(204).end();
});

export default router;
