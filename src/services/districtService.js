// District queries: a paginated list (optionally filtered by province_id) and an atomic lookup.
'use strict';

const District = require('../db/models/District');
const { paginate } = require('../utils/pagination');

// Builds the Mongo filter from already-validated query values. Only plain equality is used here
// (no $-operators), so there is nothing that needs mongoose.trusted() wrapping in this phase.
function buildFilter(validated, overrides = {}) {
  const filter = {};
  if (validated.province_id) {
    filter.province_id = validated.province_id;
  }
  return { ...filter, ...overrides };
}

function listDistricts({ validated, overrides, page, pageSize, basePath, query }) {
  const filter = buildFilter(validated, overrides);
  return paginate({ Model: District, filter, sort: { _id: 1 }, page, pageSize, basePath, query });
}

function getDistrictById(id) {
  return District.findById(id);
}

module.exports = { listDistricts, getDistrictById, buildFilter };
