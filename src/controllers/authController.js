// Thin controller for POST /auth/token: parse the body with zod, dispatch to the right grant,
// send the token response (spec 5.3).
'use strict';

const { parseBody } = require('../schemas/common');
const { tokenRequestSchema } = require('../schemas/authSchema');
const authService = require('../services/authService');

async function issueToken(req, res) {
  const body = parseBody(tokenRequestSchema, req.body);

  const result =
    body.grant_type === 'password' ? await authService.passwordGrant(body) : await authService.deviceGrant(body);

  res.status(200).json(result);
}

module.exports = { issueToken };
