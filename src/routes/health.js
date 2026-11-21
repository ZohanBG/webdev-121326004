// GET /health: public, for Render's health check and for people. 200 or 503, never details (AC-42).
import express from 'express';
import { checkHealth } from '../services/health.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { db, healthTimeoutMs } = req.app.locals;
  const { ok, body } = await checkHealth(db, { timeoutMs: healthTimeoutMs });
  res.set('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json(body);
});

export default router;
