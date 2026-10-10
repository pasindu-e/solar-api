// Phase 11 audit fix (spec 8.5: "redirect plain HTTP when x-forwarded-proto is http"). This was
// missing entirely - trust proxy and helmet's HSTS header were present, but nothing actually
// redirected a plain-HTTP request forwarded by the host's reverse proxy. src/middleware/
// httpsRedirect.js closes that gap; these tests do not need a database, so they mount it on a tiny
// throwaway app rather than booting the whole API.
'use strict';

const express = require('express');
const request = require('supertest');
const httpsRedirect = require('../src/middleware/httpsRedirect');

function buildTestApp() {
  const app = express();
  app.use(httpsRedirect);
  app.get('/some/path', (req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('httpsRedirect middleware', () => {
  const app = buildTestApp();

  it('redirects with 301 to the https URL when X-Forwarded-Proto is http', async () => {
    const res = await request(app).get('/some/path?x=1').set('X-Forwarded-Proto', 'http');
    expect(res.status).toBe(301);
    expect(res.headers.location).toMatch(/^https:\/\/.+\/some\/path\?x=1$/);
  });

  it('does not redirect when X-Forwarded-Proto is https', async () => {
    const res = await request(app).get('/some/path').set('X-Forwarded-Proto', 'https');
    expect(res.status).toBe(200);
  });

  it('does not redirect when there is no X-Forwarded-Proto header at all (local dev/test)', async () => {
    const res = await request(app).get('/some/path');
    expect(res.status).toBe(200);
  });
});
