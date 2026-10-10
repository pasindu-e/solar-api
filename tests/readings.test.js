// Tests for Phase 5: the per-installation readings sub-collection and atomic reading, derived
// last-known-reading and overview, and the three aggregated (substation/district/province)
// readings collections - filtering, sorting, pagination, narrowing-filter validation, and the
// unknown-query-parameter / operator-injection 400 rules (spec 6.2).
// Phase 7 note: every GET now requires a valid token (spec 8.1, 8.4). A national-level token sees
// everything, preserving this file's original Phase 5 "no restriction" assumptions - jurisdiction
// scoping itself is covered separately in tests/security.test.js.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { nationalToken } = require('./authFixtures');

let mongod;
let fixtures;
let token;

function auth(req) {
  return req.set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
  token = nationalToken();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /api/v1/installations/:installationId/readings', () => {
  it('returns all readings for the installation (no default window for the per-installation endpoint)', async () => {
    const res = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`));
    expect(res.status).toBe(200);
    // instA has 4 readings fixtures, including one older than 24h.
    expect(res.body.pagination.total).toBe(4);
  });

  it('defaults to descending order by recorded_at', async () => {
    const res = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`));
    const times = res.body.data.map((r) => new Date(r.recorded_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('sorts ascending when order=asc', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?sort=timestamp&order=asc`)
    );
    const times = res.body.data.map((r) => new Date(r.recorded_at).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('filters by from/to, excluding the reading older than 24h', async () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?from=${from}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(3);
  });

  it('paginates with page_size=2', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?page=1&page_size=2`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ total: 4, page: 1, page_size: 2, total_pages: 2 });
  });

  it('rejects from > to with 400', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/installations/${fixtures.instA._id}/readings?from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z`
      )
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed from value with 400', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?from=not-a-date`)
    );
    expect(res.status).toBe(400);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const res = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?foo=bar`));
    expect(res.status).toBe(400);
  });

  it('rejects an operator-injection style query key with 400', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings?from[$ne]=x`)
    );
    expect(res.status).toBe(400);
  });

  it('400s for a malformed installation id', async () => {
    const res = await auth(request(app).get('/api/v1/installations/not-an-id/readings'));
    expect(res.status).toBe(400);
  });

  it('404s for a well-formed but unknown installation id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/installations/${unknownId}/readings`));
    expect(res.status).toBe(404);
  });

  it('rejects a request with no token at all with 401', async () => {
    const res = await request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/installations/:installationId/readings/:readingId', () => {
  it('returns the atomic reading', async () => {
    const reading = fixtures.readings[0];
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${reading._id}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(String(reading._id));
    expect(res.body.power_kw).toBe(reading.power_kw);
  });

  it('404s when the reading belongs to a different installation', async () => {
    const kandyReading = fixtures.readings.find(
      (r) => String(r.installation_id) === String(fixtures.kandyInstallation._id)
    );
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${kandyReading._id}`)
    );
    expect(res.status).toBe(404);
  });

  it('404s for a well-formed but unknown reading id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${unknownId}`)
    );
    expect(res.status).toBe(404);
  });

  it('400s for a malformed reading id', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/not-an-id`)
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/installations/:installationId/last-known-reading', () => {
  it('returns the newest reading for the installation', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/last-known-reading`)
    );
    expect(res.status).toBe(200);
    expect(res.body.power_kw).toBe(4); // the most recent instA fixture reading
  });

  it('returns 404 NO_READINGS when the installation has no readings', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instNoReadings._id}/last-known-reading`)
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_READINGS');
  });

  it('404s when the installation itself does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/installations/${unknownId}/last-known-reading`));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/installations/:installationId/overview', () => {
  it('returns the full composite shape with a real last-known reading and matching reading_summary', async () => {
    const res = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/overview`));
    expect(res.status).toBe(200);
    expect(res.body.installation).toEqual({
      id: String(fixtures.instA._id),
      meter_id: fixtures.instA.meter_id,
      capacity_kw: fixtures.instA.capacity_kw,
      status: fixtures.instA.status,
    });
    expect(res.body.substation).toEqual({
      id: String(fixtures.substations.colomboSub._id),
      name: 'Colombo GSS',
    });
    expect(res.body.district).toEqual({ id: String(fixtures.districts.colombo._id), name: 'Colombo' });
    expect(res.body.province).toEqual({ id: String(fixtures.provinces.western._id), name: 'Western' });
    expect(res.body.last_known_reading.power_kw).toBe(4);
    expect(res.body.reading_summary.total_readings).toBe(4);
    expect(res.body.reading_summary.first_recorded_at).toBeDefined();
  });

  it('returns last_known_reading: null and total_readings: 0 for an installation with no readings', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instNoReadings._id}/overview`)
    );
    expect(res.status).toBe(200);
    expect(res.body.last_known_reading).toBeNull();
    expect(res.body.reading_summary).toEqual({ total_readings: 0, first_recorded_at: null });
  });

  it('404s when the installation itself does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/installations/${unknownId}/overview`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/grid-substations/:substationId/readings', () => {
  it('aggregates readings from every installation under the substation', async () => {
    const res = await auth(
      request(app).get(`/api/v1/grid-substations/${fixtures.substations.colomboSub._id}/readings`)
    );
    expect(res.status).toBe(200);
    // Default 24h window: instA contributes 3 (excludes the 2-day-old one), instB contributes 2.
    expect(res.body.pagination.total).toBe(5);
  });

  it('returns an empty page when the substation has zero installations', async () => {
    const emptySub = await require('../src/db/models/GridSubstation').create({
      district_id: fixtures.districts.gampaha._id,
      province_id: fixtures.provinces.western._id,
      name: 'Empty GSS',
    });
    const res = await auth(request(app).get(`/api/v1/grid-substations/${emptySub._id}/readings`));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('404s for a well-formed but unknown substation id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/grid-substations/${unknownId}/readings`));
    expect(res.status).toBe(404);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const res = await auth(
      request(app).get(`/api/v1/grid-substations/${fixtures.substations.colomboSub._id}/readings?foo=bar`)
    );
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/districts/:districtId/readings', () => {
  it('aggregates readings across the whole district', async () => {
    const res = await auth(
      request(app).get(`/api/v1/districts/${fixtures.districts.colombo._id}/readings`)
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5); // same as the Colombo substation total
  });

  it('narrows correctly with a valid substation_id', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/districts/${fixtures.districts.colombo._id}/readings?substation_id=${fixtures.substations.colomboSub._id}`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5);
  });

  it('rejects a substation_id that does not belong to this district with 400', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/districts/${fixtures.districts.colombo._id}/readings?substation_id=${fixtures.substations.kandySub._id}`
      )
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the path parent district does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/districts/${unknownId}/readings`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/provinces/:provinceId/readings', () => {
  it('aggregates readings across the whole province', async () => {
    const res = await auth(
      request(app).get(`/api/v1/provinces/${fixtures.provinces.western._id}/readings`)
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5);
  });

  it('narrows correctly with a valid district_id and substation_id combination', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/provinces/${fixtures.provinces.western._id}/readings?district_id=${fixtures.districts.colombo._id}&substation_id=${fixtures.substations.colomboSub._id}`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(5);
  });

  it('rejects a district_id that does not belong to this province with 400', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/provinces/${fixtures.provinces.western._id}/readings?district_id=${fixtures.districts.kandy._id}`
      )
    );
    expect(res.status).toBe(400);
  });

  it('rejects a district_id/substation_id combination where the substation belongs to a different district with 400', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/provinces/${fixtures.provinces.central._id}/readings?district_id=${fixtures.districts.kandy._id}&substation_id=${fixtures.substations.colomboSub._id}`
      )
    );
    expect(res.status).toBe(400);
  });

  it('404s when the path parent province does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/provinces/${unknownId}/readings`));
    expect(res.status).toBe(404);
  });

  it('rejects a JSON-body operator injection payload with 400 on a different endpoint (sanity check)', async () => {
    // Readings endpoints are GET-only, so the body-injection case is exercised elsewhere (auth);
    // here we confirm the query-key form still 400s under the `simple` query parser.
    const res = await auth(
      request(app).get(`/api/v1/provinces/${fixtures.provinces.western._id}/readings?district_id[$ne]=x`)
    );
    expect(res.status).toBe(400);
  });
});
