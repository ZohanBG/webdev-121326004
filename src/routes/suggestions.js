import express from 'express';
import { suggestSlot } from '../services/suggest.js';

const router = express.Router();

// Always 200 with { suggestion } or { suggestion: null, message }: a model that is down is not an error the user caused.
router.post('/', async (req, res) => {
  const { db, model, now } = req.app.locals;
  res.json(await suggestSlot(db, req.user, req.body, { client: model, now: now() }));
});

export default router;
