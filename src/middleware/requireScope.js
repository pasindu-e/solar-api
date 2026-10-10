// Scope check factory (spec 8.1, 8.4): requireScope('data:read') returns middleware that checks
// the token's space-separated scope string includes the required one. Missing scope -> 403
// FORBIDDEN. Must run after authenticate (needs req.auth).
'use strict';

const { ApiError } = require('../utils/errors');

function requireScope(required) {
  return function requireScopeMiddleware(req, res, next) {
    const scopeString = (req.auth && req.auth.scope) || '';
    const scopes = scopeString.split(' ').filter(Boolean);

    if (!scopes.includes(required)) {
      return next(ApiError.forbidden(`This action requires the "${required}" scope.`));
    }

    next();
  };
}

module.exports = requireScope;
