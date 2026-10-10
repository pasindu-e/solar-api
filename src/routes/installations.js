// /installations routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers (spec 8.3). The device
// reading-ingestion POST (spec 5.4a) has its own chain: readings:write scope, then the
// own-installation check inside the controller (spec 5.4a, since it must run before the body is
// even validated). Registry write methods (POST/PUT/PATCH/DELETE on the installation itself) are
// Phase 8 and are deliberately not present here yet.
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const controller = require('../controllers/installationController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];

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

module.exports = router;
