# LabSpot · TU-Sofia Lab Booking

<!-- Exercise 2. Write the non-goals first. Every acceptance criterion must be checkable in under a minute.
     Keep these headings exactly as they are: the self-checks look for them by name.
     The full target is on the course site under Resources → The course project. -->

## Project option
<!-- One line: lab booking, study groups, club events, or the own project the lecturer approved. -->
Lab booking.

## Goals
- A student signs in, picks a day, sees which workstations are free in each time block, books one block and cancels their own booking before it starts.
- A student can describe what they need in plain words ("quiet place with two monitors, Thursday afternoon") and gets one concrete free slot suggested, which they confirm with one press.
- Lab staff add labs and workstations (with features such as quiet or dual-monitor), take a workstation out of service, cancel bookings on it when needed, and see every booking in every lab for any day.
- The same booking rules apply whether a person uses the web UI or an agent uses the MCP server.

## Non-goals
- No payments or deposits: every booking is free.
- No email, SMS or push notifications: students check "My bookings" on the site.
- No recurring bookings ("every Tuesday"): each booking is one block on one day.
- No group bookings: one booking is one person on one workstation.
- No waitlist: a taken block is simply not offered.
- No self-service staff accounts: the staff role is given by a seed or by an existing staff member, never by sign-up.
- No bookings by staff: staff manage labs, students book.
- No mobile app and no chatbot: one responsive web UI; the model only suggests a slot.
- No password reset by email and no email verification flow for local sign-up.

## Constraints
- Node 22 with Express, PostgreSQL (Neon in production), plain HTML, CSS and JavaScript in the UI. Tests with Vitest and v8 coverage.
- Three layers that never skip each other: `routes/` → `services/` → `data/`. No SQL outside `src/data/`. Every rule (ownership, limits, roles) is checked in `src/services/`, never in a route handler.
- Every schema change is a new numbered migration in `migrations/`; a migration that has run is never edited. Foreign keys use `ON DELETE RESTRICT`: the app never deletes labs or workstations, it takes them out of service, so booking history is never lost.
- Passwords are stored only as a bcrypt hash, never as readable text. Sessions are server-side, the cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
- No secret is ever in a file in the repo: keys go in Codespaces secrets and the hosting settings; `.env.example` holds names only. Seed account passwords come from `SEED_PASSWORD`.
- Time blocks are fixed: Monday to Friday, 08:00–20:00, six 2-hour blocks, in Europe/Sofia time; times are stored as UTC. Deliberate decision: six fixed blocks keep the day view readable at 380 px and make "one booking per block" a simple unique index, instead of overlap checks on free-form times.
- A block is "upcoming" until its start time. Once a block has started it can no longer be booked or cancelled.
- A student cancels only their own bookings. Staff can cancel any upcoming booking (e.g. a broken workstation); every cancelled row records who cancelled it in `cancelled_by`.
- A student holds at most 3 upcoming active bookings and at most one booking per time block. Bookings are possible for upcoming blocks up to 14 days ahead.
- "One workstation, one block, one active booking" is enforced by a unique index in the database, not only by a check in code.
- Workstation features come from a fixed list: `quiet`, `dual-monitor`, `gpu`. Staff set them when adding or editing a workstation; any other value is refused.

## The model feature
<!-- Which model, which modality, and what it does for a user.
     Name three things or the check fails: the input it receives, the output it produces,
     and what happens when the model is slow, rate-limited or wrong. -->
- Model: Claude Haiku 5.5 (`claude-haiku-5-5`), text, through the Claude API (Anthropic SDK), with the key in `ANTHROPIC_API_KEY` and the model id in `CLAUDE_MODEL` so it can change without code changes; called only from `src/services/suggest.js`. Chosen because it is fast and cheap for a short structured task and follows a JSON output format reliably. The API has no free tier, so every call is paid: requests are capped at 300 characters, output at `max_tokens: 200` with thinking explicitly turned off for this call (picking one slot from a given list needs no reasoning, and thinking tokens would eat the cap), and each student at 10 suggestions per day. Every request that reaches the model counts, including ones that time out or fail, because each one is paid; requests refused before the call (empty text, over 300 characters, limit reached) do not count. The count lives in the `suggestion_requests` table (user id, time, outcome: ok, timeout, 429, 529, truncated, invalid), never the request text, and the day resets at midnight Europe/Sofia. It turns a plain-language request into one concrete free slot.
- Input: the student's request text (max 300 characters), today's date, and the free slots in the same 14-day booking window, grouped by date and block to keep the prompt small: for each date and block, the free workstations with slot id, lab name, workstation label and features. No name, email, user id or anyone's bookings ever leave the app; the request text is never written to logs, only the outcome (ok, timeout, 429, invalid).
- Output: JSON `{ "slotId": ..., "reason": "..." }`. Before the student sees it, the service checks that the JSON parses, that `slotId` is one of the slots that were sent, that the slot is still free right now, and that `reason` is plain text under 200 characters. Anything else counts as a failure. The suggestion is shown with a Book button; nothing is written until the student presses it.
- When it fails: no key, a timeout after 8 seconds, a 429 (rate limit) or 529 (overloaded), a provider error, a truncated response (`stop_reason: max_tokens`) or an output that fails the checks all end the same way: the student sees "Suggestions are not available right now. Pick a free slot from the list below." and the normal day view for the requested day. While waiting, the button is disabled and shows "Finding a slot…". At the daily limit the model is not called at all and the student sees "You have used today's 10 suggestions. Pick a free slot from the list below." Tests use a fake model client (correct slot, unknown slot, broken JSON, truncated at `max_tokens`, hang, 429, 529); the real API is never called in tests.

