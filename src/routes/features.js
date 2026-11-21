import express from 'express';
import { listFeatures } from '../services/features.js';

const router = express.Router();

// The fixed feature list for the pages. Not secret, so no sign-in is needed.
router.get('/', (req, res) => {
  res.json(listFeatures());
});

export default router;
