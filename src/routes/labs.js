import express from 'express';
import { listLabs } from '../services/labs.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await listLabs(req.app.locals.db, req.user));
});

export default router;
