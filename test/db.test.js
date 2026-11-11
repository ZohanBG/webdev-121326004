import { describe, test, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createPool, withConnection, transaction } from '../src/data/db.js';

describe('database helpers', () => {
  test('createPool refuses to start without DATABASE_URL', () => {
    expect(() => createPool('')).toThrow(/DATABASE_URL/);
  });

  test('createPool builds a pg pool from a URL without connecting yet', async () => {
    const pool = createPool('postgres://user:pass@localhost:5432/nothing');
    expect(typeof pool.query).toBe('function');
    await pool.end();
  });

  test('withConnection on a pg pool runs everything on one client and always releases it', async () => {
    const calls = [];
    let released = 0;
    const client = {
      query: async (text, params) => {
        calls.push([text, params]);
        return { rows: [] };
      },
      release: () => released++,
    };
    const pool = { connect: async () => client };

    await withConnection(pool, async (conn) => {
      await conn.query('SELECT $1', [1]);
      await conn.exec('SELECT 1; SELECT 2');
    });
    await expect(withConnection(pool, async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    expect(calls).toEqual([['SELECT $1', [1]], ['SELECT 1; SELECT 2', undefined]]);
    expect(released).toBe(2);
  });

  test('transaction rolls back every statement when one step fails', async () => {
    const db = new PGlite();
    await db.exec('CREATE TABLE t (n int)');
    await expect(transaction(db, async (conn) => {
      await conn.query('INSERT INTO t VALUES (1)');
      throw new Error('boom');
    })).rejects.toThrow('boom');

    const { rows } = await db.query('SELECT count(*)::int AS n FROM t');
    expect(rows[0].n).toBe(0);
    await db.close();
  });
});
