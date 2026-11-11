import { createPool } from './data/db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT) || 3000;
const app = createApp({ db: createPool(), secureCookies: process.env.NODE_ENV === 'production' });

app.listen(port, () => console.log(`LabSpot listening on http://localhost:${port}`));
