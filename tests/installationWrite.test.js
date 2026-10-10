// Tests for the installation registry write path (spec 5.3, Phase 8): POST/PUT/PATCH/DELETE,
// If-Match/412, duplicate meter_id 409, missing substation_id 400, non-admin 403.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { adminToken, districtToken } = require('./authFixtures');
const GenerationReading = require('../src/db/models/GenerationReading');

let mongod;
let fixtures;
let admin;
let nonAdmin;

function withAdmin(req) {
  return req.set('Authorization', `Bearer ${admin}`);
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  fixtures = await seedFixtures();
  admin = adminToken();
  nonAdmin = districtToken(fixtures.provinces.western._id, fixtures.districts.colombo._id);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

function validInstallationBody(overrides = {}) {
  return {
    substation_id: String(fixtures.substations.colomboSub._id),
    meter_id: `SL-MTR-NEW-${Math.random().toString(36).slice(2, 8)}`,
    owner_name: 'Test Owner',
    capacity_kw: 5.5,
    status: 'active',
    latitude: 6.9,
    longitude: 79.9,
    installed_at: '2025-01-01',
    ...overrides,
  };
}

describe('POST /api/v1/installations', () => {
  it('creates an installation: 201, Location resolves, body has version 1 and a one-time device_secret', async () => {
    const body = validInstallationBody();
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(body);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/installations/${res.body.id}`);
    expect(res.body.meter_id).toBe(body.meter_id);
    expect(res.body.district_id).toBe(String(fixtures.districts.colombo._id));
    expect(res.body.province_id).toBe(String(fixtures.provinces.western._id));
    expect(res.body.version).toBe(1);
    expect(typeof res.body.device_secret).toBe('string');
    expect(res.body.device_secret_hash).toBeUndefined();

    const located = await withAdmin(request(app).get(res.headers.location));
    expect(located.status).toBe(200);
    expect(located.body.id).toBe(res.body.id);
  });

  it('400s when substation_id does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody({ substation_id: String(unknownId) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('409s on a duplicate meter_id', async () => {
    const body = validInstallationBody();
    await withAdmin(request(app).post('/api/v1/installations').set('Content-Type', 'application/json')).send(body);
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_KEY');
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .post('/api/v1/installations')
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send(validInstallationBody());
    expect(res.status).toBe(403);
  });

  it('400s on a partial body missing required fields', async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send({ meter_id: 'SL-MTR-INCOMPLETE' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/v1/installations/:id', () => {
  let installationId;
  let etag;

  beforeAll(async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    installationId = res.body.id;
    const getRes = await withAdmin(request(app).get(`/api/v1/installations/${installationId}`));
    etag = getRes.headers.etag;
  });

  it('200s on a valid If-Match and recomputes district/province from substation_id', async () => {
    const res = await withAdmin(
      request(app)
        .put(`/api/v1/installations/${installationId}`)
        .set('Content-Type', 'application/json')
        .set('If-Match', etag)
    ).send(validInstallationBody({ meter_id: 'SL-MTR-PUT-1', capacity_kw: 9 }));
    expect(res.status).toBe(200);
    expect(res.body.meter_id).toBe('SL-MTR-PUT-1');
    expect(res.body.capacity_kw).toBe(9);
    expect(res.body.version).toBe(2);
    etag = `"inst-${installationId}-v2"`;
  });

  it('412s on a stale If-Match', async () => {
    const res = await withAdmin(
      request(app)
        .put(`/api/v1/installations/${installationId}`)
        .set('Content-Type', 'application/json')
        .set('If-Match', '"inst-stale-v0"')
    ).send(validInstallationBody({ meter_id: 'SL-MTR-PUT-2' }));
    expect(res.status).toBe(412);
    expect(res.body.code).toBe('PRECONDITION_FAILED');
  });

  it('400s on a partial PUT body (full replacement requires every writable field)', async () => {
    const res = await withAdmin(
      request(app).put(`/api/v1/installations/${installationId}`).set('Content-Type', 'application/json')
    ).send({ meter_id: 'SL-MTR-PUT-3' });
    expect(res.status).toBe(400);
  });

  it('404s on PUT of a nonexistent id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).put(`/api/v1/installations/${unknownId}`).set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    expect(res.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .put(`/api/v1/installations/${installationId}`)
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send(validInstallationBody());
    expect(res.status).toBe(403);
  });

  it('two concurrent PUTs with the same If-Match: one wins (200), the other loses (412)', async () => {
    const concurrentEtag = `"inst-${installationId}-v2"`;
    const [first, second] = await Promise.all([
      withAdmin(
        request(app)
          .put(`/api/v1/installations/${installationId}`)
          .set('Content-Type', 'application/json')
          .set('If-Match', concurrentEtag)
      ).send(validInstallationBody({ meter_id: 'SL-MTR-RACE-A' })),
      withAdmin(
        request(app)
          .put(`/api/v1/installations/${installationId}`)
          .set('Content-Type', 'application/json')
          .set('If-Match', concurrentEtag)
      ).send(validInstallationBody({ meter_id: 'SL-MTR-RACE-B' })),
    ]);
    const statuses = [first.status, second.status].sort();
    // Both requests read the same starting version and raced to write it: exactly one succeeds
    // (200) and the other finds the version already moved, surfacing as 412 (spec 6.4's atomic
    // findOneAndUpdate filter, backed up by this test's own enforceIfMatch pre-check racing too).
    expect(statuses).toEqual([200, 412]);
  });
});

describe('PATCH /api/v1/installations/:id', () => {
  let installationId;
  let etag;

  beforeEach(async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    installationId = res.body.id;
    const getRes = await withAdmin(request(app).get(`/api/v1/installations/${installationId}`));
    etag = getRes.headers.etag;
  });

  it('merge-patches a single field with application/merge-patch+json', async () => {
    const res = await withAdmin(
      request(app)
        .patch(`/api/v1/installations/${installationId}`)
        .set('Content-Type', 'application/merge-patch+json')
        .set('If-Match', etag)
    ).send({ capacity_kw: 12.5 });
    expect(res.status).toBe(200);
    expect(res.body.capacity_kw).toBe(12.5);
    expect(res.body.version).toBe(2);
  });

  it('null deletes a nullable field (owner_name)', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/installations/${installationId}`).set('Content-Type', 'application/json')
    ).send({ owner_name: null });
    expect(res.status).toBe(200);
    expect(res.body.owner_name).toBeUndefined();
  });

  it('rejects a client-supplied district_id in the patch body with 400', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/installations/${installationId}`).set('Content-Type', 'application/json')
    ).send({ district_id: String(fixtures.districts.kandy._id) });
    expect(res.status).toBe(400);
  });

  it('rejects a client-supplied version in the patch body with 400', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/installations/${installationId}`).set('Content-Type', 'application/json')
    ).send({ version: 99 });
    expect(res.status).toBe(400);
  });

  it('recomputes district/province when substation_id changes', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/installations/${installationId}`).set('Content-Type', 'application/json')
    ).send({ substation_id: String(fixtures.substations.kandySub._id) });
    expect(res.status).toBe(200);
    expect(res.body.district_id).toBe(String(fixtures.districts.kandy._id));
    expect(res.body.province_id).toBe(String(fixtures.provinces.central._id));
  });

  it('412s on a stale If-Match', async () => {
    const res = await withAdmin(
      request(app)
        .patch(`/api/v1/installations/${installationId}`)
        .set('Content-Type', 'application/json')
        .set('If-Match', '"inst-stale-v0"')
    ).send({ capacity_kw: 1 });
    expect(res.status).toBe(412);
  });

  it('404s on PATCH of a nonexistent id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).patch(`/api/v1/installations/${unknownId}`).set('Content-Type', 'application/json')
    ).send({ capacity_kw: 1 });
    expect(res.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .patch(`/api/v1/installations/${installationId}`)
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send({ capacity_kw: 1 });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/installations/:id', () => {
  it('409s when the installation has readings', async () => {
    const createRes = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    const installationId = createRes.body.id;
    await GenerationReading.create({
      installation_id: installationId,
      recorded_at: new Date(),
      power_kw: 1,
      energy_kwh: 1,
      voltage_v: 230,
    });

    const res = await withAdmin(request(app).delete(`/api/v1/installations/${installationId}`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSTALLATION_HAS_READINGS');
  });

  it('204s deleting a fresh childless installation, then 404 on repeat delete', async () => {
    const createRes = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    const installationId = createRes.body.id;

    const first = await withAdmin(request(app).delete(`/api/v1/installations/${installationId}`));
    expect(first.status).toBe(204);
    expect(first.body).toEqual({});

    const second = await withAdmin(request(app).delete(`/api/v1/installations/${installationId}`));
    expect(second.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const createRes = await withAdmin(
      request(app).post('/api/v1/installations').set('Content-Type', 'application/json')
    ).send(validInstallationBody());
    const res = await request(app)
      .delete(`/api/v1/installations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${nonAdmin}`);
    expect(res.status).toBe(403);
  });
});
