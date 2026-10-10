// Body schemas for the installation registry write path (spec 5.3): POST (create), PUT (full
// replace, all writable fields required), PATCH (JSON merge patch, all fields optional). Every
// schema is `.strict()`, so a client-supplied district_id/province_id/version/device_secret_hash/
// _id/id (all server-derived or server-owned, never accepted from a client - spec 3.3) is rejected
// with 400 as an unrecognized key, exactly like POST already rejects them. That is the judgment
// call documented for PATCH: reject, don't silently ignore.
'use strict';

const { z } = require('zod');
const { objectIdSchema } = require('./common');

const STATUS_VALUES = ['active', 'inactive', 'decommissioned'];

const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');

// Writable fields, per the SolarInstallation model (src/db/models/SolarInstallation.js).
// substation_id/meter_id/capacity_kw are required by the model itself; owner_name/latitude/
// longitude/installed_at are optional there, but PUT (full replace) still requires them per spec
// 5.3 ("All writable fields required, else 400").
const fields = {
  substation_id: objectIdSchema,
  meter_id: z.string().min(1, 'is required'),
  owner_name: z.string().min(1).nullable(),
  capacity_kw: z.number().min(0.1, 'must be a number greater than or equal to 0.1'),
  status: z.enum(STATUS_VALUES),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  installed_at: isoDateString.nullable(),
};

const installationCreateSchema = z
  .object({
    substation_id: fields.substation_id,
    meter_id: fields.meter_id,
    owner_name: fields.owner_name.optional(),
    capacity_kw: fields.capacity_kw,
    status: fields.status.optional().default('active'),
    latitude: fields.latitude.optional(),
    longitude: fields.longitude.optional(),
    installed_at: fields.installed_at.optional(),
  })
  .strict();

// PUT: every writable field required (full replacement), none optional.
const installationReplaceSchema = z
  .object({
    substation_id: fields.substation_id,
    meter_id: fields.meter_id,
    owner_name: fields.owner_name,
    capacity_kw: fields.capacity_kw,
    status: fields.status,
    latitude: fields.latitude,
    longitude: fields.longitude,
    installed_at: fields.installed_at,
  })
  .strict();

// PATCH: every writable field optional (merge patch, RFC 7396). A field explicitly set to `null`
// deletes it (nullable fields only - meter_id/capacity_kw/status/substation_id cannot be nulled,
// since the installation would then be invalid).
const installationPatchSchema = z
  .object({
    substation_id: fields.substation_id.optional(),
    meter_id: fields.meter_id.optional(),
    owner_name: fields.owner_name.optional(),
    capacity_kw: fields.capacity_kw.optional(),
    status: fields.status.optional(),
    latitude: fields.latitude.optional(),
    longitude: fields.longitude.optional(),
    installed_at: fields.installed_at.optional(),
  })
  .strict();

module.exports = { installationCreateSchema, installationReplaceSchema, installationPatchSchema };
