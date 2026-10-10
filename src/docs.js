// Loads docs/openapi.yaml once at startup and exposes a tiny router that serves Swagger UI at
// /api-docs and the raw parsed spec at /openapi.json. Mounted in app.js OUTSIDE the /api/v1 router
// and its authenticate/negotiate chain (spec 10: this is a public, unauthenticated documentation
// surface, and Swagger UI's own HTML/JS/CSS assets should never be forced through the API's JSON
// content-negotiation or auth rules).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const YAML = require('yaml');
const swaggerUi = require('swagger-ui-express');

// path.join(__dirname, ...) resolves relative to this file, not process.cwd(), so this works the
// same whether the app is started from the project root or anywhere else (and in tests, which boot
// a fresh app per file regardless of the Jest working directory).
const specPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));

const router = express.Router();

router.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec));
router.get('/openapi.json', (req, res) => {
  res.json(spec);
});

module.exports = router;
