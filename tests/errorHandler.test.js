// Focused test of src/middleware/errorHandler.js: mounts a tiny throwaway Express app with
// routes that throw each error type the handler must translate, and checks the mapped response.
// (Chosen over spinning up real Mongoose CastError/ValidationError against a live DB, since the
// handler only inspects `err.name` / `err.code` / `err.keyPattern`, not the error class itself.)
'use strict';

const express = require('express');
const request = require('supertest');
const requestId = require('../src/middleware/requestId');
const notFound = require('../src/middleware/notFound');
const errorHandler = require('../src/middleware/errorHandler');

function buildTestApp() {
  const app = express();
  app.use(requestId);

  app.get('/cast-error', (req, res, next) => {
    const err = new Error('Cast to ObjectId failed');
    err.name = 'CastError';
    err.path = 'installation_id';
    next(err);
  });

  app.get('/validation-error', (req, res, next) => {
    const err = new Error('Installation validation failed');
    err.name = 'ValidationError';
    err.errors = { power_kw: { message: 'Path `power_kw` is required.' } };
    next(err);
  });

  app.get('/duplicate-reading', (req, res, next) => {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    err.keyPattern = { installation_id: 1, recorded_at: 1 };
    next(err);
  });

  app.get('/duplicate-other', (req, res, next) => {
    const err = new Error('E11000 duplicate key error');
    err.code = 11000;
    err.keyPattern = { meter_id: 1 };
    next(err);
  });

  app.get('/boom', (req, res, next) => {
    next(new Error('something exploded with a raw stack trace and Mongo text'));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('errorHandler translation', () => {
  const app = buildTestApp();

  it('maps Mongoose CastError to 400 VALIDATION_ERROR', async () => {
    const res = await request(app).get('/cast-error');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('maps Mongoose ValidationError to 400 VALIDATION_ERROR with details', async () => {
    const res = await request(app).get('/validation-error');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details).toEqual([{ field: 'power_kw', issue: 'is invalid' }]);
  });

  it('maps a reading duplicate key (installation_id + recorded_at) to 409 DUPLICATE_READING', async () => {
    const res = await request(app).get('/duplicate-reading');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_READING');
  });

  it('maps a non-reading duplicate key to 409 with a generic placeholder code', async () => {
    const res = await request(app).get('/duplicate-other');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });

  it('maps an unknown error to 500 with a generic message, no stack trace, no Mongo text', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(res.body.message).toBe('An unexpected error occurred.');
    expect(JSON.stringify(res.body)).not.toMatch(/stack trace|Mongo text|exploded/);
  });

  it('uses the same error shape for every case', async () => {
    const res = await request(app).get('/cast-error');
    expect(Object.keys(res.body).sort()).toEqual(
      ['code', 'details', 'message', 'path', 'request_id', 'status', 'timestamp'].sort()
    );
  });
});
