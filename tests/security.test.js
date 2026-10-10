// Security test matrix (spec 8.7) plus the auth endpoint and device ingestion rules (spec 5.4a,
// 8.2, 8.3, 8.5). Uses tests/fixtures.js for the hierarchy/installations/readings dataset and
// tests/authFixtures.js for real bcrypt-hashed users/devices (for the real POST /auth/token flow)
// plus quick directly-signed tokens (for jurisdiction/scope cases that don't need a real login).
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const {
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
} = require('./authFixtures');

let mongod;
let fixtures;
let authFx;

let national;
let admin;
let provinceWestern;
let provinceCentral;
let districtColombo;
let districtKandy;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
  authFx = await seedAuthFixtures(fixtures);

  national = nationalToken();
  admin = adminToken();
  provinceWestern = provinceToken(fixtures.provinces.western._id);
  provinceCentral = provinceToken(fixtures.provinces.central._id);
  districtColombo = districtToken(fixtures.provinces.western._id, fixtures.districts.colombo._id);
  districtKandy = districtToken(fixtures.provinces.central._id, fixtures.districts.kandy._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function bearer(token) {
  return `Bearer ${token}`;
}

// ---------------------------------------------------------------------------------------------
// POST /api/v1/auth/token
// ---------------------------------------------------------------------------------------------

describe('POST /api/v1/auth/token - password grant', () => {
  it('issues a token with the exact claim shape from spec 8.2 for a district user', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: authFx.users.districtColombo.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'Bearer', scope: 'data:read' });
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.expires_in).toBe(3600); // USER_TOKEN_TTL=1h in tests/env.setup.js

    const payload = require('jsonwebtoken').decode(res.body.access_token);
    expect(payload.sub).toBe(`user:${authFx.users.districtColombo._id}`);
    expect(payload.scope).toBe('data:read');
    expect(payload.role).toBe('district_analyst');
    expect(payload.jurisdiction).toEqual({
      level: 'district',
      province_id: String(fixtures.provinces.western._id),
      district_id: String(fixtures.districts.colombo._id),
    });
    expect(payload.iss).toBe('slsea-api');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
  });

  it('gives admin the "data:read registry:write" scope', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: authFx.users.adminUser.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('data:read registry:write');
  });

  it('returns the same generic 401 for an unknown email as for a wrong password (no user enumeration)', async () => {
    const unknownEmail = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: 'nobody@slsea.demo', password: PASSWORD });
    const wrongPassword = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: authFx.users.districtColombo.email, password: 'wrong' });

    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.body.code).toBe('UNAUTHENTICATED');
    expect(wrongPassword.body.code).toBe('UNAUTHENTICATED');
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('rejects the NoSQL operator-injection login payload {"email":{"$gt":""},"password":{"$gt":""}} with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: { $gt: '' }, password: { $gt: '' } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown grant_type with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'client_credentials', email: 'a@b.com', password: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects an extra/unknown body field with 400 (.strict())', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', email: 'a@b.com', password: 'x', extra: 'field' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/token - device grant', () => {
  it('issues a readings:write token with the exact claim shape from spec 8.2', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'device', meter_id: authFx.activeInstallation.meter_id, device_secret: DEVICE_SECRET });

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('readings:write');
    expect(res.body.expires_in).toBe(86400); // DEVICE_TOKEN_TTL=24h in tests/env.setup.js

    const payload = require('jsonwebtoken').decode(res.body.access_token);
    expect(payload.sub).toBe(`installation:${authFx.activeInstallation._id}`);
    expect(payload.scope).toBe('readings:write');
    expect(payload.installation_id).toBe(String(authFx.activeInstallation._id));
  });

  it('refuses an inactive/decommissioned installation with the same generic 401 (no enumeration of status)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'device',
        meter_id: authFx.inactiveInstallation.meter_id,
        device_secret: DEVICE_SECRET,
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('returns the same generic 401 for an unknown meter_id as for a wrong secret', async () => {
    const unknownMeter = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'device', meter_id: 'SL-MTR-DOES-NOT-EXIST', device_secret: DEVICE_SECRET });
    const wrongSecret = await request(app)
      .post('/api/v1/auth/token')
      .send({ grant_type: 'device', meter_id: authFx.activeInstallation.meter_id, device_secret: 'wrong' });

    expect(unknownMeter.status).toBe(401);
    expect(wrongSecret.status).toBe(401);
    expect(unknownMeter.body.message).toBe(wrongSecret.body.message);
  });
});

