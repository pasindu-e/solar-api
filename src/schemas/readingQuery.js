// Query schemas for readings endpoints: the canonical per-installation collection and the three
// aggregated collections (substation/district/province), each adding its own narrowing filter.
'use strict';

const { z } = require('zod');
const { objectIdSchema, buildQuerySchema } = require('./common');

// Spec 6.2: "Build { recorded_at: { $gte, $lte } } from parsed Date values", so we only need to
// confirm the string parses to a valid date here - the controller/service does `new Date(value)`.
const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid ISO 8601 datetime');

// Spec 6.3: the only public sortable name for readings is "timestamp", mapped internally to the
// stored field `recorded_at`. Default order is "desc" (applied in the service, not here, since
// zod has no way to see "neither from nor to" when defaulting a single field).
const baseReadingShape = {
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  sort: z.enum(['timestamp']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
};

// GET /installations/{id}/readings and GET /grid-substations/{id}/readings - no extra filter,
// the parent id comes entirely from the path.
const readingQuerySchema = buildQuerySchema(baseReadingShape);

// GET /districts/{id}/readings - spec 5.3 adds an optional substation_id narrowing filter.
const districtReadingQuerySchema = buildQuerySchema({
  ...baseReadingShape,
  substation_id: objectIdSchema.optional(),
});

// GET /provinces/{id}/readings - spec 5.3 adds optional district_id and substation_id filters.
const provinceReadingQuerySchema = buildQuerySchema({
  ...baseReadingShape,
  district_id: objectIdSchema.optional(),
  substation_id: objectIdSchema.optional(),
});

module.exports = { readingQuerySchema, districtReadingQuerySchema, provinceReadingQuerySchema };
