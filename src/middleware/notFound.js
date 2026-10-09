// Catch-all for any route that did not match: hands a 404 ApiError to the error handler.
'use strict';

const { ApiError } = require('../utils/errors');

function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

module.exports = notFound;
