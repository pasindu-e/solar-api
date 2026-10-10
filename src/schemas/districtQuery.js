// Query schemas for /districts and the scoped /provinces/{id}/districts.
'use strict';

const { z } = require('zod');
const { objectIdSchema, buildQuerySchema } = require('./common');

// GET /districts?province_id=... - province_id is optional and, if present, must be a
// well-formed id. An invalid-but-well-formed province_id simply matches no districts (data: []);
// this phase does not validate that the filter value references a real province (see spec 6.2,
// which only requires that about path *parents*, not filter values).
const districtQuerySchema = buildQuerySchema({ province_id: objectIdSchema.optional() });

// GET /provinces/{provinceId}/districts - province_id comes from the path, not the query, so it
// is not an accepted query key here.
const scopedDistrictQuerySchema = buildQuerySchema();

// GET /districts/{districtId}/generation-summary - spec 5.5 defines no query parameters at all for
// this endpoint (it is a single derived snapshot, not a paginated collection), so this is a bare
// `z.object({}).strict()` rather than `buildQuerySchema({})`: the latter would silently accept and
// default `page`/`page_size`, which have no meaning here. An unknown key (including an
// operator-injection key like `foo[$ne]`) still gets the same 400 VALIDATION_ERROR (spec 6.2).
const districtGenerationSummaryQuerySchema = z.object({}).strict();

module.exports = { districtQuerySchema, scopedDistrictQuerySchema, districtGenerationSummaryQuerySchema };
