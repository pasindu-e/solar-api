// SolarInstallation queries: a paginated, filterable, sortable list and an atomic lookup. Also the
// registry write path (spec 5.3, Phase 8): create, full replace (PUT), merge patch (PATCH) and
// delete, each enforcing the substation-exists check, the district_id/province_id denormalisation
// recompute (spec 3.3) and the If-Match/version-filtered atomic update (spec 6.4).
'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const SolarInstallation = require('../db/models/SolarInstallation');
const GridSubstation = require('../db/models/GridSubstation');
const GenerationReading = require('../db/models/GenerationReading');
const { paginate } = require('../utils/pagination');
const { SORT_FIELDS } = require('../schemas/installationQuery');
const { ApiError } = require('../utils/errors');
const { checkIfMatch, computeAtomicETag } = require('../utils/conditional');

function buildFilter(validated, overrides = {}) {
  const filter = {};
  if (validated.province_id) filter.province_id = validated.province_id;
  if (validated.district_id) filter.district_id = validated.district_id;
  if (validated.substation_id) filter.substation_id = validated.substation_id;
  if (validated.status) filter.status = validated.status;
  return { ...filter, ...overrides };
}

// Spec 6.3: whitelist only, never pass req.query.sort straight into .sort(); always add `_id` as
// a deterministic tiebreaker. With no `sort` given we sort by `_id` alone (insertion order).
function buildSort(validated) {
  if (!validated.sort || !SORT_FIELDS.includes(validated.sort)) {
    return { _id: 1 };
  }
  const direction = validated.order === 'desc' ? -1 : 1; // default order: asc (our judgment)
  return { [validated.sort]: direction, _id: 1 };
}

function listInstallations({ validated, overrides, page, pageSize, basePath, query }) {
  const filter = buildFilter(validated, overrides);
  const sort = buildSort(validated);
  return paginate({ Model: SolarInstallation, filter, sort, page, pageSize, basePath, query });
}

function getInstallationById(id) {
  return SolarInstallation.findById(id);
}

// Resolves installation ids for a jurisdiction/filter combination, e.g. { substation_id } or
// { district_id, substation_id }. Used by the aggregated readings endpoints (spec 5.3: "resolve
// installation ids for the parent [and filter], then query readings with installation_id: { $in:
// ids }"). filter is built entirely from already-validated path/query values, never raw input.
function distinctInstallationIds(filter) {
  return SolarInstallation.find(filter).distinct('_id');
}

// 400 (not 404 - spec 5.3 is explicit: a body field being validated, not a path parent) if
// substation_id does not refer to an existing grid substation.
async function resolveSubstation(substationId) {
  const substation = await GridSubstation.findById(substationId);
  if (!substation) {
    throw ApiError.badRequest('substation_id does not refer to an existing grid substation.', [
      { field: 'substation_id', issue: 'does not exist' },
    ]);
  }
  return substation;
}

// Judgment call (spec does not define how an admin-created installation gets a device secret):
// generate a random secret server-side, hash it with bcrypt the same way seed.js does, and return
// the plaintext ONCE from the create response (see installationController.createInstallation) -
// the only sane way an admin could ever provision a new device's credential through the API.
function generateDeviceSecret() {
  return crypto.randomBytes(24).toString('hex');
}

// POST /installations (spec 5.3). Derives district_id/province_id from substation_id (spec 3.3).
async function createInstallation(body) {
  const substation = await resolveSubstation(body.substation_id);
  const deviceSecret = generateDeviceSecret();
  const deviceSecretHash = bcrypt.hashSync(deviceSecret, 10);

  const installation = await SolarInstallation.create({
    substation_id: substation._id,
    district_id: substation.district_id,
    province_id: substation.province_id,
    meter_id: body.meter_id,
    owner_name: body.owner_name,
    capacity_kw: body.capacity_kw,
    status: body.status || 'active',
    latitude: body.latitude,
    longitude: body.longitude,
    installed_at: body.installed_at ? new Date(body.installed_at) : undefined,
    device_secret_hash: deviceSecretHash,
  });

  return { installation, deviceSecret };
}

// Throws 412 PRECONDITION_FAILED if the caller sent a stale If-Match. Returns 'absent' | true when
// the write may proceed.
function enforceIfMatch(req, resourceType, current) {
  const currentEtag = computeAtomicETag(resourceType, current.id, current.version);
  const result = checkIfMatch(req, currentEtag);
  if (result === false) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'The resource has changed since you last read it.');
  }
}

