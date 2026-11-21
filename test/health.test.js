// GET /health (AC-42), the 404 for unknown pages (AC-43) and error responses without a stack trace (AC-44).
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { freshDb, startApp } from './helpers.js';
import { createPool, CONNECT_TIMEOUT_MS } from '../src/data/db.js';
import { checkHealth } from '../src/services/health.js';

const GENERIC = 'Something went wrong on our side. Try again.';
const STACK = /\bat\s+\S+\s+\(|\.js:\d+|node:internal/;

/** A stand-in database whose every query fails (or never answers) in a chosen way. */
const failingDb = (error) => ({ query: () => Promise.reject(error) });
const silentDb = { query: () => new Promise(() => {}) };

let db;
let app;
beforeAll(async () => {
  db = await freshDb();
  app = await startApp(db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});
afterEach(() => vi.restoreAllMocks());

describe('GET /health', () => {
  test('AC-42 GET /health without a session answers 200 {"status":"ok","db":"ok"} when the database answers', async () => {
    const res = await fetch(`${app.base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  test('AC-42 GET /health answers 503 {"status":"error","db":"down"} when the query fails, and the body has no error details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), { code: 'ECONNREFUSED' });
    const down = await startApp(failingDb(error));
    try {
      const res = await fetch(`${down.base}/health`);
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ status: 'error', db: 'down' });
      expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
      expect(log).toHaveBeenCalledWith('health: database down (ECONNREFUSED)');
    } finally {
      await down.close();
    }
  });

  test('AC-42 GET /health answers 503 when the database does not answer within the time limit', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const slow = await startApp(silentDb, { healthTimeoutMs: 50 });
    try {
      const res = await fetch(`${slow.base}/health`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: 'error', db: 'down' });
      expect(log).toHaveBeenCalledWith('health: database down (TIMEOUT)');
    } finally {
      await slow.close();
    }
  });

  test.skip('AC-42 the time limit is 5 seconds, and the log names only the error code, or its class when it has none', async () => {
    const lines = [];
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    await checkHealth(failingDb(new TypeError('secret detail')), { log: (line) => lines.push(line) });
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(lines).toEqual(['health: database down (TypeError)']);
  });

  test('AC-42 the pool survives a lost idle connection and gives up connecting after 5 seconds', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pool = createPool('postgres://user:password@127.0.0.1:1/none');
    try {
      expect(pool.options.connectionTimeoutMillis).toBe(CONNECT_TIMEOUT_MS);
      expect(CONNECT_TIMEOUT_MS).toBe(5000);
      expect(() => pool.emit('error', Object.assign(new Error('terminated by host db.example'), { code: '57P01' }))).not.toThrow();
      pool.emit('error', new Error('no code'));
      expect(log.mock.calls).toEqual([['database: idle connection lost (57P01)'], ['database: idle connection lost (Error)']]);
    } finally {
      await pool.end();
    }
  });
});

describe('unknown pages', () => {
  test('AC-43 an unknown page answers 404 with a "Page not found" page for a browser', async () => {
    const res = await fetch(`${app.base}/no-such-page`, { headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('<title>Page not found · LabSpot</title>');
    expect(html).toContain('Back to the labs');
  });

  test('AC-43 an unknown page answers 404 {"error":"Not found."} to any other client, like an unknown /api path', async () => {
    for (const path of ['/no-such-page', '/api/no-such-thing']) {
      const res = await fetch(`${app.base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found.' });
    }
  });
});

describe('error responses', () => {
  const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  });

  test('AC-44 broken JSON on a write route answers 400 with one sentence', async () => {
    const res = await post(app.base, '/api/bookings', '{"title": 12');
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'The request body is not valid JSON.' });
    expect(text).not.toMatch(STACK);
  });

  test('AC-44 a body over 10 kb answers 413 with one sentence, not 500', async () => {
    const res = await post(app.base, '/api/auth/login', JSON.stringify({ email: 'x'.repeat(11 * 1024) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'The request body is too large.' });
  });

  test('AC-44 another mistake in the request itself keeps its 4xx status with one sentence', async () => {
    const res = await post(app.base, '/api/auth/login', '{}', { 'content-encoding': 'x-unknown' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'That request is not valid.' });
  });

  test('AC-44 an unexpected error answers 500 "Something went wrong on our side. Try again." with no stack trace in the body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = await startApp(failingDb(new Error('boom in the data layer')));
    try {
      // a well-formed session cookie makes the app look the session up, and the database throws
      const res = await fetch(`${broken.base}/api/labs`, { headers: { cookie: `labspot_session=${'a'.repeat(64)}` } });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: GENERIC });
      expect(text).not.toMatch(/boom/);
      expect(text).not.toMatch(STACK);
      expect(log).toHaveBeenCalled(); // the details go to the server log only
    } finally {
      await broken.close();
    }
  });
});
