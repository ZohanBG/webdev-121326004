// Staff views. Whether the caller is staff is the services' call (403), never this file's.
import express from 'express';
import { listLabsForStaff } from '../services/labs.js';
import { listAllForDay } from '../services/bookings.js';

const router = express.Router();

router.get('/labs', async (req, res) => {
  res.json(await listLabsForStaff(req.app.locals.db, req.user));
});

router.get('/bookings', async (req, res) => {
  res.json(await listAllForDay(req.app.locals.db, req.user, req.query.date));
});

export default router;
