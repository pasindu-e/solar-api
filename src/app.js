// Express application: wires up middleware and routes. Does not call .listen() (see server.js).
'use strict';

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');

const requestId = require('./middleware/requestId');
const httpsRedirect = require('./middleware/httpsRedirect');
const apiRateLimit = require('./middleware/apiRateLimit');
const negotiate = require('./middleware/negotiate');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { ApiError } = require('./utils/errors');
const apiRouter = require('./routes');
const docsRouter = require('./docs');

const app = express();

// Needed for correct client IPs / protocol behind a reverse proxy (Render, Railway, Fly.io).
app.set('trust proxy', 1);
// Flat query strings only - blocks nested operator-injection syntax such as ?field[$ne]=x
// from ever being parsed into an object (see spec section 8.5).
app.set('query parser', 'simple');

app.use(requestId);
// Spec 8.5: "redirect plain HTTP when x-forwarded-proto is http." Runs before everything else so
// a plain-HTTP request never reaches auth, docs or the API at all.
app.use(httpsRedirect);
app.use(helmet());

// Swagger UI (/api-docs) and the raw spec (/openapi.json) are public documentation (spec 10):
// mounted before content negotiation/body parsing/auth so Swagger UI's own HTML/JS/CSS assets and
// the raw JSON spec are never forced through the API's 406/415 content-negotiation rules or a
// Bearer token requirement meant for the JSON API under /api/v1.
app.use(docsRouter);

// Content negotiation (406/415, spec 6.5, 8.4) runs BEFORE express.json() so a bad Content-Type
// is rejected with a clean 415 before the body parser ever tries to read an unparseable body.
app.use(negotiate);
// `type` accepts both application/json (every write) and application/merge-patch+json (PATCH
// only, spec 6.5) so express.json() actually parses merge-patch bodies into req.body - by default
// it only parses application/json.
app.use(express.json({ limit: '10kb', type: ['application/json', 'application/merge-patch+json'] }));

app.use(
  pinoHttp({
    // Silent during tests so Jest output stays readable.
    enabled: process.env.NODE_ENV !== 'test',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  })
);

// CORS is deliberately left off (spec 8.5: "CORS restricted or off - no browser client is
// required" for this backend-only API). Auth middleware is applied per-route.

app.get('/health', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    // Placeholder code: the spec does not name a specific code for this case, flagged for approval.
    return next(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database connection is not available.'));
  }
  res.status(200).json({ status: 'ok' });
});

// Phase 11 audit fix: spec 8.5 asks for a rate limit on /auth/token (already present, src/routes/
// auth.js) AND "the API generally" - only the first half existed before this phase. Applied to the
// whole /api/v1 router, not to /health or the public docs, so liveness checks and Swagger UI are
// never affected by API traffic.
app.use('/api/v1', apiRateLimit, apiRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
