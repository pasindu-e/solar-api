// Tests for 405 Method Not Allowed on readings (spec: readings are append-only). Covers the
// per-installation reading and readings collection (spec's explicit prose) plus one aggregated
// collection (district) as the documented extrapolation. No auth token is sent on purpose - these
// routes are plain handlers with no auth middleware in front (see methodNotAllowed.js).
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');

let mongod;
let fixtures;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('405 on a single reading (per-installation)', () => {
  const methods = ['put', 'patch', 'delete'];

  for (const method of methods) {
    it(`${method.toUpperCase()} on /installations/:id/readings/:readingId returns 405 with Allow: GET, HEAD`, async () => {
      const readingId = new mongoose.Types.ObjectId();
      const res = await request(app)[method](
        `/api/v1/installations/${fixtures.instA._id}/readings/${readingId}`
      );
      expect(res.status).toBe(405);
      expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      expect(res.headers.allow).toBe('GET, HEAD');
    });
  }
});

describe('405 on the per-installation readings collection', () => {
  const methods = ['put', 'patch', 'delete'];

  for (const method of methods) {
    it(`${method.toUpperCase()} on /installations/:id/readings returns 405 with Allow: GET, HEAD, POST`, async () => {
      const res = await request(app)[method](`/api/v1/installations/${fixtures.instA._id}/readings`);
      expect(res.status).toBe(405);
      expect(res.body.code).toBe('METHOD_NOT_ALLOWED');
      expect(res.headers.allow).toBe('GET, HEAD, POST');
    });
  }

  it('GET on the same collection still works (no routing conflict)', async () => {
    const { nationalToken } = require('./authFixtures');
    const res = await request(app)
      .get(`/api/v1/installations/${fixtures.instA._id}/readings`)
      .set('Authorization', `Bearer ${nationalToken()}`);
    expect(res.status).toBe(200);
  });
});

describe('405 on an aggregated readings collection (district), Allow: GET, HEAD only (no POST)', () => {
  const methods = ['put', 'patch', 'delete'];

  for (const method of methods) {
    it(`${method.toUpperCase()} on /districts/:id/readings returns 405 with Allow: GET, HEAD`, async () => {
      const res = await request(app)[method](`/api/v1/districts/${fixtures.districts.colombo._id}/readings`);
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    });
  }
});

describe('405 on the other two aggregated readings collections', () => {
  it('PUT on /provinces/:id/readings returns 405 with Allow: GET, HEAD', async () => {
    const res = await request(app).put(`/api/v1/provinces/${fixtures.provinces.western._id}/readings`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('DELETE on /grid-substations/:id/readings returns 405 with Allow: GET, HEAD', async () => {
    const res = await request(app).delete(`/api/v1/grid-substations/${fixtures.substations.colomboSub._id}/readings`);
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });
});
