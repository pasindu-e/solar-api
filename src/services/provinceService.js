// Province queries: a plain paginated list and an atomic lookup by id.
'use strict';

const Province = require('../db/models/Province');
const { paginate } = require('../utils/pagination');

function listProvinces({ page, pageSize, basePath, query }) {
  return paginate({ Model: Province, filter: {}, sort: { _id: 1 }, page, pageSize, basePath, query });
}

function getProvinceById(id) {
  return Province.findById(id);
}

module.exports = { listProvinces, getProvinceById };
