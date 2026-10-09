// Query schemas for /districts and the scoped /provinces/{id}/districts.
'use strict';

const { objectIdSchema, buildQuerySchema } = require('./common');

// GET /districts?province_id=... - province_id is optional and, if present, must be a
// well-formed id. An invalid-but-well-formed province_id simply matches no districts (data: []);
// this phase does not validate that the filter value references a real province (see spec 6.2,
// which only requires that about path *parents*, not filter values).
const districtQuerySchema = buildQuerySchema({ province_id: objectIdSchema.optional() });

// GET /provinces/{provinceId}/districts - province_id comes from the path, not the query, so it
// is not an accepted query key here.
const scopedDistrictQuerySchema = buildQuerySchema();

module.exports = { districtQuerySchema, scopedDistrictQuerySchema };
