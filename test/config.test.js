// The start-up check (src/config.js): which variables stop the app, and that it names them without
// ever printing a value. The last tests start the real server in a child process with an environment
// built here, so neither .env nor the developer's own shell variables are used.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, afterEach } from 'vitest';
import { envProblems, checkEnvOrExit, PLACEHOLDER_DATABASE_URL } from '../src/config.js';

const DB = 'postgres://labspot:not-a-real-password@127.0.0.1:5432/labspot';
const GOOGLE = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-a-real-secret', PUBLIC_BASE_URL: 'https://labspot.example' };

describe('the start-up check', () => {
  test('DATABASE_URL is required: missing, empty or only spaces stops the app and names it', () => {
    for (const env of [{}, { DATABASE_URL: '' }, { DATABASE_URL: '   ' }]) {
      expect(envProblems(env)).toEqual(['missing DATABASE_URL: see .env.example']);
    }
  });

  test('nothing else is required: no model key, no Google, no PORT and no NODE_ENV still start', () => {
    expect(envProblems({ DATABASE_URL: DB })).toEqual([]);
    expect(envProblems({ DATABASE_URL: DB, GEMINI_MODEL: 'gemini-3.5-flash-lite' })).toEqual([]);
  });

  test('Sign in with Google is all or nothing: a client id alone names the two missing variables', () => {
    const problems = envProblems({ DATABASE_URL: DB, GOOGLE_CLIENT_ID: GOOGLE.GOOGLE_CLIENT_ID });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^missing GOOGLE_CLIENT_SECRET: /);
    expect(problems[1]).toMatch(/^missing PUBLIC_BASE_URL: /);
    expect(envProblems({ DATABASE_URL: DB, GOOGLE_CLIENT_SECRET: 'x', PUBLIC_BASE_URL: 'http://localhost:3000' }))
      .toEqual([expect.stringMatching(/^missing GOOGLE_CLIENT_ID: /)]);
  });

  test('all three Google variables, or PUBLIC_BASE_URL alone, are fine', () => {
    expect(envProblems({ DATABASE_URL: DB, ...GOOGLE })).toEqual([]);
    expect(envProblems({ DATABASE_URL: DB, PUBLIC_BASE_URL: 'http://localhost:3000' })).toEqual([]);
  });

  test('in production the .env.example placeholder DATABASE_URL is refused; in development it is not', () => {
    expect(envProblems({ NODE_ENV: 'production', DATABASE_URL: PLACEHOLDER_DATABASE_URL }))
      .toEqual(['invalid DATABASE_URL: it is still the placeholder from .env.example']);
    expect(envProblems({ NODE_ENV: 'development', DATABASE_URL: PLACEHOLDER_DATABASE_URL })).toEqual([]);
  });

  test('in production PUBLIC_BASE_URL must start with https://; http is fine in development', () => {
    const http = { DATABASE_URL: DB, ...GOOGLE, PUBLIC_BASE_URL: 'http://labspot.example' };
    expect(envProblems({ ...http, NODE_ENV: 'production' })).toEqual(['invalid PUBLIC_BASE_URL: it must start with https:// in production']);
    expect(envProblems(http)).toEqual([]);
    expect(envProblems({ DATABASE_URL: DB, ...GOOGLE, NODE_ENV: 'production' })).toEqual([]);
  });

  test('a problem names the variable and never prints its value', () => {
    const problems = envProblems({
      NODE_ENV: 'production', DATABASE_URL: PLACEHOLDER_DATABASE_URL, GOOGLE_CLIENT_SECRET: 'super-secret-value', PUBLIC_BASE_URL: 'http://plain.example',
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
    for (const line of problems) {
      expect(line).not.toMatch(/user:password|super-secret-value|plain\.example/);
    }
  });

  test('the scripts (migrate, seed) skip the Google rules: they never sign anyone in', () => {
    expect(envProblems({ DATABASE_URL: DB, GOOGLE_CLIENT_ID: 'x' }, { google: false })).toEqual([]);
    expect(envProblems({}, { google: false })).toEqual(['missing DATABASE_URL: see .env.example']);
  });
});

describe('checkEnvOrExit', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  test('prints one line per problem to stderr and exits with code 1', () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkEnvOrExit();
    expect(error.mock.calls).toEqual([['missing DATABASE_URL: see .env.example']]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test('returns quietly, without exiting, when nothing is wrong', () => {
    vi.stubEnv('DATABASE_URL', DB);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkEnvOrExit({ google: false });
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

// ---- the real server, in a child process

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// only what Node needs to run on this machine; nothing from .env or the developer's shell
const KEEP = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'];
const baseEnv = () => Object.fromEntries(KEEP.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));

const freePort = () => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

/** Runs `node src/server.js` until it exits, or until stdout matches `until` (then stops it). */
function runServer(env, until) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...baseEnv(), ...env } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no result in time\n${stdout}\n${stderr}`)); }, 15_000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (until && until.test(stdout)) child.kill();
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe('the server at start-up', () => {
  test('without DATABASE_URL it stops with code 1 before listening, and the last line names the variable', async () => {
    const { code, stdout, stderr } = await runServer({ DATABASE_URL: '' });
    expect(code).toBe(1);
    expect(stdout).not.toMatch(/listening/);
    expect(stderr.trim().split('\n').at(-1).trim()).toBe('missing DATABASE_URL: see .env.example');
  });

  test('in production with the placeholder DATABASE_URL it stops with code 1 and does not print the value', async () => {
    const { code, stderr } = await runServer({ NODE_ENV: 'production', DATABASE_URL: PLACEHOLDER_DATABASE_URL });
    expect(code).toBe(1);
    expect(stderr).toMatch(/invalid DATABASE_URL/);
    expect(stderr).not.toMatch(/user:password/);
  });

  // Windows cannot send a signal to another process (kill() ends it at once), so this runs in CI on Linux
  test.skipIf(process.platform === 'win32')('a SIGTERM closes the server cleanly: it says so and exits with code 0', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['src/server.js'], { cwd: ROOT, env: { ...baseEnv(), DATABASE_URL: DB, PORT: String(port) } });
    let stdout = '';
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    await new Promise((resolve) => child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (/Sign in with Google: off/.test(stdout)) resolve();
    }));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(stdout).toMatch(/SIGTERM: closing/);
  });

  test('without a Gemini key it still starts, with suggestions off', async () => {
    const port = await freePort();
    const { stdout, stderr } = await runServer({ DATABASE_URL: DB, PORT: String(port) }, /Sign in with Google: off/);
    expect(stderr).toBe('');
    expect(stdout).toMatch(new RegExp(`LabSpot listening on http://localhost:${port}`));
    expect(stdout).toMatch(/Suggestions: off/);
  });
});
