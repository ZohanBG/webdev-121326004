# Instructions for the agent

Read this file at the start of every session. Keep it short and correct; update it when the project changes.

## Project
<!-- One or two sentences: what the app does and for whom. Link SPEC.md. -->
LabSpot: TU-Sofia students see which lab workstations are free on a day, book a 2-hour block and cancel their own booking; lab staff manage labs and workstations and see every booking.
See `SPEC.md` for goals, non-goals and acceptance criteria.

## Commands
<!-- How to install, run, test. Keep these exact and working. -->
- Install: `npm install`
- Database server (development): `docker start labspot-db` (PostgreSQL 17 in Docker, created once with `docker run --name labspot-db -e POSTGRES_USER=labspot -e POSTGRES_PASSWORD=<password> -e POSTGRES_DB=labspot -p 5432:5432 -d postgres:17`)
- Database: `npm run migrate`, then `npm run seed` (seed accounts use `SEED_PASSWORD`; both read `.env`)
- Run: `npm start` (http://localhost:3000, needs `DATABASE_URL` in `.env`)
- Test: `npm test` (Vitest on an in-process PostgreSQL, PGlite: no database server and no model provider needed)
- Coverage: `npm run coverage`
- MCP server: `npm run --silent mcp` (starts `node mcp-server/server.js`; `--silent` keeps npm's own output off stdout); self-check: `node mcp-server/check.mjs -- node mcp-server/server.js`

## Conventions
<!-- Folder layout, naming, where business rules live, how errors are returned to the client. -->
- Layout: `src/routes/` (HTTP), `src/services/` (rules), `src/data/` (SQL), `public/` (HTML, CSS, JS, `tokens.css`), `migrations/` (numbered SQL files), `test/`.
- Every rule (roles, ownership, booking limits, time blocks, the suggestion limit) lives in `src/services/`, never in a route handler or a page.
- Errors reach the client as a status code (400 invalid input, 401 not signed in, 403 not allowed, 404 not found, 409 conflict) and a JSON body `{ "error": "<readable sentence>" }`; pages show that sentence, never raw JSON. Use the exact messages written in `SPEC.md`.
- Times are stored in UTC and shown in Europe/Sofia.

## Layers
<!-- Fill in the file or folder for each layer. -->
Requests arrive two ways and both end in the same place:

- HTTP route handler (`src/routes/`) → service (`src/services/`) → data access (`src/data/`) → PostgreSQL (`DATABASE_URL`, schema in `migrations/`)
- MCP tool (`mcp-server/`) → **the same service** (`src/services/`) → data access → database

A route handler reads the request and turns a result into a status code. A service holds the
rules and knows nothing about HTTP or about MCP. Only the data layer writes SQL. An MCP tool
that talks to the database directly is a second, unguarded way into your data: never add one.

## The model feature
<!-- Provider, env var, and the call site. -->
- The provider is named in exactly one file: `src/services/suggest.js` (Anthropic SDK, model id from `CLAUDE_MODEL`).
- The key comes from an environment variable (`ANTHROPIC_API_KEY`) and is never committed or logged.
- Every call has a timeout and a deterministic fallback, so the app still works when the provider is down or rate-limited.
- The model's output is re-checked against real data before anything is saved or shown.
- Tests never call the provider: they pass in a fake client.

## The MCP server
<!-- Where it lives and how it authenticates. -->
- Lives in `mcp-server/`, grew out of Exercise 1.
- Every tool calls a service function; none touches the data layer or the database directly.
- It carries a user, and enforces exactly the same authorization rules as the HTTP API.
- Adding a tool means adding a row to the table in `SPEC.md` too.

## Tests and coverage
- Every acceptance criterion in `SPEC.md` has an id like `AC-3`, and a test whose title contains that id.
- The coverage gate runs in CI: 100% of the service layer, 80% overall.
- A test is evidence. Changing a test so the code passes destroys the evidence.

## Always ask before
- deleting files or folders
- editing a migration that has already run
- installing or removing dependencies
- pushing, tagging or changing CI
- anything that touches secrets or `.env`
- changing an authentication or authorization rule
- adding, renaming or removing an MCP tool
- changing a coverage threshold
- sending user data to a third-party model

## Never
- commit secrets, passwords, API keys or an OAuth client secret
- weaken or delete a test to make it pass
- lower a coverage threshold or switch off a CI job to make the build green
- add an MCP tool that reaches past the service layer
- log a prompt that contains somebody's personal data