// ---------------------------------------------------------------------------------------------
// Spec 8.7 security test matrix
// ---------------------------------------------------------------------------------------------

describe('spec 8.7: No token on any endpoint -> 401', () => {
  it('GET /provinces with no Authorization header', async () => {
    const res = await request(app).get('/api/v1/provinces');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('GET /installations/:id with no Authorization header', async () => {
    const res = await request(app).get(`/api/v1/installations/${fixtures.instA._id}`);
    expect(res.status).toBe(401);
  });
});

describe('spec 8.7: Expired or tampered token -> 401', () => {
  it('a token signed with the wrong secret is rejected as INVALID_TOKEN', async () => {
    const res = await request(app).get('/api/v1/provinces').set('Authorization', bearer(tamperedToken()));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('an expired token is rejected as INVALID_TOKEN', async () => {
    const res = await request(app).get('/api/v1/provinces').set('Authorization', bearer(expiredUserToken()));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });
});

describe('spec 8.7: Device ingestion scope and ownership', () => {
  it('device POSTs a reading to its own installation -> 201 with Location', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: new Date(Date.now() - 60_000).toISOString(), power_kw: 1.5, energy_kwh: 10, voltage_v: 231 });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(
      `/api/v1/installations/${authFx.activeInstallation._id}/readings/${res.body.id}`
    );
    expect(res.body.power_kw).toBe(1.5);

    // The Location URL resolves for a user token...
    const getWithUser = await request(app).get(res.headers.location).set('Authorization', bearer(national));
    expect(getWithUser.status).toBe(200);
    // ...but the device itself cannot GET it (no data:read scope) - documented as deliberate.
    const getWithDevice = await request(app).get(res.headers.location).set('Authorization', bearer(token));
    expect(getWithDevice.status).toBe(403);
  });

  it('device POSTs a reading to another installation -> 403 (not 404, regardless of whether it exists)', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const res = await request(app)
      .post(`/api/v1/installations/${fixtures.instA._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('device calls any GET -> 403', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const res = await request(app).get('/api/v1/provinces').set('Authorization', bearer(token));
    expect(res.status).toBe(403);
  });

  it('a user token POSTing a reading -> 403', async () => {
    const res = await request(app)
      .post(`/api/v1/installations/${fixtures.instA._id}/readings`)
      .set('Authorization', bearer(national))
      .send({ recorded_at: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(403);
  });

  it('device POSTs to a decommissioned installation -> 403 INSTALLATION_NOT_ACTIVE (token outlives decommissioning)', async () => {
    // Token signed directly for the already-inactive installation - simulates a device whose
    // token was issued before the installation was decommissioned (spec 8.2, 5.4a).
    const token = deviceToken(authFx.inactiveInstallation._id);
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.inactiveInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: new Date().toISOString(), power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSTALLATION_NOT_ACTIVE');
  });

  it('rejects a body containing installation_id (or any unknown field) with 400', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({
        installation_id: String(authFx.activeInstallation._id),
        recorded_at: new Date().toISOString(),
        power_kw: 1,
        energy_kwh: 1,
        voltage_v: 230,
      });
    expect(res.status).toBe(400);
  });

  // Phase 11 audit (spec section 11: "negative power (400)"). The zod schema already rejects
  // power_kw < 0 (src/schemas/readingIngest.js), but no test exercised it end to end - gap closed.
  it('rejects a negative power_kw with 400', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: new Date().toISOString(), power_kw: -1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a recorded_at more than 5 minutes in the future with 400', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: future, power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(400);
  });

  it('accepts a late/out-of-order past timestamp with 201', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const past = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send({ recorded_at: past, power_kw: 1, energy_kwh: 1, voltage_v: 230 });
    expect(res.status).toBe(201);
  });

  it('a duplicate (installation_id, recorded_at) gives 409 DUPLICATE_READING', async () => {
    const token = deviceToken(authFx.activeInstallation._id);
    const recordedAt = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const body = { recorded_at: recordedAt, power_kw: 1, energy_kwh: 1, voltage_v: 230 };

    const first = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/installations/${authFx.activeInstallation._id}/readings`)
      .set('Authorization', bearer(token))
      .send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('DUPLICATE_READING');
  });
});

