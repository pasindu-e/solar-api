// Body schemas for the grid-substation registry write path (spec 5.3): POST, PUT, PATCH.
// `.strict()` so a client-supplied province_id/version/_id/id (server-derived/owned, never
// accepted from a client - spec 3.3) is rejected with 400. district_id IS required on PUT (a full
// replace needs every writable field present) but is immutable - the service layer checks it still
// equals the current value, it is not just ignored here.
'use strict';

const { z } = require('zod');
const { objectIdSchema } = require('./common');

const fields = {
  district_id: objectIdSchema,
  name: z.string().min(1, 'is required'),
  capacity_mva: z.number().positive('must be a positive number').nullable(),
};

const substationCreateSchema = z
  .object({
    district_id: fields.district_id,
    name: fields.name,
    capacity_mva: fields.capacity_mva.optional(),
  })
  .strict();

// PUT: full replacement, every writable field required (district_id included, even though it must
// equal the current value - see gridSubstationService.replaceGridSubstation).
const substationReplaceSchema = z
  .object({
    district_id: fields.district_id,
    name: fields.name,
    capacity_mva: fields.capacity_mva,
  })
  .strict();

const substationPatchSchema = z
  .object({
    district_id: fields.district_id.optional(),
    name: fields.name.optional(),
    capacity_mva: fields.capacity_mva.optional(),
  })
  .strict();

module.exports = { substationCreateSchema, substationReplaceSchema, substationPatchSchema };
