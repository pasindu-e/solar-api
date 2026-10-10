// Cheap safeguard (spec 10): loads and parses docs/openapi.yaml directly (no HTTP) and spot-checks
// that it is well-formed and that a representative sample of real documented paths are present.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const specPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');

describe('docs/openapi.yaml', () => {
  let spec;

  it('parses as valid YAML', () => {
    const raw = fs.readFileSync(specPath, 'utf8');
    expect(() => {
      spec = YAML.parse(raw);
    }).not.toThrow();
    expect(spec).toBeTruthy();
  });

  it('has the expected top-level OpenAPI keys', () => {
    expect(spec).toHaveProperty('openapi');
    expect(spec).toHaveProperty('info');
    expect(spec).toHaveProperty('paths');
    expect(spec).toHaveProperty('components');
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.info.title).toBe('NB6007CEM Real-Time Solar Generation Data API');
  });

  it('declares the bearerAuth security scheme (spec 10)', () => {
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('documents a representative sample of every real route', () => {
    const expectedPaths = [
      '/health',
      '/api/v1/auth/token',
      '/api/v1/provinces',
      '/api/v1/provinces/{provinceId}',
      '/api/v1/provinces/{provinceId}/districts',
      '/api/v1/provinces/{provinceId}/readings',
      '/api/v1/districts',
      '/api/v1/districts/{districtId}',
      '/api/v1/districts/{districtId}/grid-substations',
      '/api/v1/districts/{districtId}/readings',
      '/api/v1/districts/{districtId}/generation-summary',
      '/api/v1/grid-substations',
      '/api/v1/grid-substations/{substationId}',
      '/api/v1/grid-substations/{substationId}/installations',
      '/api/v1/grid-substations/{substationId}/readings',
      '/api/v1/installations',
      '/api/v1/installations/{installationId}',
      '/api/v1/installations/{installationId}/overview',
      '/api/v1/installations/{installationId}/last-known-reading',
      '/api/v1/installations/{installationId}/readings',
      '/api/v1/installations/{installationId}/readings/{readingId}',
    ];

    for (const p of expectedPaths) {
      expect(spec.paths).toHaveProperty(p);
    }
    // Exactly these 21 - catches both a missing real endpoint and an invented one.
    expect(Object.keys(spec.paths).sort()).toEqual(expectedPaths.sort());
  });

  it('marks the 405 routes with an Allow header response', () => {
    const readingPathItem = spec.paths['/api/v1/installations/{installationId}/readings/{readingId}'];
    expect(readingPathItem.put.responses['405']).toBeDefined();
    expect(readingPathItem.put.responses['405'].headers.Allow).toBeDefined();
  });

  it('documents the shared Error schema with the spec 6.6 shape', () => {
    const errorSchema = spec.components.schemas.Error;
    expect(errorSchema.required).toEqual(
      expect.arrayContaining(['code', 'message', 'details', 'status', 'path', 'timestamp', 'request_id'])
    );
  });
});
