// Factory for 405 Method Not Allowed route handlers (spec: readings are append-only, "PUT, PATCH,
// DELETE on a reading return 405 Method Not Allowed with an Allow header"). Judgment call: these
// are mounted as plain route handlers with NO auth middleware in front of them at all - the verb
// itself is invalid for the resource no matter who is asking, so there is nothing to authenticate
// or authorize first. This is the simplest, most defensible reading of spec 8.4 (which gives no
// explicit guidance on where a 405 check sits relative to auth).
'use strict';

const { ApiError } = require('../utils/errors');

function methodNotAllowed(allow) {
  return function methodNotAllowedHandler(req, res, next) {
    next(
      new ApiError(405, 'METHOD_NOT_ALLOWED', `${req.method} is not allowed on this resource.`, [], {
        Allow: allow,
      })
    );
  };
}

module.exports = methodNotAllowed;
