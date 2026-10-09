// Thin controllers for /installations: parse the request with zod, call the service, send JSON.
// No auth/jurisdiction scoping yet - that is layered on in Phase 7 (SPEC.md section 17).
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam } = require('../schemas/common');
const { installationQuerySchema } = require('../schemas/installationQuery');
const installationService = require('../services/installationService');

async function listInstallations(req, res) {
  const validated = parseQuery(installationQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await installationService.listInstallations({
    validated,
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  res.status(200).json(result);
}

async function getInstallation(req, res) {
  const id = parseObjectIdParam(req.params.installationId, 'installationId');
  const installation = await installationService.getInstallationById(id);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  res.status(200).json(installation);
}

module.exports = { listInstallations, getInstallation };
