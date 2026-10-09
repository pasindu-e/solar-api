// Unknown routes return 404 in the standard error shape, with a matching X-Request-Id.
'use strict';

const request = require('supertest');
const app = require('../src/app');

describe('unknown route', () => {
  it('returns 404 with the standard error shape and matching request id', async () => {
    const res = await request(app).get('/this-route-does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      path: '/this-route-does-not-exist',
    });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body.request_id).toBe(res.headers['x-request-id']);
  });
});
