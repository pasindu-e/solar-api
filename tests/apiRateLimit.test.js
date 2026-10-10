// Phase 11 audit fix (spec 8.5: "Rate limit ... the API generally" - only the stricter
// /auth/token limiter existed before this phase). Confirms the general limiter is actually wired
// up (standard rate-limit headers present on /api/v1 routes) without needing to exhaust the
// production-sized budget (NODE_ENV=test relaxes the cap - see src/middleware/apiRateLimit.js).
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { nationalToken } = require('./authFixtures');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('General API rate limiting (spec 8.5)', () => {
  it('sets standard RateLimit-* headers on an /api/v1 response', async () => {
    const res = await request(app)
      .get('/api/v1/provinces')
      .set('Authorization', `Bearer ${nationalToken()}`);
    expect(res.status).toBe(200);
    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).toHaveProperty('ratelimit-remaining');
  });

  it('does not rate-limit GET /health or the docs surface', async () => {
    const health = await request(app).get('/health');
    const docs = await request(app).get('/openapi.json');
    expect(health.headers).not.toHaveProperty('ratelimit-limit');
    expect(docs.headers).not.toHaveProperty('ratelimit-limit');
  });
});
