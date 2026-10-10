// Body schema for POST /auth/token (spec 5.3, 8.2). Two grant types, each `.strict()` so an
// unknown field 400s. Every credential field is z.string() - zod rejects objects/arrays at the
// type level, so a NoSQL operator-injection payload such as {"email":{"$gt":""}} fails validation
// here and never reaches a database query (spec 8.5, 8.7's named test case).
'use strict';

const { z } = require('zod');

const passwordGrantSchema = z
  .object({
    grant_type: z.literal('password'),
    email: z.string().min(1, 'is required'),
    password: z.string().min(1, 'is required'),
  })
  .strict();

const deviceGrantSchema = z
  .object({
    grant_type: z.literal('device'),
    meter_id: z.string().min(1, 'is required'),
    device_secret: z.string().min(1, 'is required'),
  })
  .strict();

// A discriminated union on grant_type: an unknown grant_type value (anything other than the two
// literals above) fails with a clear "invalid literal" style issue, not a generic 400.
const tokenRequestSchema = z.discriminatedUnion('grant_type', [passwordGrantSchema, deviceGrantSchema]);

module.exports = { tokenRequestSchema };
