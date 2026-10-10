// /installations routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers (spec 8.3). The device
// reading-ingestion POST (spec 5.4a) has its own chain: readings:write scope, then the
// own-installation check inside the controller (spec 5.4a, since it must run before the body is
// even validated). Registry write methods (POST/PUT/PATCH/DELETE on the installation itself,
// Phase 8) require the admin-only registry:write scope (spec 5.3, 8.1) - no further jurisdiction
// restriction, since admin is already national-level (src/services/authService.js).
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const methodNotAllowed = require('../middleware/methodNotAllowed');
const controller = require('../controllers/installationController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];
const writeAccess = [authenticate, requireScope('registry:write')];

router.get('/', ...readAccess, controller.listInstallations);
router.get('/:installationId', ...readAccess, controller.getInstallation);
router.get('/:installationId/overview', ...readAccess, controller.getOverview);
router.get('/:installationId/last-known-reading', ...readAccess, controller.getLastKnownReading);
router.get('/:installationId/readings', ...readAccess, controller.listReadingsForInstallation);
router.get('/:installationId/readings/:readingId', ...readAccess, controller.getReading);

router.post(
  '/:installationId/readings',
  authenticate,
  requireScope('readings:write'),
  controller.postReading
);

// Readings are append-only (spec 5.3, 5.4): PUT/PATCH/DELETE on a reading or the readings
// collection are 405, with no auth middleware in front at all (see methodNotAllowed.js for why).
router.put('/:installationId/readings/:readingId', methodNotAllowed('GET, HEAD'));
router.patch('/:installationId/readings/:readingId', methodNotAllowed('GET, HEAD'));
router.delete('/:installationId/readings/:readingId', methodNotAllowed('GET, HEAD'));
router.put('/:installationId/readings', methodNotAllowed('GET, HEAD, POST'));
router.patch('/:installationId/readings', methodNotAllowed('GET, HEAD, POST'));
router.delete('/:installationId/readings', methodNotAllowed('GET, HEAD, POST'));

// Installation registry write path (spec 5.3).
router.post('/', ...writeAccess, controller.createInstallation);
router.put('/:installationId', ...writeAccess, controller.replaceInstallation);
router.patch('/:installationId', ...writeAccess, controller.patchInstallation);
router.delete('/:installationId', ...writeAccess, controller.deleteInstallation);

module.exports = router;
