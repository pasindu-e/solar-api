// Shared zod building blocks: the 24-hex Mongo id schema, the page/page_size fields every
// collection endpoint accepts, and small helpers that turn a zod failure into an ApiError.
'use strict';

const { z } = require('zod');
const { ApiError } = require('../utils/errors');

// Spec 5.1: ids in URLs are a 24-character hex ObjectId string.
const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24 character hex id');

// Spec 6.1: page defaults to 1, page_size defaults to 50 and is capped at 500. z.coerce turns the
// incoming query string into a number before the integer/range checks run.
const pageSchema = z.coerce.number().int('must be an integer').min(1, 'must be >= 1').default(1);
const pageSizeSchema = z.coerce
  .number()
  .int('must be an integer')
  .min(1, 'must be >= 1')
  .max(500, 'must be <= 500')
  .default(50);

// Builds a query schema with the shared pagination fields plus whatever is passed in.
// `.strict()` is what makes an unknown query parameter a 400 (spec 6.2) - zod throws an
// "unrecognized_keys" issue for anything not listed here, including operator-injection keys like
// `district_id[$ne]` (which, under the `simple` query parser, arrives as a literal unknown key).
function buildQuerySchema(extraShape = {}) {
  return z
    .object({
      page: pageSchema,
      page_size: pageSizeSchema,
      ...extraShape,
    })
    .strict();
}

// Validates req.query against a schema, or throws a 400 VALIDATION_ERROR with per-field details.
function parseQuery(schema, query) {
  const result = schema.safeParse(query || {});
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.length > 0 ? issue.path.join('.') : '(query)',
      issue: issue.message,
    }));
    throw ApiError.badRequest('Query validation failed.', details);
  }
  return result.data;
}

// Validates a single path-param id, used before any database lookup (spec 5.1: a malformed id
// must be 400 VALIDATION_ERROR and must never reach Mongoose, where it would throw a CastError).
function parseObjectIdParam(value, fieldName) {
  const result = objectIdSchema.safeParse(value);
  if (!result.success) {
    throw ApiError.badRequest('Invalid identifier.', [
      { field: fieldName, issue: 'must be a 24 character hex id' },
    ]);
  }
  return result.data;
}

// Validates a JSON request body against a schema, or throws a 400 VALIDATION_ERROR with per-field
// details. Used by the auth token endpoint and reading ingestion (spec 8.5: every body field must
// be validated as a plain scalar, so an operator-object payload like {"email":{"$gt":""}} fails
// type-checking here and never reaches a database query).
function parseBody(schema, body) {
  const result = schema.safeParse(body || {});
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      // "unrecognized_keys" issues (an extra/unknown field) carry the offending names in
      // issue.keys rather than issue.path, so fall back to that before the generic '(body)'.
      field:
        issue.path.length > 0
          ? issue.path.join('.')
          : Array.isArray(issue.keys) && issue.keys.length > 0
            ? issue.keys.join(',')
            : '(body)',
      issue: issue.message,
    }));
    throw ApiError.badRequest('Request validation failed.', details);
  }
  return result.data;
}

module.exports = { objectIdSchema, buildQuerySchema, parseQuery, parseObjectIdParam, parseBody };
