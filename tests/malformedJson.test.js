// Malformed JSON bodies are caught by express.json() and mapped to 400 VALIDATION_ERROR,
// using the same standard error shape as every other error.
'use strict';

const request = require('supertest');
const app = require('../src/app');

describe('malformed JSON body', () => {
  it('returns 400 VALIDATION_ERROR in the standard shape', async () => {
    const res = await request(app)
      .post('/anything')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
