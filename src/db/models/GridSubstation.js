// GridSubstation: grid node, belongs to one District. province_id is denormalised and
// server-derived from district_id - never accepted directly from a client.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const gridSubstationSchema = new mongoose.Schema(
  {
    district_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'District',
      required: true,
      index: true,
    },
    province_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Province',
      required: true,
    },
    name: { type: String, required: true },
    capacity_mva: { type: Number },
    version: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

gridSubstationSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('GridSubstation', gridSubstationSchema);
