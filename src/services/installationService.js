// SolarInstallation queries: a paginated, filterable, sortable list and an atomic lookup.
'use strict';

const SolarInstallation = require('../db/models/SolarInstallation');
const { paginate } = require('../utils/pagination');
const { SORT_FIELDS } = require('../schemas/installationQuery');

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

module.exports = {
  listInstallations,
  getInstallationById,
  distinctInstallationIds,
  buildFilter,
  buildSort,
};
