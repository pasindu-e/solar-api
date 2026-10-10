// Tests for /installations and /grid-substations/{id}/installations: filtering, sorting,
// pagination edges, and the malformed/unknown id + unknown query parameter rules.
// Phase 7 note: every GET now requires a valid token (spec 8.1, 8.4). A national-level token sees
// everything, preserving this file's original Phase 4 "no restriction" assumptions - jurisdiction
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

describe('GET /api/v1/installations', () => {
  it('paginates: page_size=2 page=1 of 6 total installations', async () => {
    const res = await auth(request(app).get('/api/v1/installations?page=1&page_size=2'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ total: 6, page: 1, page_size: 2, total_pages: 3 });
    expect(res.body.links.prev).toBeNull();
    expect(res.body.links.next).toBe('/api/v1/installations?page=2&page_size=2');
    expect(res.body.links.last).toBe('/api/v1/installations?page=3&page_size=2');
  });

  it('prev/next are both present on a middle page, next is null on the last page', async () => {
    const page2 = await auth(request(app).get('/api/v1/installations?page=2&page_size=2'));
    expect(page2.body.links.prev).toBe('/api/v1/installations?page=1&page_size=2');
    expect(page2.body.links.next).toBe('/api/v1/installations?page=3&page_size=2');

    const page3 = await auth(request(app).get('/api/v1/installations?page=3&page_size=2'));
    expect(page3.body.links.next).toBeNull();
    expect(page3.body.data).toHaveLength(2);
  });

  it('filters by status=inactive, returning only the inactive installation', async () => {
    const res = await auth(request(app).get('/api/v1/installations?status=inactive'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('inactive');
    expect(res.body.data[0].meter_id).toBe('SL-MTR-000003');
  });

  it('combines a jurisdiction filter and a status filter', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations?province_id=${fixtures.provinces.western._id}&status=active`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.every((i) => i.status === 'active')).toBe(true);
  });

  it('returns 200 with an empty data array when a filter matches nothing', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/installations?province_id=${fixtures.provinces.central._id}&status=decommissioned`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.total_pages).toBe(0);
  });

  it('sorts ascending by capacity_kw (default order)', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations?substation_id=${fixtures.substations.colomboSub._id}&sort=capacity_kw`)
    );
    expect(res.status).toBe(200);
    const values = res.body.data.map((i) => i.capacity_kw);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it('sorts descending by capacity_kw when order=desc', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/installations?substation_id=${fixtures.substations.colomboSub._id}&sort=capacity_kw&order=desc`
      )
    );
    expect(res.status).toBe(200);
    const values = res.body.data.map((i) => i.capacity_kw);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('rejects an invalid sort field with 400', async () => {
    const res = await auth(request(app).get('/api/v1/installations?sort=owner_name'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an invalid status value with 400', async () => {
    const res = await auth(request(app).get('/api/v1/installations?status=retired'));
    expect(res.status).toBe(400);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const res = await auth(request(app).get('/api/v1/installations?category=solar'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an operator-injection style query key with 400', async () => {
    const res = await auth(request(app).get('/api/v1/installations?district_id[$ne]=x'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with no token at all with 401', async () => {
    const res = await request(app).get('/api/v1/installations');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('GET /api/v1/installations/:installationId', () => {
  it('returns the serialized installation (no device_secret_hash, no _id/__v)', async () => {
    const installation = fixtures.installations[0];
    const res = await auth(request(app).get(`/api/v1/installations/${installation._id}`));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(String(installation._id));
    expect(res.body.device_secret_hash).toBeUndefined();
    expect(res.body._id).toBeUndefined();
    expect(res.body.__v).toBeUndefined();
  });

  it('returns 400 for a malformed id', async () => {
    const res = await auth(request(app).get('/api/v1/installations/not-an-id'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/installations/${unknownId}`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/grid-substations/:substationId/installations', () => {
  it('returns only installations scoped to that substation', async () => {
    const res = await auth(
      request(app).get(`/api/v1/grid-substations/${fixtures.substations.kandySub._id}/installations`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].meter_id).toBe('SL-MTR-000100');
  });

  it('still accepts the status filter alongside the path scope', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/grid-substations/${fixtures.substations.colomboSub._id}/installations?status=active`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });

  it('404s when the path parent substation does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/grid-substations/${unknownId}/installations`));
    expect(res.status).toBe(404);
  });

  it('rejects a province_id query parameter here (hierarchy filters belong to /installations only)', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/grid-substations/${fixtures.substations.colomboSub._id}/installations?province_id=${fixtures.provinces.western._id}`
      )
    );
    expect(res.status).toBe(400);
  });
});