describe('spec 8.7: District-level jurisdiction', () => {
  it('district user reads own district -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.colombo._id}`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(200);
  });

  it('district user reads another district -> 403 OUT_OF_JURISDICTION', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.kandy._id}`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('district user reads an installation in another district -> 403', async () => {
    const res = await request(app)
      .get(`/api/v1/installations/${fixtures.kandyInstallation._id}`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('district user reads another district\'s readings sub-collection -> 403', async () => {
    const res = await request(app)
      .get(`/api/v1/installations/${fixtures.kandyInstallation._id}/readings`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(403);
  });

  it("district user reads another district's /districts/{id}/readings -> 403", async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.kandy._id}/readings`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  // district summary (/districts/{id}/generation-summary): Phase 9 completes this row - see
  // tests/generationSummary.test.js's "jurisdiction" describe block for the full matrix (district,
  // province, national/admin, in and out of scope).

  it('district user lists /installations -> only own-district documents, correct total', async () => {
    const res = await request(app).get('/api/v1/installations').set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(200);
    // 5 from fixtures.js's Colombo substation, plus the 2 extra Colombo-district installations
    // seedAuthFixtures() adds for the device-grant tests - all belong to the Colombo district.
    expect(res.body.pagination.total).toBe(7);
    expect(
      res.body.data.every((inst) => inst.district_id === String(fixtures.districts.colombo._id))
    ).toBe(true);
  });

  it('district user adds ?district_id=<other> -> 403', async () => {
    const res = await request(app)
      .get(`/api/v1/installations?district_id=${fixtures.districts.kandy._id}`)
      .set('Authorization', bearer(districtColombo));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('isolation holds in both directions: the Kandy district user cannot read Colombo either', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.colombo._id}`)
      .set('Authorization', bearer(districtKandy));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });
});

describe('spec 8.1: admin has data:read (plus registry:write) and so can still read everything', () => {
  it('admin reads a province outside any single jurisdiction scope (admin is national-level) -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/provinces/${fixtures.provinces.central._id}`)
      .set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
  });

  it('admin lists /installations with no jurisdiction restriction -> sees every installation', async () => {
    const res = await request(app).get('/api/v1/installations').set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    // 6 from fixtures.js + 2 from seedAuthFixtures().
    expect(res.body.pagination.total).toBe(8);
  });
});

describe('spec 8.7: Province-level jurisdiction', () => {
  it('province user reads a district inside their province -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.colombo._id}`)
      .set('Authorization', bearer(provinceWestern));
    expect(res.status).toBe(200);
  });

  it('province user reads a district outside their province -> 403', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.kandy._id}`)
      .set('Authorization', bearer(provinceWestern));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('province user is not affected by a different province token (sanity check)', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.kandy._id}`)
      .set('Authorization', bearer(provinceCentral));
    expect(res.status).toBe(200);
  });
});

describe('spec 8.7: NoSQL injection defences on real routes (with a valid token attached)', () => {
  it('?district_id[$ne]=x on /installations -> 400', async () => {
    const res = await request(app)
      .get('/api/v1/installations?district_id[$ne]=x')
      .set('Authorization', bearer(national));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('?province_id[$ne]=x on /districts -> 400', async () => {
    const res = await request(app)
      .get('/api/v1/districts?province_id[$ne]=x')
      .set('Authorization', bearer(national));
    expect(res.status).toBe(400);
  });

  it('?district_id[$ne]=x on /grid-substations -> 400', async () => {
    const res = await request(app)
      .get('/api/v1/grid-substations?district_id[$ne]=x')
      .set('Authorization', bearer(national));
    expect(res.status).toBe(400);
  });
});

describe('spec 8.7: unknown query parameter still 400s once auth is required', () => {
  it('GET /installations?bogus=1 with a valid token -> 400, not 401', async () => {
    const res = await request(app).get('/api/v1/installations?bogus=1').set('Authorization', bearer(national));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// Non-admin attempts to create/PUT/PATCH/DELETE an installation (spec 8.7's row) cannot be
// exercised yet: those registry write routes do not exist until Phase 8 (spec 17's build order).
// No route is fabricated here just to pass this row - it is intentionally left untested until
// Phase 8 adds POST/PUT/PATCH/DELETE /installations, at which point requireScope('registry:write')
// is already wired to reject anyone without it, by construction of src/middleware/requireScope.js.
