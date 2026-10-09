// SolarInstallation: the metered asset. meter_id is an attribute here (no separate devices
// collection - see spec section 3.2). district_id/province_id are denormalised and server-derived
// from substation_id.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const solarInstallationSchema = new mongoose.Schema(
  {
    substation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GridSubstation',
      required: true,
      index: true,
    },
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
      index: true,
    },
    meter_id: { type: String, required: true, unique: true },
    owner_name: { type: String },
    capacity_kw: { type: Number, required: true, min: 0.1 },
    status: {
      type: String,
      enum: ['active', 'inactive', 'decommissioned'],
      default: 'active',
    },
    latitude: { type: Number },
    longitude: { type: Number },
    installed_at: { type: Date },
    device_secret_hash: { type: String, required: true, select: false },
    version: { type: Number, default: 1 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

solarInstallationSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('SolarInstallation', solarInstallationSchema);
