# READINESS: LabSpot

How ready LabSpot really is on its live address, as of 21 November 2026. Every claim says how I checked it. Anything I have not checked myself is marked **unverified** and appears again under section 7.

## 1. Live URL and how to verify it

**https://webdev-121326004.onrender.com**, Render Web Service (Docker, Frankfurt, Free), database on Neon (Frankfurt, `eu-central-1`).

- `curl.exe -s https://webdev-121326004.onrender.com/health` answers `{"status":"ok","db":"ok"}` with 200.
- `/login` shows the sign-in page; signing in with a seeded account or with Google lands on Labs.
- Auto-Deploy is set to "After CI Checks Pass", so only commits with green CI go live.

How I checked: `node checks/ex4.mjs` (https, `/health` 200, a real page title); the Render deploy log ("Nothing to apply", "LabSpot listening", "Your service is live"); the Auto-Deploy field in Render → Settings; signing in with Google on the live site as my own account.

## 2. Environment variables

The app stops at start-up and names a missing or invalid variable, never its value (`src/config.js`).

| Variable | Required | Secret | Where the real value comes from |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | yes | Neon → Connect (direct connection, `sslmode=verify-full`) |
| `PORT` | no, default 3000 | no | set by Render |
| `NODE_ENV` | no | no | `production` is set by the Dockerfile; not set on Render on purpose |
| `PUBLIC_BASE_URL` | only with Google; must be `https://` in production | no | the Render URL |
| `GOOGLE_CLIENT_ID` | all or nothing with the next two | no | Google Cloud → Google Auth Platform → Clients |
| `GOOGLE_CLIENT_SECRET` | all or nothing | yes | same |
| `GEMINI_API_KEY` | no; without it suggestions fall back | yes | Google AI Studio |
| `GEMINI_MODEL` | no, default `gemini-3.5-flash-lite` | no | |
| `MCP_TOKEN` | only for the local MCP server | yes | a session token of one user |
| `SEED_PASSWORD` | only for the seed script | yes | chosen by me |

`SESSION_SECRET` is not used: the session cookie is a random 256-bit token and the database stores only its SHA-256, so nothing is signed.

How I checked: `node src/server.js` without `DATABASE_URL` printed `missing DATABASE_URL: see .env.example` and exited 1 (my own run in PowerShell); `test/config.test.js`; the Render deploy log shows `Suggestions: on (gemini-3.5-flash-lite)` and `Sign in with Google: on (https://webdev-121326004.onrender.com/api/auth/google/callback)`, which proves the Gemini, Google and `PUBLIC_BASE_URL` variables are set there; the secret search in section 6.

## 3. What happens when things fail

| Failure | What the user gets | How I checked |
| --- | --- | --- |
| Database unreachable (connection refused) | `/health` answers 503 `{"status":"error","db":"down"}`; an API call answers 500 with one sentence, at once. A database that does not answer at all would hit the 5-second connect timeout first (not tried). That pages then show the error state with "Try again" is from the code, not observed | the agent ran the image locally with a wrong `DATABASE_URL` (logged, Msg 16); tests AC-42 |
| A deploy that cannot reach the database | the container stops at the migration step and never goes live; the previous version keeps serving | follows from the Dockerfile `CMD` (`migrate && server`); **unverified on Render** |
| Broken JSON | 400 "The request body is not valid JSON." | my own `curl.exe` run locally; the agent's run against the live site (Msg 16) |
| Body over 10 kB | 413 "The request body is too large." | my own `curl.exe` run locally; test AC-44 |
| A write without a session | 401 "Sign in first." | the agent's `curl.exe` run against the live site (Msg 16) |
| Model slow, rate-limited (429), overloaded (503) or wrong | "Suggestions are not available right now. Pick a free slot from the list below."; nothing is booked | tests AC-18 and AC-41 |
| No model key (`GEMINI_API_KEY` not set) | the same fallback sentence, and the day grid still works | **local, not the live site**: the Docker image with no key on a throw-away database ([model-key-off.png](docs/ui/model-key-off.png)) |
| Neon closes an idle connection | no crash; one log line | the pool's `'error'` listener in `src/data/db.js`; test "AC-42 the pool survives a lost idle connection" |
| Container stopped or redeployed | closes in under a second on SIGTERM, exit code 0 | my own `docker stop`: "SIGTERM: closing", exit code 0 |
| Rollback to the previous deploy | the previous version is back in about 20 seconds; Auto-Deploy stays "After CI Checks Pass" | my own rollback in Render → Events on 21 November 2026, from 249c03c to bd97007: 20 s until Labs showed "Every lab you can book" again; Auto-Deploy was unchanged; Manual Deploy then brought 249c03c back |

