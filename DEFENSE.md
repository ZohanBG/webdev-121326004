# Defence notes

## What it does

LabSpot is an easy way to book a lab workstation at TU-Sofia.
Students pick a day, see which workstations are free in each 2-hour block, book one and cancel their own booking.
Staff add labs and workstations, take a workstation out of service and see or cancel every booking.

## The three files I will open

1. `src/services/bookings.js`, because every booking rule lives there: who may book, the time window, the 3-booking limit, and who may cancel.
2. `src/routes/bookings.js`, because it shows the route stays thin: it only passes the request to the service and sends back the status.
3. `migrations/002_bookings.sql`, because its two partial unique indexes are what really stop a double booking, even when two requests arrive at the same moment.

## Decisions I can defend

- Stack: Node, Express, PostgreSQL and plain HTML/CSS/JS, because it is what the course uses, it has no build step, and Postgres gives me real transactions and unique indexes.
- Where the rules live: only in `src/services/`, so the web pages and the MCP server go through the same checks and cannot disagree.
- Authentication and authorization: email and password with bcrypt, plus Sign in with Google linked to the same account by verified email. Students can only change their own bookings, staff cannot book, and every write checks 401 and 403 in the service.
- The model, and why that one: Gemini Flash-Lite, because it has a free tier for students and picking one free slot from a list is a small task. If it is slow, rate-limited or wrong, the student sees a fallback message and nothing is booked.
- What the MCP server exposes, and what it deliberately does not: listing free slots, my bookings, booking, cancelling and a suggestion, acting as one user with that user's rights. It has no staff tools and cannot create or change labs.
- The database shape: users, labs, workstations and bookings, where a booking links one student to one workstation in one block. The most important part is the unique indexes on active bookings, so the database refuses a double booking even if the code misses it.

## How I know it works

Every acceptance criterion in `SPEC.md` has a test that names it, and CI runs them with coverage gates (100% for the services) on every push.
Render only deploys a commit after CI is green.
I booked a slot on the live site, redeployed, and the booking was still there; I signed in with Google on the live site; a rollback took 20 seconds.

## What is wrong with it

The biggest weakness is the shared seed password: three seeded accounts on the live site, one of them staff, use the same password.
There is now a limit of 5 failed sign-ins per email and address, but someone guessing from many addresses is not stopped.
Other known gaps are listed in `READINESS.md` section 7.

## The thing in this repository I did not write and cannot explain

The race-safe booking in `createBooking`: the agent wrote the row lock on the student and the code that turns a unique-index violation into the AC-3 or AC-5 message.
I understand what it protects against (two parallel requests both passing the checks), but I could not explain every line of the transaction and the error mapping without reading it again.
