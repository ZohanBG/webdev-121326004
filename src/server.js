import { createPool } from './data/db.js';
import { createApp } from './app.js';
import { createModelClient } from './services/suggest.js';

const port = Number(process.env.PORT) || 3000;
const model = createModelClient();
const app = createApp({ db: createPool(), secureCookies: process.env.NODE_ENV === 'production', model });

app.listen(port, () => {
  console.log(`LabSpot listening on http://localhost:${port}`);
  console.log(model ? `Suggestions: on (${model.model})` : 'Suggestions: off (no model key), so the fallback is shown');
});
