# AI-disclosure appendix

Running log of AI assistance used while building this coursework project, per Specification section 14.

| # | Date | Tool/model | Prompt (verbatim or summarised) | What it produced | What was wrong | How I fixed it | Commit |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-09 | Claude Code (Sonnet 5) | Build Phase 1 (project init: package.json, .gitignore, .env.example, ESLint/Prettier config, README, folder structure per spec section 9) and Phase 2 (Express app skeleton, config loader, global error handler, request id middleware, health check, Mongoose connection and all six models with indexes and hooks, sync-indexes script, Jest/Supertest tests with mongodb-memory-server) of the Real-Time Solar Generation Data API, following docs/SPEC.md exactly. | Initial project scaffold: package.json, .gitignore, .env.example, eslint.config.js, .prettierrc.json, README.md, src/app.js, src/server.js, src/config/index.js, src/db/connect.js, src/db/models/*.js (6 models), src/db/scripts/sync-indexes.js, src/middleware/{requestId,notFound,errorHandler}.js, src/utils/errors.js, src/utils/serialize.js, and tests/*.test.js. | | | |
