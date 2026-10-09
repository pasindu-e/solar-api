// Query schemas for /installations and the scoped /grid-substations/{id}/installations.
'use strict';

const { z } = require('zod');
const { objectIdSchema, buildQuerySchema } = require('./common');

// Spec 6.3: whitelist of sortable fields for installations. No default field is given by the
// spec for this resource (unlike readings, which default to recency); we leave `sort` optional
// and, when absent, the service sorts by `_id` only (insertion order, deterministic).
const SORT_FIELDS = ['meter_id', 'capacity_kw', 'created_at'];
const STATUS_VALUES = ['active', 'inactive', 'decommissioned'];

const sortingShape = {
  sort: z.enum(SORT_FIELDS).optional(),
  // Default order is `asc` (our judgment - the spec only fixes a default for readings, "desc").
  order: z.enum(['asc', 'desc']).optional(),
};

// GET /installations - all jurisdiction filters plus status, sort, pagination.
const installationQuerySchema = buildQuerySchema({
  province_id: objectIdSchema.optional(),
  district_id: objectIdSchema.optional(),
  substation_id: objectIdSchema.optional(),
  status: z.enum(STATUS_VALUES).optional(),
  ...sortingShape,
});

// GET /grid-substations/{substationId}/installations - substation_id comes from the path, so
// only status/sort/pagination remain as query options.
const scopedInstallationQuerySchema = buildQuerySchema({
  status: z.enum(STATUS_VALUES).optional(),
  ...sortingShape,
});

module.exports = { installationQuerySchema, scopedInstallationQuerySchema, SORT_FIELDS };
