// ApiError: the one error type every route/middleware should throw for client-facing errors.
'use strict';

class ApiError extends Error {
  // status: HTTP status code, code: stable machine code, details: array of { field, issue }
  constructor(status, code, message, details = [], headers = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }

  static badRequest(message, details = []) {
    return new ApiError(400, 'VALIDATION_ERROR', message, details);
  }

  static notFound(message = 'Resource not found.', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }

  static forbidden(message = 'You do not have access to this resource.', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }

  static unauthenticated(message = 'Authentication is required.') {
    return new ApiError(401, 'UNAUTHENTICATED', message, [], {
      'WWW-Authenticate': 'Bearer',
    });
  }
}

module.exports = { ApiError };