// Judgment call: if the version-filtered findOneAndUpdate returns null, the version changed
// between our read (for the If-Match check) and the write itself - a genuine race, distinct from
// an explicit stale If-Match. We surface this as the same 412 PRECONDITION_FAILED rather than
// retrying automatically: retrying blind could silently clobber a concurrent change the caller
// never saw, whereas 412 tells the client to re-GET and resubmit with a fresh ETag, which is the
// same recovery path they already need for an ordinary stale If-Match.
function raceConflict() {
  return new ApiError(412, 'PRECONDITION_FAILED', 'The resource was modified concurrently; re-fetch and retry.');
}

// PUT /installations/{id} (spec 5.3, 5.4): full replacement, always recomputes district_id/
// province_id from substation_id (spec 3.3 - no "if changed" ambiguity for a full replace).
async function replaceInstallation(id, body, req) {
  const current = await SolarInstallation.findById(id);
  if (!current) throw ApiError.notFound('Installation not found.');
  enforceIfMatch(req, 'inst', current);

  const substation = await resolveSubstation(body.substation_id);

  const updated = await SolarInstallation.findOneAndUpdate(
    { _id: id, version: current.version },
    {
      $set: {
        substation_id: substation._id,
        district_id: substation.district_id,
        province_id: substation.province_id,
        meter_id: body.meter_id,
        owner_name: body.owner_name,
        capacity_kw: body.capacity_kw,
        status: body.status,
        latitude: body.latitude,
        longitude: body.longitude,
        installed_at: body.installed_at ? new Date(body.installed_at) : null,
      },
      $inc: { version: 1 },
    },
    { new: true, runValidators: true }
  );
  if (!updated) throw raceConflict();
  return updated;
}

// PATCH /installations/{id} (spec 5.3): JSON merge patch. Only recomputes district_id/province_id
// when substation_id is present in the patch (spec 3.3: "on every ... PATCH that changes
// substation_id" - if it is absent, district_id/province_id are left untouched). A field explicitly
// set to null deletes it via $unset (RFC 7396), for the nullable fields only.
async function patchInstallation(id, body, req) {
  const current = await SolarInstallation.findById(id);
  if (!current) throw ApiError.notFound('Installation not found.');
  enforceIfMatch(req, 'inst', current);

  const setOps = {};
  const unsetOps = {};

  if (body.substation_id !== undefined) {
    const substation = await resolveSubstation(body.substation_id);
    setOps.substation_id = substation._id;
    setOps.district_id = substation.district_id;
    setOps.province_id = substation.province_id;
  }
  for (const field of ['meter_id', 'capacity_kw', 'status']) {
    if (body[field] !== undefined) setOps[field] = body[field];
  }
  for (const field of ['owner_name', 'latitude', 'longitude']) {
    if (body[field] !== undefined) {
      if (body[field] === null) unsetOps[field] = '';
      else setOps[field] = body[field];
    }
  }
  if (body.installed_at !== undefined) {
    if (body.installed_at === null) unsetOps.installed_at = '';
    else setOps.installed_at = new Date(body.installed_at);
  }

  const update = { $inc: { version: 1 } };
  if (Object.keys(setOps).length > 0) update.$set = setOps;
  if (Object.keys(unsetOps).length > 0) update.$unset = unsetOps;

  const updated = await SolarInstallation.findOneAndUpdate(
    { _id: id, version: current.version },
    update,
    { new: true, runValidators: true }
  );
  if (!updated) throw raceConflict();
  return updated;
}

// DELETE /installations/{id} (spec 5.3, 5.4): 409 INSTALLATION_HAS_READINGS if any reading exists,
// else delete and 204. Repeat delete on the same id falls out naturally as 404 (existence check).
async function deleteInstallation(id) {
  const existing = await SolarInstallation.findById(id);
  if (!existing) throw ApiError.notFound('Installation not found.');

  const hasReadings = await GenerationReading.exists({ installation_id: id });
  if (hasReadings) {
    throw new ApiError(
      409,
      'INSTALLATION_HAS_READINGS',
      'This installation has existing readings and cannot be deleted. Consider PATCH status=decommissioned instead.'
    );
  }

  await SolarInstallation.deleteOne({ _id: id });
}

module.exports = {
  listInstallations,
  getInstallationById,
  distinctInstallationIds,
  buildFilter,
  buildSort,
  createInstallation,
  replaceInstallation,
  patchInstallation,
  deleteInstallation,
};
