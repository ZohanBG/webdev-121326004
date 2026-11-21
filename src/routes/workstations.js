import express from 'express';
import { addWorkstation, updateWorkstation } from '../services/workstations.js';

const router = express.Router();

router.post('/', async (req, res) => {
  res.status(201).json(await addWorkstation(req.app.locals.db, req.user, req.body));
});

router.patch('/:id', async (req, res) => {
  res.json(await updateWorkstation(req.app.locals.db, req.user, req.params.id, req.body, req.app.locals.now()));
});

export default router;
