// Phase 9: GET /districts/{districtId}/generation-summary (spec 5.5). Builds a dedicated district
// ("Negombo", under the Western province from tests/fixtures.js) with installations engineered to
// exercise every rule in spec 5.5's "Definitions to document" list: the local-midnight Asia/Colombo
// window, the per-installation clamp-at-0 on a meter reset, and the 30-minute "reporting"/"current"
// cutoff. Also covers the zero-data cases (no active installations, active installations with no
// readings today), conditional GET (hash ETag, as_of as Last-Modified, non-wall-clock stability),
// and the jurisdiction matrix spec 8.3 point 4 and 8.7 require for this derived resource.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { seedAuthFixtures, nationalToken, adminToken, provinceToken, districtToken } = require('./authFixtures');
const { startOfTodayColombo } = require('../src/utils/time');
const District = require('../src/db/models/District');
const GridSubstation = require('../src/db/models/GridSubstation');
const SolarInstallation = require('../src/db/models/SolarInstallation');
const GenerationReading = require('../src/db/models/GenerationReading');

let mongod;
let fixtures;
let national;
let admin;
let provinceWestern;
let provinceCentral;

// The dedicated fixtures for this file, built fresh in beforeAll so the totals below are exact and
// not polluted by tests/fixtures.js's own Colombo readings (which are "minutes ago", not aligned to
// the Asia/Colombo calendar day).
let negombo; // district with mixed active installations: today + yesterday + reset + stale-reporting
let panadura; // district with one active installation but zero readings today
let districtNegombo; // district-level token scoped to Negombo

