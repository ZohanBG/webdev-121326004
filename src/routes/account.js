import express from 'express';
import { getAccount, setPassword } from '../services/account.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await getAccount(req.app.locals.db, req.user));
});

router.post('/password', async (req, res) => {
  await setPassword(req.app.locals.db, req.user, req.body);
  res.status(204).end();
});

export default router;
