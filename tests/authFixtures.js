// Auth test fixtures (Phase 7). Two kinds of helper:
//   1. Pure token signers (nationalToken, adminToken, provinceToken, districtToken, deviceToken,
//      tamperedToken, expiredUserToken) - craft a JWT directly with jsonwebtoken, matching
//      authService's claim shapes exactly. No database row is needed for these: once issued, a
//      token is self-contained, so existing Phase 4/5/6 read-path tests only need a quick national
//      token to keep their original "see everything" assumptions working.
//   2. seedAuthFixtures(base) - inserts real Users (bcrypt-hashed passwords) and two extra
//      SolarInstallations (one active, one decommissioned, both with a known bcrypt-hashed device
//      secret) on top of an existing seedFixtures() dataset, for tests that exercise the real
//      POST /auth/token endpoint end to end.
'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const User = require('../src/db/models/User');
const SolarInstallation = require('../src/db/models/SolarInstallation');

const PASSWORD = 'Demo123!';
const DEVICE_SECRET = 'demo-secret-TEST';
// Low bcrypt cost factor keeps the test suite fast; bcrypt.compare does not care what cost factor
// was used to hash, only that it matches.
const BCRYPT_COST = 4;

function signToken(payload, expiresIn) {
  return jwt.sign(payload, config.jwtSecret, {
    algorithm: 'HS256',
    issuer: config.jwtIssuer,
    expiresIn,
  });
}

function nationalToken() {
  return signToken(
    {
      sub: 'user:000000000000000000000001',
      scope: 'data:read',
      role: 'national_analyst',
      jurisdiction: { level: 'national' },
    },
    '1h'
  );
}

function adminToken() {
  return signToken(
    {
      sub: 'user:000000000000000000000002',
      scope: 'data:read registry:write',
      role: 'admin',
      jurisdiction: { level: 'national' },
    },
    '1h'
  );
}

function provinceToken(provinceId) {
  return signToken(
    {
      sub: 'user:000000000000000000000003',
      scope: 'data:read',
      role: 'provincial_analyst',
      jurisdiction: { level: 'province', province_id: String(provinceId) },
    },
    '1h'
  );
}

function districtToken(provinceId, districtId) {
  return signToken(
    {
      sub: 'user:000000000000000000000004',
      scope: 'data:read',
      role: 'district_analyst',
      jurisdiction: { level: 'district', province_id: String(provinceId), district_id: String(districtId) },
    },
    '1h'
  );
}

function deviceToken(installationId) {
  return signToken(
    {
      sub: `installation:${installationId}`,
      scope: 'readings:write',
      installation_id: String(installationId),
    },
    '24h'
  );
}

// A token signed with the WRONG secret (simulates a tampered/forged token).
function tamperedToken() {
  return jwt.sign(
    { sub: 'user:000000000000000000000005', scope: 'data:read', jurisdiction: { level: 'national' } },
    'not-the-real-secret',
    { algorithm: 'HS256', issuer: config.jwtIssuer, expiresIn: '1h' }
  );
}

// A token that is already expired (exp in the past).
function expiredUserToken() {
  return signToken(
    {
      sub: 'user:000000000000000000000006',
      scope: 'data:read',
      role: 'national_analyst',
      jurisdiction: { level: 'national' },
    },
    '-10s'
  );
}

// Inserts real DB rows for tests that exercise POST /auth/token itself: one user per role/level,
// using fixtures.js's provinces/districts, plus one extra active and one extra decommissioned
// installation with a known device secret (fixtures.js's own installations don't have real
// bcrypt-hashed secrets - they use placeholder strings like "test-hash-1").
async function seedAuthFixtures(base) {
  const passwordHash = bcrypt.hashSync(PASSWORD, BCRYPT_COST);

  const nationalUser = await new User({
    email: 'national.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'National Test User',
    role: 'national_analyst',
  }).save();

  const adminUser = await new User({
    email: 'admin.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'Admin Test User',
    role: 'admin',
  }).save();

  const provincialWestern = await new User({
    email: 'provincial.western.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'Western Provincial Test User',
    role: 'provincial_analyst',
    province_id: base.provinces.western._id,
  }).save();

  const provincialCentral = await new User({
    email: 'provincial.central.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'Central Provincial Test User',
    role: 'provincial_analyst',
    province_id: base.provinces.central._id,
  }).save();

  const districtColombo = await new User({
    email: 'district.colombo.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'Colombo District Test User',
    role: 'district_analyst',
    district_id: base.districts.colombo._id,
  }).save();

  const districtKandy = await new User({
    email: 'district.kandy.security-test@slsea.demo',
    password_hash: passwordHash,
    full_name: 'Kandy District Test User',
    role: 'district_analyst',
    district_id: base.districts.kandy._id,
  }).save();

  const secretHash = bcrypt.hashSync(DEVICE_SECRET, BCRYPT_COST);

  const activeInstallation = await SolarInstallation.create({
    substation_id: base.substations.colomboSub._id,
    district_id: base.districts.colombo._id,
    province_id: base.provinces.western._id,
    meter_id: 'SL-MTR-SECURITY-ACTIVE',
    capacity_kw: 4,
    status: 'active',
    device_secret_hash: secretHash,
  });

  const inactiveInstallation = await SolarInstallation.create({
    substation_id: base.substations.colomboSub._id,
    district_id: base.districts.colombo._id,
    province_id: base.provinces.western._id,
    meter_id: 'SL-MTR-SECURITY-INACTIVE',
    capacity_kw: 4,
    status: 'decommissioned',
    device_secret_hash: secretHash,
  });

  return {
    password: PASSWORD,
    deviceSecret: DEVICE_SECRET,
    users: {
      nationalUser,
      adminUser,
      provincialWestern,
      provincialCentral,
      districtColombo,
      districtKandy,
    },
    activeInstallation,
    inactiveInstallation,
  };
}

module.exports = {
  seedAuthFixtures,
  nationalToken,
  adminToken,
  provinceToken,
  districtToken,
  deviceToken,
  tamperedToken,
  expiredUserToken,
  PASSWORD,
  DEVICE_SECRET,
};
