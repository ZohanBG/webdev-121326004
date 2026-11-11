// The labs rule, called directly on the service: no HTTP involved.
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { listLabs } from '../src/services/labs.js';
import { freshDb } from './helpers.js';

let db;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

describe('labs service', () => {
  test('AC-23 listLabs refuses a caller with no user with NotSignedIn', async () => {
    await expect(listLabs(db, null)).rejects.toMatchObject({ name: 'NotSignedIn', message: 'Sign in first.' });
  });

  test('AC-24 listLabs counts only workstations that are in service', async () => {
    const labs = await listLabs(db, { id: 1, role: 'student' });
    expect(labs.map((l) => [l.name, l.room, l.activeWorkstations])).toEqual([
      ['GPU Lab', '1418', 2],
      ['Networks Lab', '2140', 3], // NL-04 is out of service
      ['Project Room', '3302', 0],
    ]);
  });
});
