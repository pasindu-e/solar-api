// GET /health: 200 when connected to MongoDB, 503 with the standard error shape when not.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('GET /health', () => {
  it('returns 200 { status: "ok" } when MongoDB is connected', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns 503 with the standard error shape when MongoDB is disconnected', async () => {
    await mongoose.disconnect();

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      path: '/health',
    });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.request_id).toBe(res.headers['x-request-id']);
    expect(typeof res.body.timestamp).toBe('string');

    // Reconnect so other test files that reuse this in-memory server are unaffected.
    await mongoose.connect(mongod.getUri());
  });
});
