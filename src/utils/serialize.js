// Shared Mongoose toJSON transform: _id -> id (string), drop __v and any secret hash fields.
'use strict';

// Applied via schema.set('toJSON', toJSONOptions) on every model.
const toJSONOptions = {
  virtuals: false,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id ? String(ret._id) : ret.id;
    delete ret._id;
    delete ret.__v;
    delete ret.password_hash;
    delete ret.device_secret_hash;
    return ret;
  },
};

module.exports = { toJSONOptions };