## Auth
<!-- Local sign-in plus at least one provider. Say how an account signing in both ways stays one account. -->
- Local: sign-up and sign-in with email and password; password at least 10 characters, stored as a bcrypt hash. Wrong email or wrong password gives the same message. Roles: `student` (default) and `staff`; staff is never chosen at sign-up.
- Provider: Sign in with Google, authorization-code flow on the server, with `state` and PKCE. The OAuth client stays in Testing mode; Google sign-in is shown on the stable deployed URL, local development uses the password.
- Linking: one row in `users` per person, zero or more rows in `identities` (provider + provider account id). Google sign-in first looks up the Google account id. If unknown and Google marks the email as verified, it is linked to the existing user with that email; if not verified, it is never linked and sign-in is refused with a readable message. Because local sign-up does not verify email, a password set before the first Google link is cleared and other sessions end (someone who pre-registered another person's email loses access). The person, now signed in through Google, sets a new password at `/account`, and from then on both ways sign in to the same account.

## MCP tools
<!-- At least three tools your own MCP server exposes over this project's data.
     Each tool calls the same service functions the HTTP API calls, so the same rules apply.
     A description shorter than 20 characters is not a description. -->
| Tool | What it does | Who may call it |
| --- | --- | --- |
| `list_free_slots` | Lists free workstation slots for one date (YYYY-MM-DD), optionally filtered by lab or feature; use before booking. Calls `slots.listFree`, same as `GET /api/slots`. | Any signed-in user, via the session token in `MCP_TOKEN` |
| `my_bookings` | Lists the token owner's upcoming active bookings with booking id, lab, workstation, date and block. Calls `bookings.listMine`, same as `GET /api/bookings`. | Any signed-in user; sees only their own bookings |
| `book_slot` | Books one free upcoming slot by slot id for the token owner; fails if the slot is taken or the 3-booking limit is reached. Calls `bookings.create`, same as `POST /api/bookings`. | Students only; staff get the same 403 as in the web UI |
| `cancel_booking` | Cancels a booking that has not started yet, by booking id; a student may cancel only their own. Calls `bookings.cancel`, same as `DELETE /api/bookings/:id`. | The booking's owner, or a staff user (same rule as the HTTP route) |
| `suggest_slot` | Turns a plain-language request into one currently free slot suggestion; never books it, call `book_slot` for that. Calls `suggest.suggestSlot`, same as `POST /api/suggestions`. | Students only |

## UI
<!-- Stack, and the three or more screens. The graded checklist lives in docs/UI.md. -->
- Stack: plain HTML, CSS and JavaScript served by Express; `tokens.css` holds every color, spacing, font size and radius. Works at 380, 768 and 1280 px without horizontal scrolling; the main flow (sign in → pick day → book → cancel) works with the keyboard only, with a visible focus ring; text contrast at least 4.5:1, measured with the Chrome DevTools contrast checker.
- Every screen has loading, empty, error (a readable sentence, never raw JSON) and success states.
- Screens:
  1. Sign in / sign up (`/login`): password form and "Sign in with Google".
  2. Labs (`/labs`): labs with room and number of active workstations.
  3. Day view (`/day?date=`): free and taken blocks per workstation for one day, with features shown, Book buttons, and the "Describe what you need" suggestion box.
  4. My bookings (`/my-bookings`): upcoming bookings with Cancel, plus upcoming ones staff cancelled, marked "Cancelled by lab staff".
  5. Account (`/account`): linked sign-in methods and "Set password".
  6. Staff: labs and workstations (`/staff/labs`): add lab, add or edit a workstation and its features, take a workstation out of service.
  7. Staff: all bookings (`/staff/bookings?date=`): every booking for a day, by lab, each with Cancel.

## Architecture
<!-- Exercise 3. One request traced through every layer, naming the file for each one,
     plus one place where your own code does not match this layering. -->

## Acceptance criteria
<!-- Every criterion carries an id. A test proves it by naming that id in its title, for example
     test('AC-3 a booking that overlaps another is refused with 409', ...).
     Say who acts, what they see, and what must be true in the database. -->
- [AC-1] A signed-in student who opens `/day?date=` for a weekday within the next 14 days sees every active workstation with its features and its six blocks, each marked Free or Taken, matching the `bookings` table.
- [AC-2] A student who presses Book on a free upcoming block sees it in `/my-bookings`, and exactly one new row with status `active` appears in `bookings` for that workstation, date and block.
- [AC-3] When two students send a booking for the same block at the same moment, one gets 201 and the other gets 409 with "This workstation was just booked. Pick another slot."; `bookings` holds exactly one active row for that block. (Proved by a test with two parallel requests, not by hand.)
- [AC-4] A student with 3 upcoming active bookings who tries a fourth gets 409 and the message "You already have 3 upcoming bookings. Cancel one first."; no row is added.
- [AC-5] A student who already has a booking in a block and tries another workstation in the same block gets 409 and "You already have a booking at this time."; no row is added.
- [AC-6] A request to book a block whose start time has passed (including the current block, e.g. 10:00–12:00 at 10:30), a weekend, or a date more than 14 days ahead gets 400 with a readable reason and adds no row.
- [AC-7] A student who cancels their own booking before its block starts no longer sees it in `/my-bookings`, its row has status `cancelled`, and the block shows Free in the day view.
- [AC-8] A student who tries to cancel their own booking after its block has started gets 409 and "This booking has already started."; the row stays `active`.
- [AC-9] A student who sends `DELETE /api/bookings/:id` for another student's booking gets 403 and the row stays `active`. (Staff are allowed: see AC-28.)
- [AC-10] A student who opens `/staff/labs` or calls `POST /api/labs` gets 403 and no row is added to `labs`.
- [AC-11] A staff member who adds a lab on `/staff/labs` sees it in `/labs`, and a new row appears in `labs`.
- [AC-12] A staff member who adds a workstation with the features `quiet` and `dual-monitor` sees them in the day view; a request with a feature outside the fixed list gets 400 and adds no row.
- [AC-13] A staff member who takes a workstation with no upcoming bookings out of service no longer sees it offered in the day view; one with upcoming bookings is refused with "Cancel its N upcoming bookings first." and stays in service.
- [AC-14] A staff member who opens `/staff/bookings?date=` sees every active booking for that day with the student's email.
- [AC-15] A student who calls `GET /api/admin/bookings` gets 403 and no booking data.
- [AC-16] A staff member who calls `POST /api/bookings` gets 403 with "Staff accounts cannot book workstations."; no row is added.
- [AC-17] A student who asks for a suggestion and the fake model returns a free slot sees that slot with a Book button and a short reason; no booking row is created until Book is pressed.
- [AC-18] When the model times out, returns 429 or 529, has no key, stops at `max_tokens`, or returns a slot id that is not free, the student sees "Suggestions are not available right now. Pick a free slot from the list below." and the day view; no booking is created.
- [AC-19] A person who signed up with a password and later signs in with Google using the same verified email lands on the same account and sees the same bookings; `users` still has one row for that email, `identities` has one Google row for it, and the old password no longer signs in.
- [AC-20] A person signed in through Google who sets a new password at `/account`, signs out and signs in with that email and password lands on the same account with the same bookings.
- [AC-21] A Google sign-in whose email Google does not mark as verified is not linked to an existing account, shows a readable refusal, and adds no row to `identities`.
- [AC-22] The MCP tool `cancel_booking` called with a student's token and another user's booking id returns the same 403 error as the HTTP route, and the row stays `active`.
- [AC-28] A staff member who presses Cancel on a student's upcoming booking in `/staff/bookings` sees it disappear from the list; the row has status `cancelled` and `cancelled_by` holds the staff user's id, and the student sees it in `/my-bookings` marked "Cancelled by lab staff".
- [AC-29] A student who already has 10 rows in `suggestion_requests` for today (Europe/Sofia) and asks for an 11th suggestion sees "You have used today's 10 suggestions. Pick a free slot from the list below." and the day view; the fake model client records no call and no row is added to `suggestion_requests`.
- [AC-30] The MCP tool `cancel_booking` called with a staff user's token and a student's upcoming booking id cancels it: the row has status `cancelled` and `cancelled_by` holds the staff user's id, the same as AC-28 in the web UI.

### Slice 1: sign-in and the labs list
- [AC-23] A visitor who opens `/labs` without signing in lands on `/login`; `curl -i http://localhost:3000/api/labs` without a session returns 401 and no lab names.
- [AC-24] After signing in with a seeded student account, `/labs` shows the three seeded labs, each with its name, room and number of active workstations (one of them shows 0), read from the `labs` and `workstations` tables.
- [AC-25] Deleting the seeded lab that has no workstations from `labs` in the database and reloading `/labs` removes that lab from the screen.
- [AC-26] Signing in with a wrong password shows "Wrong email or password." and sets no session cookie; every value in `users.password_hash` starts with `$2`.
- [AC-27] After pressing Sign out, opening `/labs` lands on `/login` again.

## Traceability
<!-- Filled in from Exercise 3 onward: each AC id, and the test that names it. -->
| Criterion | Test |
| --- | --- |
| AC-1 |  |

## Spec vs result
<!-- After the agent builds the slice: which criteria passed, which it missed or reinterpreted, and what you changed in this spec because of it. -->