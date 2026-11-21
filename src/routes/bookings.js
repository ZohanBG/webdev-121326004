import express from 'express';
import { createBooking, cancelBooking, listMine } from '../services/bookings.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await listMine(req.app.locals.db, req.user, req.app.locals.now()));
});

router.post('/', async (req, res) => {
  res.status(201).json(await createBooking(req.app.locals.db, req.user, req.body, req.app.locals.now()));
});

router.delete('/:id', async (req, res) => {
  await cancelBooking(req.app.locals.db, req.user, req.params.id, req.app.locals.now());
  res.status(204).end();
});

export default router;
