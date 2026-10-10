// Tests for content negotiation (spec 6.5): 406 on an unsatisfiable Accept header, 415 on a
// body-bearing request with the wrong Content-Type. Checked across a few different endpoints.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { nationalToken, adminToken } = require('./authFixtures');

let mongod;
let fixtures;
let token;
let admin;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
  token = nationalToken();
  admin = adminToken();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('406 Not Acceptable', () => {
  it('GET /provinces with Accept: text/xml returns 406', async () => {
    const res = await request(app)
      .get('/api/v1/provinces')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'text/xml');
    expect(res.status).toBe(406);
    expect(res.body.code).toBe('NOT_ACCEPTABLE');
  });

  it('GET /installations with no Accept header at all is fine (200)', async () => {
    const res = await request(app)
      .get('/api/v1/installations')
      .set('Authorization', `Bearer ${token}`)
      .unset('Accept');
    expect(res.status).toBe(200);
  });

  it('a request with a bad Accept and no token gets 406, not 401 (negotiate runs before authenticate)', async () => {
    const res = await request(app).get('/api/v1/provinces').set('Accept', 'text/xml');
    expect(res.status).toBe(406);
  });
});

describe('415 Unsupported Media Type', () => {
  it('POST /auth/token with Content-Type: text/plain returns 415', async () => {
    const res = await request(app)
      .post('/api/v1/auth/token')
      .set('Content-Type', 'text/plain')
      .send('grant_type=password');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('POST /installations with Content-Type: text/plain returns 415', async () => {
    const res = await request(app)
      .post('/api/v1/installations')
      .set('Authorization', `Bearer ${admin}`)
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(res.status).toBe(415);
  });

  it('PATCH /installations/:id accepts application/merge-patch+json (not 415)', async () => {
    const res = await request(app)
      .patch(`/api/v1/installations/${fixtures.installations[0]._id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('Content-Type', 'application/merge-patch+json')
      .send({ capacity_kw: 2 });
    expect(res.status).not.toBe(415);
  });

  it('PUT /installations/:id with Content-Type: application/merge-patch+json returns 415 (PUT does not accept it)', async () => {
    const res = await request(app)
      .put(`/api/v1/installations/${fixtures.installations[0]._id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('Content-Type', 'application/merge-patch+json')
      .send({});
    expect(res.status).toBe(415);
  });

  it('GET requests are never 415 even with a stray Content-Type header', async () => {
    const res = await request(app)
      .get('/api/v1/provinces')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain');
    expect(res.status).toBe(200);
  });
});
