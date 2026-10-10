// Thin controllers for /installations: parse the request with zod, enforce jurisdiction
// (spec 8.3) and scope (spec 8.1), call the service, send JSON. Also hosts device reading
// ingestion (spec 5.4a).
'use strict';

const { ApiError } = require('../utils/errors');
const { parseQuery, parseObjectIdParam, parseBody } = require('../schemas/common');
const { installationQuerySchema } = require('../schemas/installationQuery');
const { readingQuerySchema } = require('../schemas/readingQuery');
const { readingIngestSchema } = require('../schemas/readingIngest');
const {
  installationCreateSchema,
  installationReplaceSchema,
  installationPatchSchema,
} = require('../schemas/installationWrite');
const { sendAtomicConditional, sendHashConditional } = require('../utils/conditional');
const { newestRecordedAt } = require('../utils/readingFreshness');
const {
  scopeFilter,
  assertResourceWithinJurisdiction,
  assertProvinceFilterInJurisdiction,
  assertDistrictFilterInJurisdiction,
  assertSubstationFilterInJurisdiction,
  assertOwnInstallation,
} = require('../middleware/jurisdiction');
const installationService = require('../services/installationService');
const gridSubstationService = require('../services/gridSubstationService');
const districtService = require('../services/districtService');
const provinceService = require('../services/provinceService');
const readingService = require('../services/readingService');

function installationScope(installation) {
  return { province_id: installation.province_id, district_id: installation.district_id };
}

// GET /installations - province_id/district_id/substation_id are narrowing filters, each checked
// against the token's jurisdiction before being used to build the query (spec 8.3 point 3, 6.2:
// "filtering by an out-of-scope jurisdiction value returns 403, not an empty list").
async function listInstallations(req, res) {
  const validated = parseQuery(installationQuerySchema, req.query);

  if (validated.province_id) {
    assertProvinceFilterInJurisdiction(req.auth, validated.province_id);
  }
  if (validated.district_id) {
    const districtDoc = await districtService.getDistrictById(validated.district_id);
    assertDistrictFilterInJurisdiction(req.auth, validated.district_id, districtDoc);
  }
  if (validated.substation_id) {
    const substationDoc = await gridSubstationService.getGridSubstationById(validated.substation_id);
    assertSubstationFilterInJurisdiction(req.auth, substationDoc);
  }

  const basePath = req.originalUrl.split('?')[0];
  const result = await installationService.listInstallations({
    validated,
    overrides: scopeFilter(req.auth),
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result });
}

async function getInstallation(req, res) {
  const id = parseObjectIdParam(req.params.installationId, 'installationId');
  const installation = await installationService.getInstallationById(id);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, installationScope(installation));
  // Matches spec 6.4's own worked example: "inst-6650...-v3".
  sendAtomicConditional(req, res, {
    resourceType: 'inst',
    id: installation.id,
    version: installation.version,
    lastModified: installation.updated_at,
    body: installation,
  });
}

// GET /installations/{installationId}/readings - the canonical scoped readings collection (spec
// 5.3: "The per-installation collection stays the canonical scoped one"). Judgment call (flagged
// for confirmation): the "default to the last 24 hours when neither from nor to is given" rule is
// written under spec 5.3's "Rules for them" for the three *aggregated* (substation/district/
// province) readings endpoints, and its final bullet contrasts this per-installation endpoint
// against "them" ("The per-installation collection stays the canonical scoped one"). We read that
// as: the 24h default applies only to the three aggregated endpoints, so this endpoint returns the
// installation's full reading history (paginated) when no from/to is given. See
// listReadingsForInstallationIds's applyDefaultWindow flag below.
async function listReadingsForInstallation(req, res) {
  const installationId = parseObjectIdParam(req.params.installationId, 'installationId');
  const installation = await installationService.getInstallationById(installationId);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, installationScope(installation));

  const validated = parseQuery(readingQuerySchema, req.query);
  const basePath = req.originalUrl.split('?')[0];
  const result = await readingService.listReadingsForInstallationIds({
    installationIds: [installationId],
    validated,
    applyDefaultWindow: false,
    page: validated.page,
    pageSize: validated.page_size,
    basePath,
    query: validated,
  });
  sendHashConditional(req, res, { body: result, lastModified: newestRecordedAt(result.data) });
}

