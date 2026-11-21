// The only place that turns an error into a status code.
// Every error reaches the client as { "error": "<readable sentence>" }; none ever carries a stack trace (AC-44).
import { join } from 'node:path';
import { InvalidInput, WrongCredentials, NotSignedIn, Forbidden, NotFound, Conflict, TooManyAttempts } from '../services/errors.js';

const STATUS = [
  [InvalidInput, 400],
  [WrongCredentials, 401],
  [NotSignedIn, 401],
  [Forbidden, 403],
  [NotFound, 404],
  [Conflict, 409],
  [TooManyAttempts, 429],
];

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

/** Any other unknown path (AC-43): a page for a browser, the usual JSON for everything else. */
export function notFoundPage(req, res) {
  res.status(404);
  if (req.accepts(['json', 'html']) === 'html') return res.sendFile(join(import.meta.dirname, '..', '..', 'public', 'not-found.html'));
  res.json({ error: 'Not found.' });
}

// Express recognises an error handler by its four parameters, so `next` stays even though it is unused.
export function errorHandler(error, req, res, next) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The request body is too large.' });
  }
  const known = STATUS.find(([Class]) => error instanceof Class);
  if (known) return res.status(known[1]).json({ error: error.message });

  // other mistakes the request itself made (an unsupported encoding, an aborted upload) keep their 4xx status
  const status = error.status ?? error.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return res.status(status).json({ error: 'That request is not valid.' });
  }

  console.error(error);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
}