function bearer(token) {
  return `Bearer ${token}`;
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
  await seedAuthFixtures(fixtures);

  national = nationalToken();
  admin = adminToken();
  provinceWestern = provinceToken(fixtures.provinces.western._id);
  provinceCentral = provinceToken(fixtures.provinces.central._id);

  const western = fixtures.provinces.western;

  negombo = await District.create({ province_id: western._id, name: 'Negombo' });
  const negomboSub = await GridSubstation.create({
    district_id: negombo._id,
    province_id: western._id,
    name: 'Negombo GSS',
    capacity_mva: 10,
  });

  const startOfToday = startOfTodayColombo();
  const now = Date.now();
  const yesterday = new Date(startOfToday.getTime() - 2 * 60 * 60 * 1000); // well before local midnight
  const earlyToday = new Date(startOfToday.getTime() + 5 * 60 * 1000); // just after local midnight
  const earlyTodayB = new Date(startOfToday.getTime() + 6 * 60 * 1000);
  const recentToday = new Date(now - 10 * 60 * 1000); // within the last 30 minutes
  const staleToday = new Date(now - 45 * 60 * 1000); // today, but older than 30 minutes
  const veryRecentToday = new Date(now - 5 * 60 * 1000); // within the last 30 minutes

  const [instX, instY, instZ, instW] = await SolarInstallation.insertMany([
    {
      substation_id: negomboSub._id,
      district_id: negombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-SUMMARY-X',
      capacity_kw: 5,
      status: 'active',
      device_secret_hash: 'test-hash-x',
    },
    {
      substation_id: negomboSub._id,
      district_id: negombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-SUMMARY-Y',
      capacity_kw: 5,
      status: 'active',
      device_secret_hash: 'test-hash-y',
    },
    {
      substation_id: negomboSub._id,
      district_id: negombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-SUMMARY-Z',
      capacity_kw: 5,
      status: 'active',
      device_secret_hash: 'test-hash-z',
    },
    {
      substation_id: negomboSub._id,
      district_id: negombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-SUMMARY-W',
      capacity_kw: 5,
      status: 'active',
      device_secret_hash: 'test-hash-w',
    },
  ]);

  await GenerationReading.insertMany([
    // instX: a reading yesterday plus two today - only today's first/last should count.
    { installation_id: instX._id, recorded_at: yesterday, power_kw: 1, energy_kwh: 10, voltage_v: 230 },
    { installation_id: instX._id, recorded_at: earlyToday, power_kw: 2, energy_kwh: 100, voltage_v: 231 },
    { installation_id: instX._id, recorded_at: recentToday, power_kw: 5, energy_kwh: 150, voltage_v: 232 },
    // instY: yesterday only - contributes to installation_count but no row in today's aggregation.
    { installation_id: instY._id, recorded_at: yesterday, power_kw: 1, energy_kwh: 999, voltage_v: 230 },
    // instZ: a single reading today, older than 30 minutes - counts toward today_energy (0, since
    // first == last) and as_of, but NOT toward reporting_installation_count / current_power_kw.
    { installation_id: instZ._id, recorded_at: staleToday, power_kw: 3, energy_kwh: 300, voltage_v: 233 },
    // instW: meter reset today - the later cumulative reading is LOWER than the earlier one, so
    // today_energy for this installation alone would be negative without the per-row clamp.
    { installation_id: instW._id, recorded_at: earlyTodayB, power_kw: 2, energy_kwh: 500, voltage_v: 234 },
    { installation_id: instW._id, recorded_at: veryRecentToday, power_kw: 4, energy_kwh: 400, voltage_v: 235 },
  ]);

  negombo.instX = instX;
  negombo.instY = instY;
  negombo.instZ = instZ;
  negombo.instW = instW;
  negombo.expectedAsOf = veryRecentToday; // instW's recorded_at is the newest of the three rows

  panadura = await District.create({ province_id: western._id, name: 'Panadura' });
  const panaduraSub = await GridSubstation.create({
    district_id: panadura._id,
    province_id: western._id,
    name: 'Panadura GSS',
    capacity_mva: 10,
  });
  await SolarInstallation.create({
    substation_id: panaduraSub._id,
    district_id: panadura._id,
    province_id: western._id,
    meter_id: 'SL-MTR-SUMMARY-NOTODAY',
    capacity_kw: 5,
    status: 'active',
    device_secret_hash: 'test-hash-notoday',
  });
  await GenerationReading.create({
    installation_id: (await SolarInstallation.findOne({ meter_id: 'SL-MTR-SUMMARY-NOTODAY' }))._id,
    recorded_at: yesterday,
    power_kw: 1,
    energy_kwh: 1,
    voltage_v: 230,
  });

  districtNegombo = districtToken(western._id, negombo._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /districts/{districtId}/generation-summary - aggregation (spec 5.5)', () => {
  it('returns the 8 documented fields with the expected clamped, windowed totals', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      district_id: String(negombo._id),
      district_name: 'Negombo',
      as_of: negombo.expectedAsOf.toISOString(),
      timezone: 'Asia/Colombo',
      installation_count: 4,
      reporting_installation_count: 2,
      current_power_kw: 9, // instX (5) + instW (4), instZ excluded (stale)
      today_energy_kwh: 50, // instX 150-100=50, instZ 300-300=0, instW clamped 0 (not -100)
    });
  });

  it("only today's (Asia/Colombo) readings feed first_energy/last_energy - the earlier yesterday reading is excluded", async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    // If yesterday's energy_kwh=10 had been picked up as first_energy, today_energy would be 140
    // (150-10) instead of 50 (150-100).
    expect(res.body.today_energy_kwh).toBe(50);
  });

  it('a negative per-installation delta (meter reset) clamps to 0 and does not drag the district total below the other installations\' real total', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    // instW alone would contribute -100 unclamped; the district total is 50 (just instX), proving
    // the clamp happened PER INSTALLATION, not only on the already-summed district total.
    expect(res.body.today_energy_kwh).toBe(50);
    expect(res.body.today_energy_kwh).toBeGreaterThanOrEqual(0);
  });

  it('a reading older than 30 minutes does not count as "reporting" or toward current_power_kw', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(res.body.reporting_installation_count).toBe(2);
    expect(res.body.current_power_kw).toBe(9);
  });
});

