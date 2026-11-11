import { join } from 'node:path';
import express from 'express';

const router = express.Router();
const page = (name) => join(import.meta.dirname, '..', '..', 'public', name);

// Pages are reached by their clean path only, so /labs.html cannot skip the sign-in check below.
router.use((req, res, next) => (req.path.endsWith('.html') ? res.redirect(301, req.path.slice(0, -'.html'.length)) : next()));

router.get('/', (req, res) => res.redirect(req.user ? '/labs' : '/login'));
router.get('/login', (req, res) => (req.user ? res.redirect('/labs') : res.sendFile(page('login.html'))));
router.get('/labs', (req, res) => (req.user ? res.sendFile(page('labs.html')) : res.redirect('/login')));

export default router;
