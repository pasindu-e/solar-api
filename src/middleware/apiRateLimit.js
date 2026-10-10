// General API rate limiter (spec 8.5: "Rate limit ... the API generally", on top of the stricter
// per-IP limiter already on POST /auth/token in src/routes/auth.js). Mounted on the whole
// /api/v1 router (src/app.js) so every endpoint shares one generous per-IP budget - this is a
// basic abuse/DoS guard, not a business rule, so it does not need per-route tuning.
'use strict';

const rateLimit = require('express-rate-limit');
const { ApiError } = require('../utils/errors');

const apiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // Judgment call: 300 requests/minute/IP in production is generous for a single analyst or
  // device but still caps a runaway script. The automated test suite runs hundreds of requests
  // per file against one in-memory server, which is a test-harness artefact, not a real client -
  // so the cap is relaxed (not removed) under NODE_ENV=test, same pattern as the stricter
  // /auth/token limiter.
  max: process.env.NODE_ENV === 'test' ? 100000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  // Same error shape as every other error (spec 6.6), not express-rate-limit's own default body.
  handler: (req, res, next) => {
    next(new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.'));
  },
});

module.exports = apiRateLimit;