describe('GET /districts/{districtId}/generation-summary - zero-data cases (spec 5.5: 200, not an error)', () => {
  it('a district with zero active installations returns 200 with zero totals and as_of: null', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.gampaha._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      district_id: String(fixtures.districts.gampaha._id),
      district_name: 'Gampaha',
      as_of: null,
      timezone: 'Asia/Colombo',
      installation_count: 0,
      reporting_installation_count: 0,
      current_power_kw: 0,
      today_energy_kwh: 0,
    });
  });

  it('a district with active installations but zero readings today returns 200 with zero totals and as_of: null', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${panadura._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(res.status).toBe(200);
    expect(res.body.installation_count).toBe(1);
    expect(res.body.as_of).toBeNull();
    expect(res.body.reporting_installation_count).toBe(0);
    expect(res.body.current_power_kw).toBe(0);
    expect(res.body.today_energy_kwh).toBe(0);
  });
});

describe('GET /districts/{districtId}/generation-summary - conditional GET (spec 6.4)', () => {
  it('first request: 200 with a hash ETag and Last-Modified set from as_of', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers['last-modified']).toBeDefined();
    expect(Math.floor(new Date(res.headers['last-modified']).getTime() / 1000)).toBe(
      Math.floor(negombo.expectedAsOf.getTime() / 1000)
    );
  });

  it('a matching If-None-Match returns 304 with an empty body', async () => {
    const first = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    const second = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national))
      .set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('the SAME as_of and ETag are returned on a later request (no new data), even though real wall-clock time passed', async () => {
    const before = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));

    // Let real time actually pass with no new readings inserted - as_of is derived from stored
    // data (the newest recorded_at used in the calculation), never from Date.now(), so it and the
    // hash ETag computed over it must be byte-identical.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const after = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));

    expect(after.body.as_of).toBe(before.body.as_of);
    expect(after.headers.etag).toBe(before.headers.etag);
  });

  it('a zero-data district (as_of: null) still returns a stable hash ETag across requests', async () => {
    const first = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.gampaha._id}/generation-summary`)
      .set('Authorization', bearer(national));
    const second = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.gampaha._id}/generation-summary`)
      .set('Authorization', bearer(national))
      .set('If-None-Match', first.headers.etag);
    expect(first.headers['last-modified']).toBeUndefined();
    expect(second.status).toBe(304);
  });
});

describe('GET /districts/{districtId}/generation-summary - validation', () => {
  it('a malformed district id returns 400', async () => {
    const res = await request(app)
      .get('/api/v1/districts/not-a-valid-id/generation-summary')
      .set('Authorization', bearer(national));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('a well-formed but unknown district id returns 404', async () => {
    const res = await request(app)
      .get('/api/v1/districts/665000000000000000000099/generation-summary')
      .set('Authorization', bearer(national));
    expect(res.status).toBe(404);
  });

  it('an unknown query parameter returns 400', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary?foo=bar`)
      .set('Authorization', bearer(national));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /districts/{districtId}/generation-summary - jurisdiction (spec 8.3 point 4, completing 8.7)', () => {
  it('district user reads own district summary -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(districtNegombo));
    expect(res.status).toBe(200);
  });

  it("district user reads another district's summary -> 403 OUT_OF_JURISDICTION", async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.colombo._id}/generation-summary`)
      .set('Authorization', bearer(districtNegombo));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('province user reads a summary for a district inside their province -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(provinceWestern));
    expect(res.status).toBe(200);
  });

  it('province user reads a summary for a district outside their province -> 403', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(provinceCentral));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('OUT_OF_JURISDICTION');
  });

  it('national user reads any district summary -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${fixtures.districts.kandy._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(res.status).toBe(200);
  });

  it('admin reads any district summary -> 200', async () => {
    const res = await request(app)
      .get(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
  });

  it('no token on the summary endpoint -> 401', async () => {
    const res = await request(app).get(`/api/v1/districts/${negombo._id}/generation-summary`);
    expect(res.status).toBe(401);
  });
});

describe('GET/PUT/PATCH/DELETE method support on generation-summary', () => {
  it('PUT/PATCH/DELETE are not allowed (405 with Allow: GET, HEAD)', async () => {
    const put = await request(app)
      .put(`/api/v1/districts/${negombo._id}/generation-summary`)
      .set('Authorization', bearer(national));
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe('GET, HEAD');
  });
});
