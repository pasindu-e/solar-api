// Verifies the JWT bearer token (spec 8.2). Reads Authorization: Bearer <token> only - no cookies,
// no query-string tokens. Attaches the decoded payload to req.auth for every later middleware and
// controller to read (jurisdiction, scope, sub, role, installation_id).
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('../utils/errors');

// No token at all (missing/malformed header) -> 401 UNAUTHENTICATED.
// A token was supplied but is bad (wrong signature, wrong algorithm, wrong issuer, expired) ->
// 401 INVALID_TOKEN. Both are distinct stable codes in spec 6.6; this is the mapping used
// throughout this API. Both carry WWW-Authenticate: Bearer per the spec 7 status matrix.
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return next(ApiError.unauthenticated('A bearer token is required.'));
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next(ApiError.unauthenticated('A bearer token is required.'));
  }

  let payload;
  try {
    // Algorithm and issuer are pinned explicitly (spec 8.2: "Verify iss, exp and algorithm
    // explicitly"). jsonwebtoken checks exp automatically and throws TokenExpiredError.
    payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      issuer: config.jwtIssuer,
    });
  } catch (_err) {
    return next(
      new ApiError(401, 'INVALID_TOKEN', 'The access token is invalid or expired.', [], {
        'WWW-Authenticate': 'Bearer',
      })
    );
  }

  req.auth = payload;
  next();
}

module.exports = authenticate;
