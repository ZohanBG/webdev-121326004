import { join } from 'node:path';
import express from 'express';
import { loadUser, requireSignIn } from './routes/session.js';
import authRoutes from './routes/auth.js';
import labRoutes from './routes/labs.js';
import pageRoutes from './routes/pages.js';
import { notFound, errorHandler } from './routes/errors.js';

/** The whole app, with the database passed in: a pg Pool in production, PGlite in tests. */
export function createApp({ db, secureCookies = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.secureCookies = secureCookies;

  app.use(express.json({ limit: '10kb' }));
  app.use(loadUser);

  app.use('/api/auth', authRoutes);
  app.use('/api/labs', requireSignIn, labRoutes);
  app.use('/api', notFound);

  app.use(pageRoutes);
  app.use(express.static(join(import.meta.dirname, '..', 'public'), { index: false }));

  app.use(errorHandler);
  return app;
}
