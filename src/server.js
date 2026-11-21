import { checkEnvOrExit } from './config.js';
import { createPool } from './data/db.js';
import { createApp } from './app.js';
import { createModelClient } from './services/suggest.js';
import { createGoogleClient } from './services/google.js';

// First, before the pool, the app or listen: stop with one line per missing or wrong variable (names only).
checkEnvOrExit();

const port = Number(process.env.PORT) || 3000;
const model = createModelClient();
const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
const google = createGoogleClient({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: base && `${base}/api/auth/google/callback`,
});
const app = createApp({ db: createPool(), secureCookies: process.env.NODE_ENV === 'production', model, google });

app.listen(port, () => {
  console.log(`LabSpot listening on http://localhost:${port}`);
  console.log(model ? `Suggestions: on (${model.model})` : 'Suggestions: off (no model key), so the fallback is shown');
  console.log(google ? `Sign in with Google: on (${base}/api/auth/google/callback)` : 'Sign in with Google: off (no client id, secret or PUBLIC_BASE_URL)');
});
