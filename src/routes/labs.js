import express from 'express';
import { listLabs, addLab } from '../services/labs.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.json(await listLabs(req.app.locals.db, req.user));
});

router.post('/', async (req, res) => {
  res.status(201).json(await addLab(req.app.locals.db, req.user, req.body));
});

export default router;
