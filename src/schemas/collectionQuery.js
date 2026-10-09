// Query schema for plain, unfiltered collection listings (currently just /provinces): pagination
// only, anything else is an unknown parameter and must 400 (spec 6.2).
'use strict';

const { buildQuerySchema } = require('./common');

const collectionQuerySchema = buildQuerySchema();

module.exports = { collectionQuerySchema };
