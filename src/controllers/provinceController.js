// Thin controllers for /provinces: parse the request with zod, enforce jurisdiction (spec 8.3),
// call the service, send JSON.
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { collectionQuerySchema } = require('../schemas/collectionQuery');
const { scopedDistrictQuerySchema } = require('../schemas/districtQuery');
const { provinceReadingQuerySchema } = require('../schemas/readingQuery');
const { sendAtomicConditional, sendHashConditional } = require('../utils/conditional');
const { newestRecordedAt } = require('../utils/readingFreshness');
const {
  scopeFilter,
  assertResourceWithinJurisdiction,
  assertDistrictFilterInJurisdiction,
  assertSubstationFilterInJurisdiction,
} = require('../middleware/jurisdiction');
const provinceService = require('../services/provinceService');
const districtService = require('../services/districtService');
const gridSubstationService = require('../services/gridSubstationService');
const installationService = require('../services/installationService');
const readingService = require('../services/readingService');

// Express 5 forwards a rejected async handler's promise to the error middleware automatically,
// so these controllers do not need their own try/catch.

async function listProvinces(req, res) {
  const validated = parseQuery(collectionQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  // Collection jurisdiction scoping (spec 8.3 point 2): merged into the same filter object used
  // by both the list query and countDocuments inside paginate() - see provinceService.
  const result = await provinceService.listProvinces({
    filter: scopeFilter(req.auth),
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  // Collection: ETag is a hash of the envelope (spec 6.4). No Last-Modified - there is no
  // meaningful single "modified" timestamp for a generic hierarchy listing (judgment call).
  sendHashConditional(req, res, { body: result });
}

async function getProvince(req, res) {
  const id = parseObjectIdParam(req.params.provinceId, 'provinceId');
  const province = await provinceService.getProvinceById(id);
  if (!province) {
    throw ApiError.notFound('Province not found.');
  }
  // Direct resource access jurisdiction check (spec 8.3 point 1), after the resource is loaded.
  assertResourceWithinJurisdiction(req.auth, { province_id: province.id, district_id: undefined });
  // Atomic resource: ETag from version ("prov-<id>-v<version>"), Last-Modified from updated_at.
  sendAtomicConditional(req, res, {
    resourceType: 'prov',
    id: province.id,
    version: province.version,
    lastModified: province.updated_at,
    body: province,
  });
}

// GET /provinces/{provinceId}/districts - the province is a path parent: a malformed id is 400,
// a well-formed but unknown province is 404 (see src/routes/provinces.js for the full reasoning).
// The path parent is also a jurisdiction check (spec 8.3 point 1), and the sub-collection list
// itself is further scoped (spec 8.3 point 2) - a district-level user hitting their own ancestor
// province still only sees their one district.
async function listDistrictsForProvince(req, res) {
  const provinceId = parseObjectIdParam(req.params.provinceId, 'provinceId');
  const province = await provinceService.getProvinceById(provinceId);
  if (!province) {
    throw ApiError.notFound('Province not found.');
  }
  assertResourceWithinJurisdiction(req.auth, { province_id: province.id, district_id: undefined });

  const validated = parseQuery(scopedDistrictQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await districtService.listDistricts({
    validated: {},
    overrides: { province_id: provinceId, ...scopeFilter(req.auth) },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

// GET /provinces/{provinceId}/readings - readings across the whole province (spec 5.3). Filters:
// district_id, substation_id, from, to. Precedence (judgment call, spec does not give this
// verbatim): path-parent-exists 404 -> path-parent-within-jurisdiction 403 -> narrowing-filter-
// belongs-to-path-parent 400 -> narrowing-filter-within-jurisdiction 403. Reasoning: existence and
// "is this even the right branch of the tree" (400) are cheaper, purely structural checks that do
// not depend on who is asking, so they run before the attribute-based jurisdiction check, which is
// the most expensive/most "this is personal" check and should have the last word. The resolved
// installation filter also always has scopeFilter(req.auth) merged in as defense in depth, so a
// district-level user reading their own ancestor province's readings still only sees their district.
async function listReadingsForProvince(req, res) {
  const provinceId = parseObjectIdParam(req.params.provinceId, 'provinceId');
  const province = await provinceService.getProvinceById(provinceId);
  if (!province) {
    throw ApiError.notFound('Province not found.');
  }
  assertResourceWithinJurisdiction(req.auth, { province_id: province.id, district_id: undefined });

  const validated = parseQuery(provinceReadingQuerySchema, req.query);

  let substationDoc = null;
  if (validated.district_id) {
    const district = await districtService.getDistrictById(validated.district_id);
    if (!district || String(district.province_id) !== String(provinceId)) {
      throw ApiError.badRequest('district_id does not belong to this province.', [
        { field: 'district_id', issue: 'must belong to the path province' },
      ]);
    }
    assertDistrictFilterInJurisdiction(req.auth, validated.district_id, district);
  }

  if (validated.substation_id) {
    substationDoc = await gridSubstationService.getGridSubstationById(validated.substation_id);
    if (!substationDoc || String(substationDoc.province_id) !== String(provinceId)) {
      throw ApiError.badRequest('substation_id does not belong to this province.', [
        { field: 'substation_id', issue: 'must belong to the path province' },
      ]);
    }
    if (validated.district_id && String(substationDoc.district_id) !== String(validated.district_id)) {
      throw ApiError.badRequest('substation_id does not belong to the given district.', [
        { field: 'substation_id', issue: 'must belong to the given district_id' },
      ]);
    }
    assertSubstationFilterInJurisdiction(req.auth, substationDoc);
  }

  const installationFilter = { province_id: provinceId };
  if (validated.district_id) installationFilter.district_id = validated.district_id;
  if (validated.substation_id) installationFilter.substation_id = validated.substation_id;
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
  // Readings collection: ETag is a hash of the envelope, Last-Modified is the newest recorded_at
  // in this specific page of results (spec 6.4's explicit example) - never wall-clock time.
  sendHashConditional(req, res, { body: result, lastModified: newestRecordedAt(result.data) });
}

module.exports = {
  listProvinces,
  getProvince,
  listDistrictsForProvince,
  listReadingsForProvince,
};
