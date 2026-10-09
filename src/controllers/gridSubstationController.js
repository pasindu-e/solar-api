// Thin controllers for /grid-substations: parse the request with zod, call the service, send
// JSON. No auth/jurisdiction scoping yet - that is layered on in Phase 7 (SPEC.md section 17).
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { gridSubstationQuerySchema } = require('../schemas/gridSubstationQuery');
const { scopedInstallationQuerySchema } = require('../schemas/installationQuery');
const gridSubstationService = require('../services/gridSubstationService');
const installationService = require('../services/installationService');

async function listGridSubstations(req, res) {
  const validated = parseQuery(gridSubstationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await gridSubstationService.listGridSubstations({
    validated,
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

async function getGridSubstation(req, res) {
  const id = parseObjectIdParam(req.params.substationId, 'substationId');
  const substation = await gridSubstationService.getGridSubstationById(id);
  if (!substation) {
    throw ApiError.notFound('Grid substation not found.');
  }
  res.status(200).json(substation);
}

// GET /grid-substations/{substationId}/installations - the substation is a path parent: a
// malformed id is 400, a well-formed but unknown substation is 404 (same reasoning as the other
// hierarchy scoped collections, see src/routes/gridSubstations.js).
async function listInstallationsForSubstation(req, res) {
  const substationId = parseObjectIdParam(req.params.substationId, 'substationId');
  const substation = await gridSubstationService.getGridSubstationById(substationId);
  if (!substation) {
    throw ApiError.notFound('Grid substation not found.');
  }

  const validated = parseQuery(scopedInstallationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await installationService.listInstallations({
    validated,
    overrides: { substation_id: substationId },
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

module.exports = { listGridSubstations, getGridSubstation, listInstallationsForSubstation };
