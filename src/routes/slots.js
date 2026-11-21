import express from 'express';
import { listDay } from '../services/bookings.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { date, features } = req.query;
  res.json(await listDay(req.app.locals.db, req.user, date, req.app.locals.now(), { features }));
});

export default router;
