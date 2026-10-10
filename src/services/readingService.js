// GenerationReading queries shared by every readings endpoint: the canonical per-installation
// collection and the three aggregated collections (substation/district/province). Each caller
// resolves its own list of installation ids (and validates its own narrowing filters - see the
// district/province controllers) and hands them to listReadingsForInstallationIds() here, so the
// date-range + mongoose.trusted() + pagination logic lives in exactly one place.
'use strict';

const mongoose = require('mongoose');
const GenerationReading = require('../db/models/GenerationReading');
const { paginate, emptyPage } = require('../utils/pagination');
const { ApiError } = require('../utils/errors');

const DAY_MS = 24 * 60 * 60 * 1000;

// Parses from/to (already validated as well-formed ISO strings by zod) into Date objects, checks
// from <= to (spec 6.2), and applies the "last 24 hours" default window for the three aggregated
// endpoints when neither bound was given (spec 5.3). The per-installation canonical endpoint does
// not apply this default - see the judgment-call note in installationController.js.
function resolveRange(validated, applyDefaultWindow) {
  const from = validated.from ? new Date(validated.from) : undefined;
  const to = validated.to ? new Date(validated.to) : undefined;

  if (from && to && from.getTime() > to.getTime()) {
    throw ApiError.badRequest('Invalid time window.', [
      { field: 'from', issue: 'must not be later than to' },
    ]);
  }

  if (!from && !to && applyDefaultWindow) {
    const now = new Date();
    return { gte: new Date(now.getTime() - DAY_MS), lte: now };
  }

  return { gte: from, lte: to };
}

// Spec 6.3: sort=timestamp maps to the stored field recorded_at; default order is desc for
// readings. _id is the deterministic tiebreaker so pages never overlap.
function buildSort(validated) {
  const direction = validated.order === 'asc' ? 1 : -1;
  return { recorded_at: direction, _id: direction };
}

// installationIds: array of ObjectId (already resolved and, for the aggregated endpoints,
// already validated against the path parent / narrowing filters by the caller).
// applyDefaultWindow: true for the three aggregated endpoints, false for the per-installation one.
async function listReadingsForInstallationIds({
  installationIds,
  validated,
  applyDefaultWindow,
  page,
  pageSize,
  basePath,
  query,
}) {
  const range = resolveRange(validated, applyDefaultWindow);

  if (installationIds.length === 0) {
    return emptyPage({ page, pageSize, basePath, query });
  }

  // installation_id is a value we built ourselves from already-resolved ObjectIds (never raw
  // request input), and recorded_at is built from parsed Date objects - both are wrapped in
  // mongoose.trusted() so `sanitizeFilter: true` (src/db/connect.js) does not strip the $in/$gte/
  // $lte operators we constructed server-side.
  const filter = { installation_id: mongoose.trusted({ $in: installationIds }) };
  const recordedAtFilter = {};
  if (range.gte) recordedAtFilter.$gte = range.gte;
  if (range.lte) recordedAtFilter.$lte = range.lte;
  if (Object.keys(recordedAtFilter).length > 0) {
    filter.recorded_at = mongoose.trusted(recordedAtFilter);
  }

  const sort = buildSort(validated);
  return paginate({ Model: GenerationReading, filter, sort, page, pageSize, basePath, query });
}

// POST /installations/{id}/readings (spec 5.4a). A duplicate (installation_id, recorded_at) throws
// Mongo's E11000 - left to bubble up to the global error handler, which already maps it to 409
// DUPLICATE_READING (src/middleware/errorHandler.js), so it is not caught here.
function createReading(data) {
  return GenerationReading.create(data);
}

// GET /installations/{id}/readings/{readingId}: 404 (not 403) if the reading belongs to a
// different installation than the one in the path (spec 5.3).
async function getReadingForInstallation(installationId, readingId) {
  const reading = await GenerationReading.findById(readingId);
  if (!reading) return null;
  if (String(reading.installation_id) !== String(installationId)) return null;
  return reading;
}

// GET /installations/{id}/last-known-reading and the same lookup reused inside /overview.
function getLastKnownReading(installationId) {
  return GenerationReading.findOne({ installation_id: installationId }).sort({
    recorded_at: -1,
    _id: -1,
  });
}

// Used only by /overview: total reading count plus the first ever recorded_at, run together with
// the other overview lookups in one Promise.all batch so overview stays a bounded set of queries.
async function getReadingSummary(installationId) {
  const [total, first] = await Promise.all([
    GenerationReading.countDocuments({ installation_id: installationId }),
    GenerationReading.findOne({ installation_id: installationId }).sort({ recorded_at: 1, _id: 1 }),
  ]);
  return {
    total_readings: total,
    first_recorded_at: first ? first.recorded_at : null,
  };
}

module.exports = {
  listReadingsForInstallationIds,
  createReading,
  getReadingForInstallation,
  getLastKnownReading,
  getReadingSummary,
};
