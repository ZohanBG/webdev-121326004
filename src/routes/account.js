import express from 'express';
import { getAccount, setPassword } from '../services/account.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await getAccount(req.app.locals.db, req.user));
});

router.post('/password', async (req, res) => {
  // the session this change comes from stays; every other session of the account ends (AC-46)
  await setPassword(req.app.locals.db, req.user, req.body, { keepToken: req.sessionToken });
  res.status(204).end();
});

export default router;
