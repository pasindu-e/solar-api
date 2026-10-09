// Province: top-level jurisdiction. Code and name are both unique.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const provinceSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

provinceSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('Province', provinceSchema);