No response contains a stack trace (my own checks above, and test AC-44).

## 4. Four states of one screen

**Shown locally, not on the live site.** My bookings in all four states, plus success, on a local test server (the real app on an in-process test database with the test seed), with `node scripts/ui/screenshots.mjs` in headless Chrome:

- **Loading:** the bookings request held: three grey placeholders, the region `aria-busy` ([loading.png](docs/ui/loading.png)).
- **Content:** the list appears where the placeholders were, at the same 172 px from the top ([content.png](docs/ui/content.png)).
- **Empty:** a student with no bookings: "You have no upcoming bookings." and "Pick a free slot" ([empty.png](docs/ui/empty.png)).
- **Error:** the request failed as offline: the red "!" box "Could not reach the server. Check your connection and try again." ([error.png](docs/ui/error.png)).
- **Success:** Cancel gives the green ✓ "Cancelled …" notice and the list shrinks from 2 to 1 without a reload ([success.png](docs/ui/success.png)).

Still to do on the live site: the same four states with Slow 4G and Offline in DevTools (gap 7).

How I checked: `docs/ui/` and `docs/UI.md` (Evidence); every screenshot is labelled "local test server".

## 5. Request waterfall

**Shown locally, not on the live site.** On the local test server, headless Chrome with the cache disabled and no throttling, the Day view as a student made **13 requests** and finished in **23 ms**. The API calls start one after the other: `/api/auth/me` → `/api/features` → `/api/slots`; `tokens.css` also waits for `styles.css`, and the page's modules wait for `day.js`. On the live site each of those round trips also crosses the network to Frankfurt, so the real Finish time is longer and still to be measured (gap 7).

From the code, the Day view makes three requests in sequence before the grid appears: `/api/auth/me` → `/api/features` → `/api/slots`. `/api/features` is public and does not need `/api/auth/me`, so it could run in parallel and save one round trip.

How I checked: [docs/ui/waterfall.txt](docs/ui/waterfall.txt) (every request with its start and end, from `scripts/ui/screenshots.mjs`); the rendering table in `SPEC.md` under Architecture, reviewed against `public/day.js`.

## 6. Security basics checked

