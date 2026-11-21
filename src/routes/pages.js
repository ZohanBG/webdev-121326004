import { join } from 'node:path';
import express from 'express';

const router = express.Router();
const page = (name) => join(import.meta.dirname, '..', '..', 'public', name);

// Pages are reached by their clean path only, so /labs.html cannot skip the sign-in check below.
router.use((req, res, next) => (req.path.endsWith('.html') ? res.redirect(301, req.path.slice(0, -'.html'.length)) : next()));

/** A page for signed-in users; everyone else is sent to /login. */
const signedIn = (file) => (req, res) => (req.user ? res.sendFile(page(file)) : res.redirect('/login'));

/** A page for lab staff; a student gets 403 with a page that says so. */
const staffOnly = (file) => (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'staff') return res.status(403).sendFile(page('forbidden.html'));
  res.sendFile(page(file));
};

router.get('/', (req, res) => res.redirect(req.user ? '/labs' : '/login'));
router.get('/login', (req, res) => (req.user ? res.redirect('/labs') : res.sendFile(page('login.html'))));
router.get('/labs', signedIn('labs.html'));
router.get('/day', signedIn('day.html'));
router.get('/my-bookings', signedIn('my-bookings.html'));
router.get('/account', signedIn('account.html'));
router.get('/staff/labs', staffOnly('staff-labs.html'));
router.get('/staff/bookings', staffOnly('staff-bookings.html'));

export default router;
