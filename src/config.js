// The start-up check: the environment variables the app needs, and what is wrong with them.
// It answers with variable NAMES only, never a value, so its output is safe in any log.
// src/server.js, scripts/migrate.js and scripts/seed.js run it before they touch anything else.
// Every variable is listed, with where its real value comes from, in .env.example.

/** The DATABASE_URL in .env.example. A copied placeholder must not reach production. */
export const PLACEHOLDER_DATABASE_URL = 'postgres://user:password@host/dbname';

const GOOGLE = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'PUBLIC_BASE_URL'];
const isSet = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

/**
 * What is wrong with `env`, one line per problem, e.g. "missing DATABASE_URL: see .env.example".
 * An empty list means the program may start. The scripts pass `google: false`: they never sign anyone in.
 */
export function envProblems(env = process.env, { google = true } = {}) {
  const problems = [];
  const production = env.NODE_ENV === 'production';

  if (!isSet(env, 'DATABASE_URL')) problems.push('missing DATABASE_URL: see .env.example');
  else if (production && env.DATABASE_URL.trim() === PLACEHOLDER_DATABASE_URL) {
    problems.push('invalid DATABASE_URL: it is still the placeholder from .env.example');
  }

  if (google) {
    // Sign in with Google is all or nothing: a client id or secret without the rest is a mistake, not "off".
    // PUBLIC_BASE_URL alone is fine; it only builds Google's redirect address.
    if (isSet(env, 'GOOGLE_CLIENT_ID') || isSet(env, 'GOOGLE_CLIENT_SECRET')) {
      for (const name of GOOGLE.filter((n) => !isSet(env, n))) {
        problems.push(`missing ${name}: Sign in with Google needs ${GOOGLE.join(', ')} together; see .env.example`);
      }
    }
    if (production && isSet(env, 'PUBLIC_BASE_URL') && !env.PUBLIC_BASE_URL.trim().startsWith('https://')) {
      problems.push('invalid PUBLIC_BASE_URL: it must start with https:// in production');
    }
  }
  return problems;
}

/** Prints one line per problem and stops the program with code 1; returns quietly when there is none. */
export function checkEnvOrExit(options) {
  const problems = envProblems(process.env, options);
  if (problems.length === 0) return;
  for (const line of problems) console.error(line);
  process.exit(1);
}
