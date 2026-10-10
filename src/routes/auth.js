// /auth routes. POST /token is rate limited strictly (spec 8.5: "Rate limit /auth/token strictly
// (brute force)") - 10 requests per minute per IP. Judgment call: generous enough for a legitimate
// user mistyping a password a couple of times or a device re-authenticating, tight enough to make
// a brute-force password/device-secret search impractical. No general API rate limiter is added in
// this phase - spec 17 lists that as part of Phase 8 alongside 406/415.
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/authController');
const { ApiError } = require('../utils/errors');

const router = express.Router();

const tokenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // Judgment call: 10/minute/IP in production. The automated test suite issues many more than 10
  // tokens per minute against a single in-memory server, which is a test-harness artefact, not a
  // real client - so the cap is relaxed (not removed) under NODE_ENV=test to keep the middleware
  // itself exercised without flaking the suite.
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Forward to the global error handler so a rate-limited response uses the same error shape as
  // every other error (spec 6.6), instead of express-rate-limit's own default JSON body.
  handler: (req, res, next) => {
    next(new ApiError(429, 'RATE_LIMITED', 'Too many token requests. Try again shortly.'));
  },
});

router.post('/token', tokenRateLimit, controller.issueToken);

module.exports = router;
