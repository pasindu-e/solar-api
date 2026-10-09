// Thin controllers for /provinces: parse the request with zod, call the service, send JSON.
// No auth/jurisdiction scoping yet - that is layered on in Phase 7 (see docs/SPEC.md section 17).
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { collectionQuerySchema } = require('../schemas/collectionQuery');
const { scopedDistrictQuerySchema } = require('../schemas/districtQuery');
const provinceService = require('../services/provinceService');
const districtService = require('../services/districtService');

// Express 5 forwards a rejected async handler's promise to the error middleware automatically,
// so these controllers do not need their own try/catch.

async function listProvinces(req, res) {
  const validated = parseQuery(collectionQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await provinceService.listProvinces({
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

async function getProvince(req, res) {
  const id = parseObjectIdParam(req.params.provinceId, 'provinceId');
  const province = await provinceService.getProvinceById(id);
  if (!province) {
    throw ApiError.notFound('Province not found.');
  }
  res.status(200).json(province);
}

// GET /provinces/{provinceId}/districts - the province is a path parent: a malformed id is 400,
// a well-formed but unknown province is 404 (see src/routes/provinces.js for the full reasoning).
async function listDistrictsForProvince(req, res) {
  const provinceId = parseObjectIdParam(req.params.provinceId, 'provinceId');
  const province = await provinceService.getProvinceById(provinceId);
  if (!province) {
    throw ApiError.notFound('Province not found.');
  }

  const validated = parseQuery(scopedDistrictQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await districtService.listDistricts({
    validated: {},
    overrides: { province_id: provinceId },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

module.exports = { listProvinces, getProvince, listDistrictsForProvince };