- **No secrets in git.** `git log --all --oneline -- .env` prints nothing. Searching the full history for provider key prefixes finds only `AIza`, `GOCSPX-` and `ghp_`, 3 times each, all inside the course's detector regexes in `checks/lib.mjs`. Connection strings: only the placeholder `postgres://user:pass`. How I checked: my own PowerShell run with `Select-String`, matching the agent's search.
- **No `.env` in the image**, and it runs as a non-root user. How I checked: `docker run --rm --entrypoint find labspot /app -name ".env*"` printed nothing; `id -un` printed `node`.
- **HTTPS** on the live URL (`checks/ex4.mjs`).
- **Unauthenticated writes get 401** (the agent's `curl.exe` run against the live site, Msg 16; the full list of write endpoints with their 401 and 403 lines is in the same log entry).
- **A signed-in non-owner gets 403** when cancelling someone else's booking (`src/services/bookings.js:94`; tests AC-9 for HTTP and AC-22 for MCP). **Shown locally, not on the live site:** the Docker image on a throw-away database: student 1 booked (201); student 2 sent `DELETE /api/bookings/1` and got **403** "You can only cancel your own bookings."; the booking stayed `active` in student 1's list ([second-account.txt](docs/ui/second-account.txt), every request with its status).
- **Session cookie:** `HttpOnly` stops page scripts reading the token (XSS); `SameSite=Lax` stops other sites sending forms as the user (CSRF); `Secure` in production keeps it off plain http (`src/routes/session.js:14-19`). That `Secure` is really set on the live site is **unverified** (DevTools → Application → Cookies).
- **Sessions** last 7 days (`src/services/auth.js:7`). Passwords are bcrypt hashes; the session id is stored only as SHA-256. Expired sessions are deleted whenever a new one opens (S7).
- **Sign-in is limited** to 5 failures per email and address in 15 minutes, then 429 (AC-45, `test/signin-limit.test.js`). The address is `req.ip` with `trust proxy` set to 1, which on Render is the address its one proxy reports (SPEC Constraints).
- **A password change ends every other session** of the account and keeps the one it was made from (AC-46, `test/password-sessions.test.js`), so a stolen session cookie stops working.
- **`/health` and `/api/features` are public** and reveal nothing about users or the server (AC-42, SPEC Constraints).

## 7. Known gaps, ranked by risk

1. **Sign-in attempts: limited (closed for one address, S1 and AC-45).** 5 failed sign-ins for one email from one address within 15 minutes now lock that pair for 15 minutes with 429; unknown emails count the same; tests in `test/signin-limit.test.js`, which failed before the fix (commits `test(S1)` then `fix(S1)`). What stays open: the three seeded accounts, one of them staff, still share `SEED_PASSWORD` (kept on purpose), and someone guessing from many addresses is slowed only per address. Next step: a unique staff password, and a per-email limit across addresses if guessing shows up in the logs.
2. **Anyone with a verified Google account can sign up (S3).** Google sign-in creates a student for any verified Google address (`src/services/google.js:117`). The 3-booking limit and the 10-suggestion daily limit cap what each account can do, but one person with several Google accounts could still hold many slots and use up the shared Gemini quota. Next step: an allow-list of email domains (for example the university's), set in the environment.
3. **The second-account 403 check: shown locally, not yet on the live site.** Code and tests cover it (AC-9, AC-22), and the local Docker image refused it (section 6), but I have not proved it on the deployment. Next step: run the `DELETE` as `student2@` against `student@`'s booking on the live site before Exercise 5.
4. **`MCP_TOKEN` is a full session token valid for 7 days.** If it leaks, someone acts as that user until it expires. Next step: use a student account's token only (never staff), and sign out that session to revoke it if it leaks.
5. **Render's free tier sleeps after about 15 minutes without traffic.** The first visitor waits for it to wake (first measurement: `node checks/ex4.mjs` waited 13 s for the sleeping service on 21 November 2026), and a paused Neon adds its own wake-up on the first query. Next step: accept it for a course project, measure one cold start, and say so at the defense.
6. **Shared Gemini free quota.** A 429 is likely when the class uses it at the same time; suggestions then fall back, which is safe but makes the feature often unavailable. Next step: accept it; a paid key would remove it at the cost per call in section 8.
7. **Four states and waterfall: shown locally, not yet on the live site** (sections 4 and 5). The `docs/ui/` screenshots come from a local test server. Next step: record them with DevTools (Slow 4G, Offline, Disable cache) and add the screenshots before handing in.
8. **The Day view's requests are sequential: shown locally, not yet on the live site.** Three round trips before the grid (locally 13 requests in 23 ms, section 5). Next step: fetch `/api/features` in parallel with `/api/auth/me`.
9. **The model prompt carries every free slot for 14 days.** About 9,000 input tokens per call, almost all of it the slot list. Next step: when the student names a day, send only that day's slots, which would cut the input several times over.
10. **No security headers (S5).** The app sends no Content-Security-Policy, `X-Content-Type-Options` or `frame-ancestors` (`src/app.js`). Softened by every page writing text only (no `innerHTML`) and the `SameSite=Lax` cookie, which another site cannot use in a frame or a form. Next step: set those three headers in one middleware, without a new package.
11. **Layering: the staff-only page rule lives in the route (S6).** `src/routes/pages.js:14-18` checks the role itself instead of calling the service's `requireStaff`, so the rule exists twice. The data behind those pages is still refused by the services (AC-10, AC-15). Next step: let the page route ask `requireStaff`.
12. **`src/server.js` shows 0% coverage.** Its start-up and shutdown are tested in child processes, which coverage cannot see, so the 80% gate says nothing about it. Next step: accept it; the child-process tests in `test/config.test.js` are the evidence.
13. **Rollback: closed.** Tried on the live site on 21 November 2026: Render → Events → Rollback from 249c03c to bd97007 took 20 seconds until Labs showed "Every lab you can book" again; Auto-Deploy stayed "After CI Checks Pass"; Manual Deploy brought 249c03c back. What a rollback does not undo is the database: a migration that already ran stays. Next step: keep migrations additive, so the previous version still works on the newer schema.

## 8. Model feature

- **Model:** Gemini, `gemini-3.5-flash-lite` (`GEMINI_MODEL`), called only from `src/services/suggest.js`.
- **What leaves the app:** the student's request text (max 300 characters), today's date and the free slots (workstation label, lab, feature labels). No name, email, user id or anyone's bookings. The request text is never written to logs; only the outcome is stored. How I checked: test "AC-17 the model gets the request, today and the free slots, and nothing that identifies the student".
- **Cost and limits:** my key is on Google's free tier (AI Studio shows "Free tier", no billing set up), so today a call costs $0 and the limit is the shared free quota. At the paid list price for `gemini-3.5-flash-lite`, $0.30 per 1M input tokens and $2.50 per 1M output tokens (read on 21 November 2026), one call costs about:
  - input: about 9,000 tokens in the worst case (36,186 characters: 1,326 of instructions plus 330 free slots, 66 blocks × 5 workstations, `suggest.js:157`; only the student's text is capped at 300 characters, `suggest.js:151`). 9,000 × $0.30 / 1M ≈ $0.0027
  - output: at most 200 tokens. 200 × $2.50 / 1M = $0.0005
  - total: about **$0.003 per call**, and with 10 calls per student per day (AC-29) about **$0.03 per student per day**.

  The token count is an estimate at about 4 characters per token, not Google's tokenizer; one real call would return the exact `promptTokenCount`. How I checked: the AI Studio API keys page; the prompt of one worst-case call measured by the agent on the seeded test database with a fake client that records the request instead of sending it (Msg 22); the price row for `gemini-3.5-flash-lite` on Google's pricing page; `suggest.js`; the tests.
- **When the provider is down or slow:** an 8-second timeout, no retry, and the fallback sentence; nothing is booked (AC-18). With no key, the local Docker image shows the fallback and the day view still works ([model-key-off.png](docs/ui/model-key-off.png)); turning the key off on the live site has **not** been tried.
- **When the model is wrong:** the answer must name a slot that was sent and is still free, and every feature id it claims must belong to that workstation; otherwise it counts as invalid and falls back (AC-41).

## 9. MCP

- **Tools:** `list_free_slots`, `my_bookings`, `book_slot`, `cancel_booking`, `suggest_slot`.
- **Who may call them:** whoever holds `MCP_TOKEN`, which is one user's session token. The tools call the same functions in `src/services/` as the HTTP routes, so a student's token can only do what that student can do in the browser, and the refusals match (AC-22, AC-30).
- **Where it runs:** locally over stdio only. It is not deployed; the image leaves out `mcp-server/` (`.dockerignore`).

How I checked: `mcp-server/project-tools.mjs` imports the services directly; the course MCP check passes 12/12; tests AC-22 and AC-30.
