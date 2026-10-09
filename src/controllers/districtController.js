// Thin controllers for /districts: parse the request with zod, call the service, send JSON.
// No auth/jurisdiction scoping yet - that is layered on in Phase 7 (see docs/SPEC.md section 17).
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { districtQuerySchema } = require('../schemas/districtQuery');
const { scopedGridSubstationQuerySchema } = require('../schemas/gridSubstationQuery');
const districtService = require('../services/districtService');
const gridSubstationService = require('../services/gridSubstationService');

async function listDistricts(req, res) {
  const validated = parseQuery(districtQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await districtService.listDistricts({
    validated,
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

async function getDistrict(req, res) {
  const id = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(id);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }
  res.status(200).json(district);
}

// GET /districts/{districtId}/grid-substations - the district is a path parent: a malformed id
// is 400, a well-formed but unknown district is 404 (see src/routes/districts.js for reasoning
// shared with the equivalent province -> districts endpoint).
async function listGridSubstationsForDistrict(req, res) {
  const districtId = parseObjectIdParam(req.params.districtId, 'districtId');
  const district = await districtService.getDistrictById(districtId);
  if (!district) {
    throw ApiError.notFound('District not found.');
  }

  const validated = parseQuery(scopedGridSubstationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await gridSubstationService.listGridSubstations({
    validated: {},
    overrides: { district_id: districtId },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

module.exports = { listDistricts, getDistrict, listGridSubstationsForDistrict };
