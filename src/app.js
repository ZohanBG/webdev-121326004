import { join } from 'node:path';
import express from 'express';
import { loadUser, requireSignIn } from './routes/session.js';
import authRoutes from './routes/auth.js';
import labRoutes from './routes/labs.js';
import bookingRoutes from './routes/bookings.js';
import slotRoutes from './routes/slots.js';
import pageRoutes from './routes/pages.js';
import { notFound, errorHandler } from './routes/errors.js';

/**
 * The whole app, with its outside world passed in: the database (a pg Pool in production,
 * PGlite in tests) and the clock (the real time in production, a fixed one in tests).
 */
export function createApp({ db, secureCookies = false, now = () => new Date() }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.secureCookies = secureCookies;
  app.locals.now = now;

  app.use(express.json({ limit: '10kb' }));
  app.use(loadUser);

  app.use('/api/auth', authRoutes);
  app.use('/api/labs', requireSignIn, labRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/slots', slotRoutes);
  app.use('/api', notFound);

  app.use(pageRoutes);
  app.use(express.static(join(import.meta.dirname, '..', 'public'), { index: false }));

  app.use(errorHandler);
  return app;
}
