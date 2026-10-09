// GenerationReading: append-only time series, one document per installation per timestamp.
// No updated_at, no version (see spec section 3.3) - readings are never updated, only created.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const generationReadingSchema = new mongoose.Schema(
  {
    installation_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SolarInstallation',
      required: true,
    },
    recorded_at: { type: Date, required: true },
    power_kw: { type: Number, required: true, min: 0 },
    energy_kwh: { type: Number, required: true, min: 0 },
    voltage_v: { type: Number, required: true },
    ingested_at: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

// Duplicate protection, range queries, latest lookup, sort both ways.
generationReadingSchema.index({ installation_id: 1, recorded_at: 1 }, { unique: true });
// Time-window scans across installations.
generationReadingSchema.index({ recorded_at: 1 });

generationReadingSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('GenerationReading', generationReadingSchema);
