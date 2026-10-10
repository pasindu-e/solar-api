// GridSubstation queries: a paginated list (optionally filtered by district_id/province_id) and
// an atomic lookup. Also the registry write path (spec 5.3, Phase 8): create, full replace (PUT,
// district_id immutable), merge patch (PATCH, same immutability rule) and delete, each with the
// If-Match/version-filtered atomic update (spec 6.4).
'use strict';

const GridSubstation = require('../db/models/GridSubstation');
const District = require('../db/models/District');
const SolarInstallation = require('../db/models/SolarInstallation');
const { paginate } = require('../utils/pagination');
const { ApiError } = require('../utils/errors');
const { checkIfMatch, computeAtomicETag } = require('../utils/conditional');

function buildFilter(validated, overrides = {}) {
  const filter = {};
  if (validated.district_id) {
    filter.district_id = validated.district_id;
  }
  if (validated.province_id) {
    filter.province_id = validated.province_id;
  }
  return { ...filter, ...overrides };
}

function listGridSubstations({ validated, overrides, page, pageSize, basePath, query }) {
  const filter = buildFilter(validated, overrides);
  return paginate({ Model: GridSubstation, filter, sort: { _id: 1 }, page, pageSize, basePath, query });
}

function getGridSubstationById(id) {
  return GridSubstation.findById(id);
}

// 400 (not 404 - same reasoning as installationService.resolveSubstation, spec 5.3) if district_id
// does not refer to an existing district.
async function resolveDistrict(districtId) {
  const district = await District.findById(districtId);
  if (!district) {
    throw ApiError.badRequest('district_id does not refer to an existing district.', [
      { field: 'district_id', issue: 'does not exist' },
    ]);
  }
  return district;
}

function enforceIfMatch(req, current) {
  const currentEtag = computeAtomicETag('sub', current.id, current.version);
  const result = checkIfMatch(req, currentEtag);
  if (result === false) {
    throw new ApiError(412, 'PRECONDITION_FAILED', 'The resource has changed since you last read it.');
  }
}

// See installationService.raceConflict for why a null findOneAndUpdate result (version changed
// between read and write) is surfaced as 412 rather than retried automatically.
function raceConflict() {
  return new ApiError(412, 'PRECONDITION_FAILED', 'The resource was modified concurrently; re-fetch and retry.');
}

// POST /grid-substations (spec 5.3). Derives province_id from district_id.
async function createGridSubstation(body) {
  const district = await resolveDistrict(body.district_id);
  return GridSubstation.create({
    district_id: district._id,
    province_id: district.province_id,
    name: body.name,
    capacity_mva: body.capacity_mva,
  });
}

// PUT /grid-substations/{id} (spec 5.3): full replacement. district_id is immutable - 400 if the
// body's value differs from the current one (no cascade to installations is needed). The body is
// still required to include district_id (full replacement of every writable field), it just must
// match.
async function replaceGridSubstation(id, body, req) {
  const current = await GridSubstation.findById(id);
  if (!current) throw ApiError.notFound('Grid substation not found.');
  enforceIfMatch(req, current);

  if (String(body.district_id) !== String(current.district_id)) {
    throw ApiError.badRequest('district_id is immutable and cannot be changed.', [
      { field: 'district_id', issue: 'is immutable' },
    ]);
  }

  const updated = await GridSubstation.findOneAndUpdate(
    { _id: id, version: current.version },
    { $set: { name: body.name, capacity_mva: body.capacity_mva }, $inc: { version: 1 } },
    { new: true, runValidators: true }
  );
  if (!updated) throw raceConflict();
  return updated;
}

// PATCH /grid-substations/{id} (spec 5.3): partial update, same immutability rule - only checked
// if district_id is present in the patch at all.
async function patchGridSubstation(id, body, req) {
  const current = await GridSubstation.findById(id);
  if (!current) throw ApiError.notFound('Grid substation not found.');
  enforceIfMatch(req, current);

  if (body.district_id !== undefined && String(body.district_id) !== String(current.district_id)) {
    throw ApiError.badRequest('district_id is immutable and cannot be changed.', [
      { field: 'district_id', issue: 'is immutable' },
    ]);
  }

  const setOps = {};
  const unsetOps = {};
  if (body.name !== undefined) setOps.name = body.name;
  if (body.capacity_mva !== undefined) {
    if (body.capacity_mva === null) unsetOps.capacity_mva = '';
    else setOps.capacity_mva = body.capacity_mva;
  }

  const update = { $inc: { version: 1 } };
  if (Object.keys(setOps).length > 0) update.$set = setOps;
  if (Object.keys(unsetOps).length > 0) update.$unset = unsetOps;

  const updated = await GridSubstation.findOneAndUpdate(
    { _id: id, version: current.version },
    update,
    { new: true, runValidators: true }
  );
  if (!updated) throw raceConflict();
  return updated;
}

// DELETE /grid-substations/{id} (spec 5.3): 409 GRID_SUBSTATION_HAS_INSTALLATIONS if any
// installation references it, else delete and 204. Repeat delete falls out as 404.
async function deleteGridSubstation(id) {
  const existing = await GridSubstation.findById(id);
  if (!existing) throw ApiError.notFound('Grid substation not found.');

  const hasInstallations = await SolarInstallation.exists({ substation_id: id });
  if (hasInstallations) {
    throw new ApiError(
      409,
      'GRID_SUBSTATION_HAS_INSTALLATIONS',
      'This grid substation has installations and cannot be deleted.'
    );
  }

  await GridSubstation.deleteOne({ _id: id });
}

module.exports = {
  listGridSubstations,
  getGridSubstationById,
  buildFilter,
  createGridSubstation,
  replaceGridSubstation,
  patchGridSubstation,
  deleteGridSubstation,
};