// GET /installations/{installationId}/readings/{readingId} - atomic reading. 404 (not 403, not a
// silent wrong-installation reading) if the reading exists but belongs to a different
// installation than the one in the path (spec 5.3). The jurisdiction check runs on the parent
// installation - a reading carries no province_id/district_id of its own (spec 3.3).
async function getReading(req, res) {
  const installationId = parseObjectIdParam(req.params.installationId, 'installationId');
  const readingId = parseObjectIdParam(req.params.readingId, 'readingId');

  const installation = await installationService.getInstallationById(installationId);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, installationScope(installation));

  const reading = await readingService.getReadingForInstallation(installationId, readingId);
  if (!reading) {
    throw ApiError.notFound('Reading not found.');
  }
  // Readings are immutable (no version): ETag comes from the id alone ("reading-<id>"),
  // Last-Modified from ingested_at (spec 6.4, verbatim).
  sendAtomicConditional(req, res, {
    resourceType: 'reading',
    id: reading.id,
    version: null,
    lastModified: reading.ingested_at,
    body: reading,
  });
}

// GET /installations/{installationId}/last-known-reading - derived, operational view. 404
// NO_READINGS (a stable code from spec 6.6) when the installation has never reported.
async function getLastKnownReading(req, res) {
  const installationId = parseObjectIdParam(req.params.installationId, 'installationId');
  const installation = await installationService.getInstallationById(installationId);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, installationScope(installation));

  const reading = await readingService.getLastKnownReading(installationId);
  if (!reading) {
    throw ApiError.notFound('No readings exist for this installation.', 'NO_READINGS');
  }
  // Judgment call: last-known-reading returns exactly one reading document, so it is treated the
  // same as the atomic reading endpoint (ETag from its own id, Last-Modified from ingested_at)
  // rather than hashing the body - consistent with "a single reading is always atomic" elsewhere.
  sendAtomicConditional(req, res, {
    resourceType: 'reading',
    id: reading.id,
    version: null,
    lastModified: reading.ingested_at,
    body: reading,
  });
}

// GET /installations/{installationId}/overview - composite view (spec 5.5). Built from a bounded
// set of queries run together with Promise.all (installation substation/district/province lookups
// plus the last-known-reading and reading-summary lookups), never one query per field in a loop.
// Judgment call: a brand-new installation with zero readings still returns 200, with
// last_known_reading: null and reading_summary.total_readings: 0 - spec 5.5's own example always
// shows a reading, but there is no reason a fresh installation should 404 here.
async function getOverview(req, res) {
  const installationId = parseObjectIdParam(req.params.installationId, 'installationId');
  const installation = await installationService.getInstallationById(installationId);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  assertResourceWithinJurisdiction(req.auth, installationScope(installation));

  const [substation, district, province, lastKnownReading, readingSummary] = await Promise.all([
    gridSubstationService.getGridSubstationById(installation.substation_id),
    districtService.getDistrictById(installation.district_id),
    provinceService.getProvinceById(installation.province_id),
    readingService.getLastKnownReading(installationId),
    readingService.getReadingSummary(installationId),
  ]);

  const body = {
    // Spec 5.5's example shows a trimmed subset of the installation, not the full document.
    installation: {
      id: installation.id,
      meter_id: installation.meter_id,
      capacity_kw: installation.capacity_kw,
      status: installation.status,
    },
    substation: substation ? { id: substation.id, name: substation.name } : null,
    district: district ? { id: district.id, name: district.name } : null,
    province: province ? { id: province.id, name: province.name } : null,
    last_known_reading: lastKnownReading ? lastKnownReading.toJSON() : null,
    reading_summary: readingSummary,
  };

  // Composite resource: ETag is a hash of the body (spec 6.4). Judgment call for Last-Modified
  // (spec gives no explicit example for overview): use the newest reading's recorded_at when one
  // exists (the most specific "this data changed" signal), falling back to the installation's own
  // updated_at for a fresh installation with zero readings. Both are data-derived, never
  // wall-clock time.
  const lastModified = lastKnownReading ? lastKnownReading.recorded_at : installation.updated_at;
  sendHashConditional(req, res, { body, lastModified });
}

