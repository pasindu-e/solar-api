// Thin controllers for /districts: parse the request with zod, enforce jurisdiction (spec 8.3),
// call the service, send JSON.
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { districtQuerySchema, districtGenerationSummaryQuerySchema } = require('../schemas/districtQuery');
const { scopedGridSubstationQuerySchema } = require('../schemas/gridSubstationQuery');
const { districtReadingQuerySchema } = require('../schemas/readingQuery');
const { sendAtomicConditional, sendHashConditional } = require('../utils/conditional');
const { newestRecordedAt } = require('../utils/readingFreshness');
const {
  scopeFilter,
  assertResourceWithinJurisdiction,
  assertProvinceFilterInJurisdiction,
  assertSubstationFilterInJurisdiction,
} = require('../middleware/jurisdiction');
const districtService = require('../services/districtService');
const gridSubstationService = require('../services/gridSubstationService');
const installationService = require('../services/installationService');
const readingService = require('../services/readingService');

function districtScope(district) {
  return { province_id: district.province_id, district_id: district.id };
}

// GET /districts?province_id=... - province_id is a narrowing filter: it can only narrow the
// token's own scope, never widen beyond it (spec 8.3 point 3). The list itself is always further
// scoped by scopeFilter, even with no filter given at all.
async function listDistricts(req, res) {
  const validated = parseQuery(districtQuerySchema, req.query);
  if (validated.province_id) {
    assertProvinceFilterInJurisdiction(req.auth, validated.province_id);
  }

  const basePath = req.originalUrl.split('?')[0];
  const result = await districtService.listDistricts({
    validated,
    overrides: scopeFilter(req.auth),
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

async function getDistrict(req, res) {
  const id = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(id);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }
  assertResourceWithinJurisdiction(req.auth, districtScope(district));
  sendAtomicConditional(req, res, {
    resourceType: 'dist',
    id: district.id,
    version: district.version,
    lastModified: district.updated_at,
    body: district,
  });
}

// GET /districts/{districtId}/grid-substations - the district is a path parent: a malformed id
// is 400, a well-formed but unknown district is 404 (see src/routes/districts.js for reasoning
// shared with the equivalent province -> districts endpoint). The path parent is also a
// jurisdiction check (spec 8.3 point 1).
async function listGridSubstationsForDistrict(req, res) {
  const districtId = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(districtId);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }
  assertResourceWithinJurisdiction(req.auth, districtScope(district));

  const validated = parseQuery(scopedGridSubstationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await gridSubstationService.listGridSubstations({
    validated: {},
    overrides: { district_id: districtId, ...scopeFilter(req.auth) },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

// GET /districts/{districtId}/readings - readings across every installation of this district
// (spec 5.3). Filters: substation_id (optional, narrowing), from, to. Precedence (see
// provinceController.listReadingsForProvince for the full reasoning): path-parent-exists 404 ->
// path-parent-within-jurisdiction 403 -> narrowing-filter-belongs-to-path-parent 400 ->
// narrowing-filter-within-jurisdiction 403.
async function listReadingsForDistrict(req, res) {
  const districtId = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(districtId);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }
  assertResourceWithinJurisdiction(req.auth, districtScope(district));

  const validated = parseQuery(districtReadingQuerySchema, req.query);

  if (validated.substation_id) {
    const substation = await gridSubstationService.getGridSubstationById(validated.substation_id);
    if (!substation || String(substation.district_id) !== String(districtId)) {
      throw ApiError.badRequest('substation_id does not belong to this district.', [
        { field: 'substation_id', issue: 'must belong to the path district' },
      ]);
    }
    assertSubstationFilterInJurisdiction(req.auth, substation);
  }

  const installationFilter = { district_id: districtId };
  if (validated.substation_id) {
    installationFilter.substation_id = validated.substation_id;
  }
  Object.assign(installationFilter, scopeFilter(req.auth));
  const installationIds = await installationService.distinctInstallationIds(installationFilter);

  const basePath = req.originalUrl.split('?')[0];
  const result = await readingService.listReadingsForInstallationIds({
    installationIds,
    validated,
    applyDefaultWindow: true, // spec 5.3: aggregated readings default to the last 24h
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result, lastModified: newestRecordedAt(result.data) });
}

// GET /districts/{districtId}/generation-summary (spec 5.5) - a derived resource, so spec 8.3
// point 4 applies exactly like the atomic district GET: path-parent-exists 404 -> path-parent-
// within-jurisdiction 403. No query parameters are defined by the spec, so an unknown one (or an
// accidental page/page_size, which this endpoint does not support) still gets the normal 400.
async function getGenerationSummary(req, res) {
  const districtId = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(districtId);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }
  assertResourceWithinJurisdiction(req.auth, districtScope(district));
  parseQuery(districtGenerationSummaryQuerySchema, req.query);

  const summary = await districtService.getGenerationSummary(district);
  // Hash ETag (composite/derived resource, spec 6.4) over the exact body being sent. Last-Modified
  // is the data-derived as_of, not Date.now() - when as_of is null (no data today) there is nothing
  // meaningful to put in Last-Modified, so it is simply omitted.
  sendHashConditional(req, res, {
    body: summary,
    lastModified: summary.as_of ? new Date(summary.as_of) : undefined,
  });
}

module.exports = {
  listDistricts,
  getDistrict,
  listGridSubstationsForDistrict,
  listReadingsForDistrict,
  getGenerationSummary,
};
