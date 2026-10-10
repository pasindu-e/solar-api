// Tests for the hierarchy read endpoints: /provinces, /districts, /grid-substations, and their
// scoped sub-collections. Covers pagination envelope shape, filtering, malformed/unknown ids,
// the path-parent-404 rule, and the unknown-query-parameter 400 rule (spec 6.2).
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

describe('GET /api/v1/provinces', () => {
  it('returns a paginated envelope with both seeded provinces', async () => {
    const res = await auth(request(app).get('/api/v1/provinces'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toEqual({ total: 2, page: 1, page_size: 50, total_pages: 1 });
    expect(res.body.links.prev).toBeNull();
    expect(res.body.links.next).toBeNull();
    expect(res.body.links.self).toBe('/api/v1/provinces?page=1&page_size=50');
    // Shared serialize transform: id present, no _id/__v.
    expect(res.body.data[0].id).toBeDefined();
    expect(res.body.data[0]._id).toBeUndefined();
    expect(res.body.data[0].__v).toBeUndefined();
  });

  it('rejects an unknown query parameter with 400', async () => {
    const res = await auth(request(app).get('/api/v1/provinces?foo=bar'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an operator-injection style query key with 400', async () => {
    const res = await auth(request(app).get('/api/v1/provinces?code[$ne]=x'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with an empty data array for an out-of-range page', async () => {
    const res = await auth(request(app).get('/api/v1/provinces?page=5&page_size=2'));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.links.next).toBeNull();
    expect(res.body.links.prev).not.toBeNull();
  });

  it('rejects page_size over the 500 cap with 400', async () => {
    const res = await auth(request(app).get('/api/v1/provinces?page_size=501'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a request with no token at all with 401', async () => {
    const res = await request(app).get('/api/v1/provinces');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });
});

describe('GET /api/v1/provinces/:provinceId', () => {
  it('returns the province for a well-formed, existing id', async () => {
    const res = await auth(request(app).get(`/api/v1/provinces/${fixtures.provinces.western._id}`));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Western');
    expect(res.body.id).toBe(String(fixtures.provinces.western._id));
  });

  it('returns 400 for a malformed id', async () => {
    const res = await auth(request(app).get('/api/v1/provinces/not-an-id'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/provinces/${unknownId}`));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/v1/provinces/:provinceId/districts', () => {
  it('returns only districts belonging to that province', async () => {
    const res = await auth(
      request(app).get(`/api/v1/provinces/${fixtures.provinces.western._id}/districts`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((d) => d.name).sort()).toEqual(['Colombo', 'Gampaha']);
  });

  it('404s when the path parent province does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/provinces/${unknownId}/districts`));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('400s when the path parent province id is malformed', async () => {
    const res = await auth(request(app).get('/api/v1/provinces/not-an-id/districts'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/districts', () => {
  it('filters by province_id', async () => {
    const res = await auth(
      request(app).get(`/api/v1/districts?province_id=${fixtures.provinces.central._id}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Kandy');
  });

  it('returns an empty result set for a well-formed but non-matching province_id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/districts?province_id=${unknownId}`));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('rejects an unknown query parameter with 400', async () => {
    const res = await auth(request(app).get('/api/v1/districts?unknown=1'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/districts/:districtId/grid-substations', () => {
  it('returns substations scoped to that district', async () => {
    const res = await auth(
      request(app).get(`/api/v1/districts/${fixtures.districts.colombo._id}/grid-substations`)
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Colombo GSS');
  });

  it('404s when the path parent district does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/districts/${unknownId}/grid-substations`));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/grid-substations', () => {
  it('filters by district_id and province_id combined', async () => {
    const res = await auth(
      request(app).get(
        `/api/v1/grid-substations?district_id=${fixtures.districts.colombo._id}&province_id=${fixtures.provinces.western._id}`
      )
    );
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Colombo GSS');
  });

  it('400s on a malformed filter value', async () => {
    const res = await auth(request(app).get('/api/v1/grid-substations?district_id=not-an-id'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/grid-substations/:substationId', () => {
  it('returns 404 for a well-formed unknown substation id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await auth(request(app).get(`/api/v1/grid-substations/${unknownId}`));
    expect(res.status).toBe(404);
  });
});