// POST /installations/{installationId}/readings - device ingestion (spec 5.4a). Order: format-
// validate the path id (400) -> device-claim-vs-path check (403 FORBIDDEN, before any database
// lookup so a device can never distinguish a wrong installation from a nonexistent one) -> body
// validation (400; .strict() rejects installation_id or any other unknown field) -> future-
// timestamp rule (400) -> installation exists (404) and is active (403 INSTALLATION_NOT_ACTIVE) ->
// create (a duplicate (installation_id, recorded_at) becomes 409 DUPLICATE_READING via the
// existing global error handler, not handled here) -> 201 + Location.
async function postReading(req, res) {
  const installationId = parseObjectIdParam(req.params.installationId, 'installationId');
  assertOwnInstallation(req.auth, installationId);

  const body = parseBody(readingIngestSchema, req.body);

  const recordedAt = new Date(body.recorded_at);
  const maxFutureMs = Date.now() + 5 * 60 * 1000;
  if (recordedAt.getTime() > maxFutureMs) {
    throw ApiError.badRequest('recorded_at is too far in the future.', [
      { field: 'recorded_at', issue: 'must not be more than 5 minutes ahead of server time' },
    ]);
  }

  const installation = await installationService.getInstallationById(installationId);
  if (!installation) {
    throw ApiError.notFound('Installation not found.');
  }
  if (installation.status !== 'active') {
    throw new ApiError(403, 'INSTALLATION_NOT_ACTIVE', 'This installation is not active.');
  }

  const reading = await readingService.createReading({
    installation_id: installationId,
    recorded_at: recordedAt,
    power_kw: body.power_kw,
    energy_kwh: body.energy_kwh,
    voltage_v: body.voltage_v,
  });

  res
    .status(201)
    .set('Location', `/api/v1/installations/${installationId}/readings/${reading.id}`)
    .json(reading);
}

// POST /installations (spec 5.3, admin/registry:write). The device secret is a judgment call (see
// installationService.generateDeviceSecret): returned PLAINTEXT exactly once, under a field not in
// the standard installation shape (device_secret), since this is the only way an admin can ever
// hand a new device its credential.
async function createInstallation(req, res) {
  const body = parseBody(installationCreateSchema, req.body);
  const { installation, deviceSecret } = await installationService.createInstallation(body);
  const responseBody = installation.toJSON();
  responseBody.device_secret = deviceSecret;
  res
    .status(201)
    .set('Location', `/api/v1/installations/${installation.id}`)
    .json(responseBody);
}

// PUT /installations/{id} (spec 5.3, 5.4): full replacement only. If-Match/412 and the atomic
// version-filtered update happen in the service (spec 6.4).
async function replaceInstallation(req, res) {
  const id = parseObjectIdParam(req.params.installationId, 'installationId');
  const body = parseBody(installationReplaceSchema, req.body);
  const updated = await installationService.replaceInstallation(id, body, req);
  res.status(200).json(updated);
}

// PATCH /installations/{id} (spec 5.3): JSON merge patch.
async function patchInstallation(req, res) {
  const id = parseObjectIdParam(req.params.installationId, 'installationId');
  const body = parseBody(installationPatchSchema, req.body);
  const updated = await installationService.patchInstallation(id, body, req);
  res.status(200).json(updated);
}

// DELETE /installations/{id} (spec 5.3): 409 if readings exist, else 204 no body.
async function deleteInstallation(req, res) {
  const id = parseObjectIdParam(req.params.installationId, 'installationId');
  await installationService.deleteInstallation(id);
  res.status(204).end();
}

module.exports = {
  listInstallations,
  getInstallation,
  listReadingsForInstallation,
  getReading,
  getLastKnownReading,
  getOverview,
  postReading,
  createInstallation,
  replaceInstallation,
  patchInstallation,
  deleteInstallation,
};
