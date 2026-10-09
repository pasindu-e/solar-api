// District: mid-level jurisdiction, belongs to one Province.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const districtSchema = new mongoose.Schema(
  {
    province_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Province',
      required: true,
      index: true,
    },
    name: { type: String, required: true, unique: true },
    version: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

districtSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('District', districtSchema);
