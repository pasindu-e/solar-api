// Body schema for POST /installations/{id}/readings (spec 5.4a). `.strict()` rejects any unknown
// field, including `installation_id` - the installation comes only from the path, never the body.
'use strict';

const { z } = require('zod');

const readingIngestSchema = z
  .object({
    recorded_at: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid ISO 8601 datetime'),
    power_kw: z.number().min(0, 'must be a number greater than or equal to 0'),
    energy_kwh: z.number().min(0, 'must be a number greater than or equal to 0'),
    voltage_v: z
      .number()
      .gt(0, 'must be a number greater than 0')
      .max(500, 'must be a number less than or equal to 500'),
  })
  .strict();

module.exports = { readingIngestSchema };
