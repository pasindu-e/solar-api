// Content negotiation (spec 6.5, 8.4): 406 when the client's Accept header cannot be satisfied
// with JSON, 415 when a body-bearing request uses the wrong Content-Type. Mounted globally in
// app.js BEFORE express.json(), so a bad Content-Type is rejected before the body parser ever
// tries to read the body (spec 8.4's chain: "content negotiation (406/415) -> authenticate").
'use strict';

const { ApiError } = require('../utils/errors');

// True if this request is carrying a body: either a known Content-Length > 0, or chunked transfer
// encoding (no Content-Length given up front). GET/HEAD/DELETE never carry a body we validate.
function hasBody(req) {
  const contentLength = req.headers['content-length'];
  if (contentLength && Number(contentLength) > 0) return true;
  if (req.headers['transfer-encoding']) return true;
  return false;
}

function negotiate(req, res, next) {
  // 406: only checked when an Accept header is actually present (spec: "If Accept is present and
  // req.accepts('json') is false"). No Accept header at all is fine.
  if (req.headers.accept && !req.accepts('json')) {
    return next(new ApiError(406, 'NOT_ACCEPTABLE', 'This endpoint only produces application/json.'));
  }

  // 415: only for methods/requests that actually carry a body. GET/HEAD/DELETE are skipped
  // entirely even if they happen to carry a stray Content-Type header (spec, task judgment call).
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') {
    return next();
  }
  if (!hasBody(req)) {
    return next();
  }

  const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const allowed = req.method === 'PATCH'
    ? ['application/json', 'application/merge-patch+json']
    : ['application/json'];

  if (!allowed.includes(contentType)) {
    return next(
      new ApiError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        `Content-Type must be ${allowed.join(' or ')}.`
      )
    );
  }

  next();
}

module.exports = negotiate;
