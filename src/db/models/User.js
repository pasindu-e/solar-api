// User: SLSEA person. jurisdiction_level is always derived from role server-side, never
// settable by client input - see the pre('validate') hook below (spec section 3.3).
// Note: unlike the hierarchy models, spec 3.3 lists only `created_at` for users (no
// `updated_at`, no `version`), so timestamps are configured accordingly.
'use strict';

const mongoose = require('mongoose');
const { toJSONOptions } = require('../../utils/serialize');

const ROLE_TO_LEVEL = {
  national_analyst: 'national',
  admin: 'national',
  provincial_analyst: 'province',
  district_analyst: 'district',
};

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    password_hash: { type: String, required: true, select: false },
    full_name: { type: String, required: true },
    role: {
      type: String,
      enum: ['national_analyst', 'provincial_analyst', 'district_analyst', 'admin'],
      required: true,
    },
    jurisdiction_level: {
      type: String,
      enum: ['national', 'province', 'district'],
    },
    province_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Province' },
    district_id: { type: mongoose.Schema.Types.ObjectId, ref: 'District' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

// Always recompute jurisdiction_level from role, and enforce the required-if-level fields,
// regardless of whatever a caller may have set directly.
userSchema.pre('validate', function (next) {
  this.jurisdiction_level = ROLE_TO_LEVEL[this.role];

  if (this.jurisdiction_level === 'province' && !this.province_id) {
    this.invalidate('province_id', 'province_id is required for provincial_analyst users.');
  }
  if (this.jurisdiction_level === 'district' && !this.district_id) {
    this.invalidate('district_id', 'district_id is required for district_analyst users.');
  }

  next();
});

userSchema.set('toJSON', toJSONOptions);

module.exports = mongoose.model('User', userSchema);
