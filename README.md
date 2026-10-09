# Solar API (NB6007CEM Real-Time Solar Generation Data API)

A backend-only JSON REST API for Sri Lanka Sustainable Energy Authority (SLSEA) style
real-time solar generation data, built with Express 5 and MongoDB (Mongoose 8). It models a
province -> district -> grid-substation -> solar-installation -> generation-reading hierarchy,
with JWT bearer authentication, scoped device/user tokens, and jurisdiction-scoped reads.

This repository currently implements **Phase 1 (project scaffold)** and **Phase 2 (Express
skeleton + Mongoose models)** only. Routes, auth, seeding and the full write path are not yet
built — see `docs/SPEC.md` for the full plan.

## Requirements

- Node.js 20+ (developed against Node 26)
- A MongoDB Atlas cluster (free M0 tier is enough) for real usage; automated tests use an
  in-memory MongoDB via `mongodb-memory-server` and need no Atlas access.

## Install and run

```bash
npm install
cp .env.example .env   # then fill in your own local values, see below
npm run dev             # starts the API with nodemon, reads src/server.js
# or
npm start                # plain node start
```

## Running tests

```bash
npm test
```

Tests run with Jest + Supertest against an in-memory MongoDB (`mongodb-memory-server`), so no
Atlas connection or credentials are needed to run the test suite.

## Linting and formatting

```bash
npm run lint
npm run format
```

## Environment variables

Copy `.env.example` to `.env` and fill in your own values. **Never commit `.env` or any file
containing real secrets.** `.gitignore` excludes `.env`, `.env.*` and `atlas-credentials.env`
explicitly; only `.env.example` (placeholders only) is committed.

## MongoDB Atlas setup

Full step-by-step instructions (creating the free M0 cluster, a least-privilege database user,
network access, and the connection string) are in **Appendix D of `docs/SPEC.md`**. In short:
create a free Atlas cluster, create a `readWrite`-only database user, allow your IP (and later
`0.0.0.0/0` for the host), then put the resulting `mongodb+srv://...` URI in your local `.env`
as `MONGODB_URI`.

Once `MONGODB_URI` is set, run `npm run db:indexes` to create the collection indexes (including
the unique compound index on readings) against that database.

## Live deployment

Not deployed yet. A public HTTPS URL will be added here once Phase 4 onward (deployment) is
complete.

## Project status

See `docs/SPEC.md` for the full specification and `docs/AI_LOG.md` for the AI-disclosure log.
