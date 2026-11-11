// The only place that turns a service error into a status code.
// Every error reaches the client as { "error": "<readable sentence>" }.
import { InvalidInput, WrongCredentials, NotSignedIn } from '../services/errors.js';

const STATUS = [
  [InvalidInput, 400],
  [WrongCredentials, 401],
  [NotSignedIn, 401],
];

export function notFound(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// Express recognises an error handler by its four parameters, so `next` stays even though it is unused.
export function errorHandler(error, req, res, next) {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'The request body is not valid JSON.' });
  }
  const known = STATUS.find(([Class]) => error instanceof Class);
  if (known) return res.status(known[1]).json({ error: error.message });

  console.error(error);
  res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
}
