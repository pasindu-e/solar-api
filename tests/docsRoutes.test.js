// Supertest check that /api-docs (Swagger UI) and /openapi.json are public and unauthenticated
// (spec 10): no Authorization header is sent, and no app.json rejection is produced by the API's
// own content-negotiation rules, since these routes are mounted outside that chain (see src/app.js).
'use strict';

const request = require('supertest');
const app = require('../src/app');

describe('Documentation surface', () => {
  it('GET /api-docs serves Swagger UI HTML without authentication', async () => {
    const res = await request(app).get('/api-docs/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toMatch(/swagger-ui/i);
  });

  it('GET /openapi.json serves the raw spec as JSON without authentication', async () => {
    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('openapi');
    expect(res.body).toHaveProperty('paths');
    expect(res.body.paths).toHaveProperty('/api/v1/auth/token');
  });
});
