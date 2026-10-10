// Province queries: a plain paginated list and an atomic lookup by id.
'use strict';

const Province = require('../db/models/Province');
const { paginate } = require('../utils/pagination');

// filter: the jurisdiction scope filter (spec 8.3), {} for a national-level token. Merged into the
// SAME filter object used by both the list query and countDocuments inside paginate().
function listProvinces({ filter = {}, page, pageSize, basePath, query }) {
  return paginate({ Model: Province, filter, sort: { _id: 1 }, page, pageSize, basePath, query });
}

function getProvinceById(id) {
  return Province.findById(id);
}

module.exports = { listProvinces, getProvinceById };
