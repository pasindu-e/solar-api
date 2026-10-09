// Query schemas for /grid-substations and the scoped /districts/{id}/grid-substations.
'use strict';

const { objectIdSchema, buildQuerySchema } = require('./common');

// GET /grid-substations?district_id=...&province_id=... - both optional, well-formed-id checked
// only (see districtQuery.js for why an invalid-but-well-formed value is left to match nothing).
const gridSubstationQuerySchema = buildQuerySchema({
  district_id: objectIdSchema.optional(),
  province_id: objectIdSchema.optional(),
});

// GET /districts/{districtId}/grid-substations - district_id comes from the path.
const scopedGridSubstationQuerySchema = buildQuerySchema();

module.exports = { gridSubstationQuerySchema, scopedGridSubstationQuerySchema };
