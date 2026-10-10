// Unit tests for src/utils/conditional.js: ETag format, the 304 decision logic, hash stability,
// and the checkIfMatch tri-state used by future (Phase 8) writes for 412. No database or HTTP
// server needed - these call the helper functions directly.
'use strict';

const {
  computeAtomicETag,
  computeHashETag,
  sendConditional,
  checkIfMatch,
} = require('../src/utils/conditional');

// Minimal fake Express response: records what was set/sent, enough to assert against.
function fakeRes() {
  const res = {
    headers: {},
    statusCode: null,
    body: undefined,
    ended: false,
    set(key, value) {
      res.headers[key] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    },
    end() {
      res.ended = true;
      return res;
    },
  };
  return res;
}

describe('computeAtomicETag', () => {
  it('formats as a quoted "<prefix>-<id>-v<version>" string', () => {
    expect(computeAtomicETag('inst', '6650f1c2a1b2c3d4e5f60042', 3)).toBe(
      '"inst-6650f1c2a1b2c3d4e5f60042-v3"'
    );
  });

  it('omits the version segment cleanly when version is null (readings)', () => {
    expect(computeAtomicETag('reading', 'abc123', null)).toBe('"reading-abc123"');
    // Never produces a broken-looking "-vnull" suffix.
    expect(computeAtomicETag('reading', 'abc123', null)).not.toMatch(/vnull/);
  });

  it('omits the version segment when version is undefined too', () => {
    expect(computeAtomicETag('reading', 'abc123', undefined)).toBe('"reading-abc123"');
  });
});

describe('computeHashETag', () => {
  it('is stable: the same body produces the same hash twice', () => {
    const body = { data: [{ id: '1', value: 42 }], pagination: { total: 1 } };
    expect(computeHashETag(body)).toBe(computeHashETag({ ...body }));
  });

  it('changes when the body changes', () => {
    const a = computeHashETag({ data: [{ id: '1' }] });
    const b = computeHashETag({ data: [{ id: '2' }] });
    expect(a).not.toBe(b);
  });

  it('returns a quoted hex string', () => {
    const etag = computeHashETag({ x: 1 });
    expect(etag).toMatch(/^"[0-9a-f]+"$/);
  });
});

describe('sendConditional', () => {
  const etag = '"inst-abc-v1"';
  const lastModified = new Date('2026-01-01T00:00:00Z');

  it('sends 200 with the body and ETag/Last-Modified headers when there is no conditional header', () => {
    const req = { headers: {} };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers.ETag).toBe(etag);
    expect(res.headers['Last-Modified']).toBe(lastModified.toUTCString());
  });

  it('returns 304 with an empty body when If-None-Match matches exactly', () => {
    const req = { headers: { 'if-none-match': etag } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(304);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.headers.ETag).toBe(etag);
  });

  it('returns 304 when If-None-Match is the wildcard "*"', () => {
    const req = { headers: { 'if-none-match': '*' } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(304);
  });

  it('matches one value in a comma-separated If-None-Match list', () => {
    const req = { headers: { 'if-none-match': '"other-etag", ' + etag } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(304);
  });

  it('sends 200 when If-None-Match does not match', () => {
    const req = { headers: { 'if-none-match': '"something-else-v9"' } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('falls back to If-Modified-Since when If-None-Match is absent: 304 for a recent/future date', () => {
    const req = { headers: { 'if-modified-since': new Date('2026-01-02T00:00:00Z').toUTCString() } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(304);
  });

  it('falls back to If-Modified-Since: 200 for an older date', () => {
    const req = { headers: { 'if-modified-since': new Date('2025-01-01T00:00:00Z').toUTCString() } };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    expect(res.statusCode).toBe(200);
  });

  it('ignores If-Modified-Since when If-None-Match is present (If-None-Match takes priority)', () => {
    const req = {
      headers: {
        'if-none-match': '"does-not-match"',
        'if-modified-since': new Date('2026-06-01T00:00:00Z').toUTCString(),
      },
    };
    const res = fakeRes();
    sendConditional(req, res, { etag, lastModified, body: { ok: true } });
    // If-None-Match is present and does not match, so this must be 200 even though
    // If-Modified-Since alone would have implied 304 - spec 6.4 treats it as a fallback only.
    expect(res.statusCode).toBe(200);
  });
});

describe('checkIfMatch (412 readiness for Phase 8 writes)', () => {
  const currentETag = '"inst-abc-v2"';

  it('returns "absent" when no If-Match header was sent', () => {
    const req = { headers: {} };
    expect(checkIfMatch(req, currentETag)).toBe('absent');
  });

  it('returns true when If-Match matches the current ETag', () => {
    const req = { headers: { 'if-match': currentETag } };
    expect(checkIfMatch(req, currentETag)).toBe(true);
  });

  it('returns false when If-Match does not match (stale client copy)', () => {
    const req = { headers: { 'if-match': '"inst-abc-v1"' } };
    expect(checkIfMatch(req, currentETag)).toBe(false);
  });

  it('returns true for the wildcard "*"', () => {
    const req = { headers: { 'if-match': '*' } };
    expect(checkIfMatch(req, currentETag)).toBe(true);
  });
});
