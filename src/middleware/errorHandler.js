// The single global error handler. Every error in the app ends up here and leaves in one shape:
// { code, message, details, status, path, timestamp, request_id }.
'use strict';

const { ApiError } = require('../utils/errors');

// Builds the standard error body. Never includes a stack trace or raw driver/Mongo text.
function buildBody({ status, code, message, details, req }) {
  return {
    code,
    message,
    details: Array.isArray(details) ? details : [],
    status,
    path: req.originalUrl,
    timestamp: new Date().toISOString(),
    request_id: req.id || null,
  };
}

// Mongoose ValidationError -> { field, issue } details, without leaking raw Mongo text.
function detailsFromValidationError(err) {
  return Object.keys(err.errors || {}).map((field) => ({
    field,
    issue: 'is invalid',
  }));
}

function isMalformedJsonError(err) {
  return (
    err instanceof SyntaxError &&
    (err.status === 400 || err.statusCode === 400) &&
    'body' in err
  );
}

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

function duplicateKeyCode(err) {
  const keys = Object.keys((err && err.keyPattern) || {});
  if (keys.includes('installation_id') && keys.includes('recorded_at')) {
    return 'DUPLICATE_READING';
  }
  // Placeholder code: the spec only names DUPLICATE_READING explicitly for the reading
  // compound index. Other unique fields (meter_id, email, province code/name, ...) fall back
  // to this generic placeholder - flagged for the user's approval in the final report.
  return 'DUPLICATE_KEY';
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  try {
    if (err instanceof ApiError) {
      if (err.headers) {
        for (const [key, value] of Object.entries(err.headers)) {
          res.setHeader(key, value);
        }
      }
      return res
        .status(err.status)
        .json(buildBody({ status: err.status, code: err.code, message: err.message, details: err.details, req }));
    }

    if (isMalformedJsonError(err)) {
      return res.status(400).json(
        buildBody({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Request body is not valid JSON.',
          details: [],
          req,
        })
      );
    }

    if (err && err.name === 'CastError') {
      return res.status(400).json(
        buildBody({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Request contains an invalid identifier or value.',
          details: [{ field: err.path || 'unknown', issue: 'is not a valid value' }],
          req,
        })
      );
    }

    if (err && err.name === 'ValidationError' && err.errors) {
      return res.status(400).json(
        buildBody({
          status: 400,
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
          details: detailsFromValidationError(err),
          req,
        })
      );
    }

    if (isDuplicateKeyError(err)) {
      const code = duplicateKeyCode(err);
      return res.status(409).json(
        buildBody({
          status: 409,
          code,
          message: 'A resource with the same unique value already exists.',
          details: [],
          req,
        })
      );
    }

    // Unknown/unexpected error: never leak stack traces or raw driver/Mongo text.
    return res.status(500).json(
      buildBody({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        details: [],
        req,
      })
    );
  } catch (_handlerErr) {
    // The error handler itself must never crash the process.
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      details: [],
      status: 500,
      path: req.originalUrl || '',
      timestamp: new Date().toISOString(),
      request_id: req.id || null,
    });
  }
}

module.exports = errorHandler;
