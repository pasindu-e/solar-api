// Phase 6 integration tests: conditional GET wired into real HTTP routes (spec 6.4). Proves
// ETag/Last-Modified are set, If-None-Match (and If-Modified-Since fallback) produce an
// empty-body 304, and that a mutation changes the ETag so a stale If-None-Match no longer 304s.
// Phase 7 note: every GET now requires a valid token (spec 8.1, 8.4). A national-level token sees
// everything, preserving this file's original Phase 6 "no restriction" assumptions.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { nationalToken } = require('./authFixtures');
const SolarInstallation = require('../src/db/models/SolarInstallation');
const Province = require('../src/db/models/Province');

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

describe('Conditional GET on an atomic resource (GET /installations/:id)', () => {
  it('first GET returns 200 with an ETag header formatted "inst-<id>-v<version>"', async () => {
    const installation = fixtures.installations[0];
    const res = await auth(request(app).get(`/api/v1/installations/${installation._id}`));
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"inst-${installation._id}-v1"`);
    expect(res.headers['last-modified']).toBeDefined();
    expect(res.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
  });

  it('repeating with a matching If-None-Match returns 304 with an empty body and the ETag header', async () => {
    const installation = fixtures.installations[0];
    const first = await auth(request(app).get(`/api/v1/installations/${installation._id}`));
    const etag = first.headers.etag;

    const second = await auth(request(app).get(`/api/v1/installations/${installation._id}`)).set(
      'If-None-Match',
      etag
    );

    expect(second.status).toBe(304);
    expect(second.headers.etag).toBe(etag);
    expect(second.text).toBe('');
    expect(second.body).toEqual({});
  });

  it('mutating the document (simulating a future PUT) makes the stale ETag return 200 with a new ETag', async () => {
    const installation = fixtures.installations[0];
    const before = await auth(request(app).get(`/api/v1/installations/${installation._id}`));
    const staleEtag = before.headers.etag;

    const doc = await SolarInstallation.findById(installation._id);
    doc.capacity_kw = 99;
    doc.version += 1;
    await doc.save();

    const after = await auth(request(app).get(`/api/v1/installations/${installation._id}`)).set(
      'If-None-Match',
      staleEtag
    );

    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(staleEtag);
    expect(after.headers.etag).toBe(`"inst-${installation._id}-v${doc.version}"`);
    expect(after.body.capacity_kw).toBe(99);
  });

  it('If-Modified-Since fallback: an old date returns 200, a recent/future date returns 304', async () => {
    const installation = fixtures.installations[1];
    const first = await auth(request(app).get(`/api/v1/installations/${installation._id}`));
    const updatedAt = new Date(first.headers['last-modified']);

    const old = await auth(request(app).get(`/api/v1/installations/${installation._id}`)).set(
      'If-Modified-Since',
      new Date(updatedAt.getTime() - 60_000).toUTCString()
    );
    expect(old.status).toBe(200);

    const recent = await auth(request(app).get(`/api/v1/installations/${installation._id}`)).set(
      'If-Modified-Since',
      new Date(updatedAt.getTime() + 60_000).toUTCString()
    );
    expect(recent.status).toBe(304);
    expect(recent.text).toBe('');
  });
});

describe('Conditional GET on a collection (GET /provinces, hash-based ETag)', () => {
  it('first GET returns 200 with a hash ETag, repeat with If-None-Match returns 304', async () => {
    const first = await auth(request(app).get('/api/v1/provinces'));
    expect(first.status).toBe(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]+"$/);

    const second = await auth(request(app).get('/api/v1/provinces')).set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('adding a new province changes the hash ETag so a stale If-None-Match no longer 304s', async () => {
    const before = await auth(request(app).get('/api/v1/provinces'));
    const staleEtag = before.headers.etag;

    await Province.create({ code: 'NP', name: 'Northern' });

    const after = await auth(request(app).get('/api/v1/provinces')).set('If-None-Match', staleEtag);
    expect(after.status).toBe(200);
    expect(after.headers.etag).not.toBe(staleEtag);
  });
});

describe('Conditional GET on a readings collection (Last-Modified = newest recorded_at in the result)', () => {
  it('Last-Modified matches the newest recorded_at in this specific page, not wall-clock time', async () => {
    const res = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`));
    expect(res.status).toBe(200);
    expect(res.headers['last-modified']).toBeDefined();

    const newest = res.body.data.reduce(
      (max, r) => (new Date(r.recorded_at) > max ? new Date(r.recorded_at) : max),
      new Date(0)
    );
    // Compare at the second, since HTTP-dates have only second precision.
    expect(Math.floor(new Date(res.headers['last-modified']).getTime() / 1000)).toBe(
      Math.floor(newest.getTime() / 1000)
    );
  });

  it('a matching If-None-Match on a readings collection returns 304', async () => {
    const first = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`));
    const second = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings`)).set(
      'If-None-Match',
      first.headers.etag
    );
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});

describe('Conditional GET on the atomic reading endpoint (ETag from id, Last-Modified from ingested_at)', () => {
  it('returns an ETag formatted "reading-<id>" with no version segment', async () => {
    const reading = fixtures.readings[0];
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${reading._id}`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"reading-${reading._id}"`);
    expect(res.headers['last-modified']).toBeDefined();
  });

  it('repeat with a matching If-None-Match returns 304 with an empty body', async () => {
    const reading = fixtures.readings[0];
    const first = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${reading._id}`)
    );
    const second = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/readings/${reading._id}`)
    ).set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});

describe('Conditional GET on last-known-reading (treated as an atomic single reading)', () => {
  it('ETag is "reading-<id>", matching how the atomic reading endpoint treats a single reading', async () => {
    const res = await auth(
      request(app).get(`/api/v1/installations/${fixtures.instA._id}/last-known-reading`)
    );
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"reading-${res.body.id}"`);
  });
});

describe('Conditional GET on overview (hash-based ETag)', () => {
  it('returns a hash ETag and 304s on a repeat request with a matching If-None-Match', async () => {
    const first = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/overview`));
    expect(first.status).toBe(200);
    expect(first.headers.etag).toMatch(/^"[0-9a-f]+"$/);

    const second = await auth(request(app).get(`/api/v1/installations/${fixtures.instA._id}/overview`)).set(
      'If-None-Match',
      first.headers.etag
    );
    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });
});
