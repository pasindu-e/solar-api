// Thin controllers for /grid-substations: parse the request with zod, enforce jurisdiction
// (spec 8.3), call the service, send JSON.
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam, parseBody } = require('../schemas/common');
const { gridSubstationQuerySchema } = require('../schemas/gridSubstationQuery');
const {
  substationCreateSchema,
  substationReplaceSchema,
  substationPatchSchema,
} = require('../schemas/gridSubstationWrite');
const { scopedInstallationQuerySchema } = require('../schemas/installationQuery');
const { readingQuerySchema } = require('../schemas/readingQuery');
const { sendAtomicConditional, sendHashConditional } = require('../utils/conditional');
const { newestRecordedAt } = require('../utils/readingFreshness');
const {
  scopeFilter,
  assertResourceWithinJurisdiction,
  assertProvinceFilterInJurisdiction,
  assertDistrictFilterInJurisdiction,
} = require('../middleware/jurisdiction');
const districtService = require('../services/districtService');
const gridSubstationService = require('../services/gridSubstationService');
const installationService = require('../services/installationService');
const readingService = require('../services/readingService');

function substationScope(substation) {
  return { province_id: substation.province_id, district_id: substation.district_id };
}

// GET /grid-substations?district_id=...&province_id=... - both are narrowing filters, checked
// against the token's jurisdiction before they are used to build the query (spec 8.3 point 3).
async function listGridSubstations(req, res) {
  const validated = parseQuery(gridSubstationQuerySchema, req.query);

  if (validated.province_id) {
    assertProvinceFilterInJurisdiction(req.auth, validated.province_id);
  }
  if (validated.district_id) {
    const districtDoc = await districtService.getDistrictById(validated.district_id);
    assertDistrictFilterInJurisdiction(req.auth, validated.district_id, districtDoc);
  }

  const basePath = req.originalUrl.split('?')[0];
  const result = await gridSubstationService.listGridSubstations({
    validated,
    overrides: scopeFilter(req.auth),
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

async function getGridSubstation(req, res) {
  const id = parseObjectIdParam(req.params.substationId, 'substationId');
  const substation = await gridSubstationService.getGridSubstationById(id);
  if (!substation) {
    throw ApiError.notFound('Grid substation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, substationScope(substation));
  sendAtomicConditional(req, res, {
    resourceType: 'sub',
    id: substation.id,
    version: substation.version,
    lastModified: substation.updated_at,
    body: substation,
  });
}

// GET /grid-substations/{substationId}/installations - the substation is a path parent: a
// malformed id is 400, a well-formed but unknown substation is 404 (same reasoning as the other
// hierarchy scoped collections, see src/routes/gridSubstations.js). The path parent is also a
// jurisdiction check (spec 8.3 point 1).
async function listInstallationsForSubstation(req, res) {
  const substationId = parseObjectIdParam(req.params.substationId, 'substationId');
  const substation = await gridSubstationService.getGridSubstationById(substationId);
  if (!substation) {
    throw ApiError.notFound('Grid substation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, substationScope(substation));

  const validated = parseQuery(scopedInstallationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await installationService.listInstallations({
    validated,
    overrides: { substation_id: substationId, ...scopeFilter(req.auth) },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

// GET /grid-substations/{substationId}/readings - readings across every installation of this
// substation (spec 5.3). The substation is the path parent (malformed id 400, unknown 404, and
// now also a jurisdiction check); filters are from/to only (no narrowing filter is listed for this
// endpoint). If the substation has zero installations, short-circuit to an empty page rather than
// querying readings at all.
async function listReadingsForSubstation(req, res) {
  const substationId = parseObjectIdParam(req.params.substationId, 'substationId');
  const substation = await gridSubstationService.getGridSubstationById(substationId);
  if (!substation) {
    throw ApiError.notFound('Grid substation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, substationScope(substation));

  const validated = parseQuery(readingQuerySchema, req.query);
  const installationIds = await installationService.distinctInstallationIds({
    substation_id: substationId,
    ...scopeFilter(req.auth),
  });

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

// POST /grid-substations (spec 5.3, admin/registry:write).
async function createGridSubstation(req, res) {
  const body = parseBody(substationCreateSchema, req.body);
  const substation = await gridSubstationService.createGridSubstation(body);
  res.status(201).set('Location', `/api/v1/grid-substations/${substation.id}`).json(substation);
}

// PUT /grid-substations/{id} (spec 5.3): full replacement, district_id immutable (400 if changed).
async function replaceGridSubstation(req, res) {
  const id = parseObjectIdParam(req.params.substationId, 'substationId');
  const body = parseBody(substationReplaceSchema, req.body);
  const updated = await gridSubstationService.replaceGridSubstation(id, body, req);
  res.status(200).json(updated);
}

// PATCH /grid-substations/{id} (spec 5.3): partial update, same immutability rule.
async function patchGridSubstation(req, res) {
  const id = parseObjectIdParam(req.params.substationId, 'substationId');
  const body = parseBody(substationPatchSchema, req.body);
  const updated = await gridSubstationService.patchGridSubstation(id, body, req);
  res.status(200).json(updated);
}

// DELETE /grid-substations/{id} (spec 5.3): 409 if installations exist, else 204 no body.
async function deleteGridSubstation(req, res) {
  const id = parseObjectIdParam(req.params.substationId, 'substationId');
  await gridSubstationService.deleteGridSubstation(id);
  res.status(204).end();
}

module.exports = {
  listGridSubstations,
  getGridSubstation,
  listInstallationsForSubstation,
  listReadingsForSubstation,
  createGridSubstation,
  replaceGridSubstation,
  patchGridSubstation,
  deleteGridSubstation,
};
