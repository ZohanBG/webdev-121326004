import express from 'express';
import { listDay } from '../services/bookings.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await listDay(req.app.locals.db, req.user, req.query.date, req.app.locals.now()));
});

export default router;
