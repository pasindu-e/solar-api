// Tests for the grid-substation registry write path (spec 5.3, Phase 8): POST/PUT/PATCH/DELETE,
// district_id immutability, If-Match/412, 409 on children, non-admin 403.
'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const { seedFixtures } = require('./fixtures');
const { adminToken, districtToken } = require('./authFixtures');

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

function validSubstationBody(overrides = {}) {
  return {
    district_id: String(fixtures.districts.colombo._id),
    name: 'Test GSS',
    capacity_mva: 25,
    ...overrides,
  };
}

describe('POST /api/v1/grid-substations', () => {
  it('creates a substation: 201, Location resolves, version 1, province_id derived', async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody());
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/grid-substations/${res.body.id}`);
    expect(res.body.province_id).toBe(String(fixtures.provinces.western._id));
    expect(res.body.version).toBe(1);

    const located = await withAdmin(request(app).get(res.headers.location));
    expect(located.status).toBe(200);
    expect(located.body.id).toBe(res.body.id);
  });

  it('400s when district_id does not exist', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody({ district_id: String(unknownId) }));
    expect(res.status).toBe(400);
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .post('/api/v1/grid-substations')
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send(validSubstationBody());
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/v1/grid-substations/:id', () => {
  let substationId;
  let etag;

  beforeEach(async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody());
    substationId = res.body.id;
    const getRes = await withAdmin(request(app).get(`/api/v1/grid-substations/${substationId}`));
    etag = getRes.headers.etag;
  });

  it('200s on a valid If-Match with the same district_id', async () => {
    const res = await withAdmin(
      request(app)
        .put(`/api/v1/grid-substations/${substationId}`)
        .set('Content-Type', 'application/json')
        .set('If-Match', etag)
    ).send(validSubstationBody({ name: 'Renamed GSS' }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed GSS');
    expect(res.body.version).toBe(2);
  });

  it('400s when the PUT body changes district_id (immutable)', async () => {
    const res = await withAdmin(
      request(app).put(`/api/v1/grid-substations/${substationId}`).set('Content-Type', 'application/json')
    ).send(validSubstationBody({ district_id: String(fixtures.districts.kandy._id) }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('412s on a stale If-Match', async () => {
    const res = await withAdmin(
      request(app)
        .put(`/api/v1/grid-substations/${substationId}`)
        .set('Content-Type', 'application/json')
        .set('If-Match', '"sub-stale-v0"')
    ).send(validSubstationBody());
    expect(res.status).toBe(412);
  });

  it('404s on PUT of a nonexistent id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).put(`/api/v1/grid-substations/${unknownId}`).set('Content-Type', 'application/json')
    ).send(validSubstationBody());
    expect(res.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .put(`/api/v1/grid-substations/${substationId}`)
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send(validSubstationBody());
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/v1/grid-substations/:id', () => {
  let substationId;

  beforeEach(async () => {
    const res = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody());
    substationId = res.body.id;
  });

  it('merge-patches capacity_mva with application/merge-patch+json', async () => {
    const res = await withAdmin(
      request(app)
        .patch(`/api/v1/grid-substations/${substationId}`)
        .set('Content-Type', 'application/merge-patch+json')
    ).send({ capacity_mva: 40 });
    expect(res.status).toBe(200);
    expect(res.body.capacity_mva).toBe(40);
  });

  it('400s when the patch changes district_id to a different value (immutable)', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/grid-substations/${substationId}`).set('Content-Type', 'application/json')
    ).send({ district_id: String(fixtures.districts.kandy._id) });
    expect(res.status).toBe(400);
  });

  it('is unaffected when district_id is absent from the patch', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/grid-substations/${substationId}`).set('Content-Type', 'application/json')
    ).send({ name: 'Patched Name Only' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Patched Name Only');
    expect(res.body.district_id).toBe(String(fixtures.districts.colombo._id));
  });

  it('rejects a client-supplied province_id in the patch body with 400', async () => {
    const res = await withAdmin(
      request(app).patch(`/api/v1/grid-substations/${substationId}`).set('Content-Type', 'application/json')
    ).send({ province_id: String(fixtures.provinces.central._id) });
    expect(res.status).toBe(400);
  });

  it('404s on PATCH of a nonexistent id', async () => {
    const unknownId = new mongoose.Types.ObjectId();
    const res = await withAdmin(
      request(app).patch(`/api/v1/grid-substations/${unknownId}`).set('Content-Type', 'application/json')
    ).send({ name: 'Nope' });
    expect(res.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const res = await request(app)
      .patch(`/api/v1/grid-substations/${substationId}`)
      .set('Authorization', `Bearer ${nonAdmin}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Nope' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/grid-substations/:id', () => {
  it('409s when the substation has installations (seeded colomboSub has children)', async () => {
    const res = await withAdmin(request(app).delete(`/api/v1/grid-substations/${fixtures.substations.colomboSub._id}`));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GRID_SUBSTATION_HAS_INSTALLATIONS');
  });

  it('204s deleting a fresh childless substation, then 404 on repeat delete', async () => {
    const createRes = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody({ name: 'Childless GSS' }));
    const substationId = createRes.body.id;

    const first = await withAdmin(request(app).delete(`/api/v1/grid-substations/${substationId}`));
    expect(first.status).toBe(204);
    expect(first.body).toEqual({});

    const second = await withAdmin(request(app).delete(`/api/v1/grid-substations/${substationId}`));
    expect(second.status).toBe(404);
  });

  it('403s for a non-admin token', async () => {
    const createRes = await withAdmin(
      request(app).post('/api/v1/grid-substations').set('Content-Type', 'application/json')
    ).send(validSubstationBody({ name: 'Another GSS' }));
    const res = await request(app)
      .delete(`/api/v1/grid-substations/${createRes.body.id}`)
      .set('Authorization', `Bearer ${nonAdmin}`);
    expect(res.status).toBe(403);
  });
});
