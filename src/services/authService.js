// Issues JWTs for the two grant types (spec 8.2). Password grant looks up a User, device grant
// looks up a SolarInstallation; both compare a bcrypt hash loaded explicitly via .select('+...')
// since the field is select:false on the model. Both failure paths (unknown identity, wrong
// secret, and - for devices - an inactive installation) throw the exact same generic 401, so a
// brute-force attempt cannot tell which case it hit (spec 8.2: "no user enumeration").
'use strict';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { ApiError } = require('../utils/errors');
const User = require('../db/models/User');
const SolarInstallation = require('../db/models/SolarInstallation');
const District = require('../db/models/District');

function invalidCredentials() {
  return new ApiError(401, 'UNAUTHENTICATED', 'Invalid credentials.');
}

function adminOrAnalystScope(role) {
  // Spec 8.1's table: admin gets "data:read registry:write", every other analyst role "data:read".
  return role === 'admin' ? 'data:read registry:write' : 'data:read';
}

// jsonwebtoken accepts "1h"/"24h" directly for `expiresIn`, but the token response body also
// needs `expires_in` in seconds (spec 5.3), so parse the same string ourselves.
function ttlToSeconds(ttl) {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) return 3600;
  const amount = Number(match[1]);
  const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return amount * unitSeconds;
}

async function passwordGrant({ email, password }) {
  const user = await User.findOne({ email }).select('+password_hash');
  if (!user) throw invalidCredentials();

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) throw invalidCredentials();

  // User token claims, exactly per spec 8.2's worked example: a district-level token carries
  // BOTH province_id and district_id, even though the User model (spec 3.3) only stores
  // district_id directly on a district_analyst - province_id is derived from the district's own
  // province_id, the same "server derives it, never stores it redundantly on the user" pattern
  // used for installations/substations elsewhere in this spec.
  const jurisdiction = { level: user.jurisdiction_level };
  if (user.jurisdiction_level === 'province' && user.province_id) {
    jurisdiction.province_id = String(user.province_id);
  }
  if (user.jurisdiction_level === 'district' && user.district_id) {
    const district = await District.findById(user.district_id);
    if (district) jurisdiction.province_id = String(district.province_id);
    jurisdiction.district_id = String(user.district_id);
  }

  const scope = adminOrAnalystScope(user.role);
  const ttl = config.userTokenTtl;
  const accessToken = jwt.sign(
    { sub: `user:${user._id}`, scope, role: user.role, jurisdiction },
    config.jwtSecret,
    { algorithm: 'HS256', issuer: config.jwtIssuer, expiresIn: ttl }
  );

  return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlToSeconds(ttl), scope };
}

async function deviceGrant({ meter_id, device_secret }) {
  const installation = await SolarInstallation.findOne({ meter_id }).select('+device_secret_hash');
  if (!installation) throw invalidCredentials();

  const secretMatches = await bcrypt.compare(device_secret, installation.device_secret_hash);
  if (!secretMatches) throw invalidCredentials();

  // Spec 8.2: "grant_type=device refuses installations that are not active." Same generic error
  // as the other two failure cases, so an inactive installation cannot be distinguished from a
  // wrong secret or an unknown meter_id.
  if (installation.status !== 'active') throw invalidCredentials();

  // Device token claims, exactly per spec 8.2's worked example.
  const scope = 'readings:write';
  const ttl = config.deviceTokenTtl;
  const accessToken = jwt.sign(
    { sub: `installation:${installation._id}`, scope, installation_id: String(installation._id) },
    config.jwtSecret,
    { algorithm: 'HS256', issuer: config.jwtIssuer, expiresIn: ttl }
  );

  return { access_token: accessToken, token_type: 'Bearer', expires_in: ttlToSeconds(ttl), scope };
}

module.exports = { passwordGrant, deviceGrant };
