// GridSubstation queries: a paginated list (optionally filtered by district_id/province_id) and
// an atomic lookup.
'use strict';

const GridSubstation = require('../db/models/GridSubstation');
const { paginate } = require('../utils/pagination');

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

module.exports = { listGridSubstations, getGridSubstationById, buildFilter };
