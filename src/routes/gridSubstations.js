// /grid-substations routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers (spec 8.3). Registry
// write methods (Phase 8) require the admin-only registry:write scope (spec 5.3, 8.1).
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const methodNotAllowed = require('../middleware/methodNotAllowed');
const controller = require('../controllers/gridSubstationController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];
const writeAccess = [authenticate, requireScope('registry:write')];

router.get('/', ...readAccess, controller.listGridSubstations);
router.get('/:substationId', ...readAccess, controller.getGridSubstation);
router.get('/:substationId/installations', ...readAccess, controller.listInstallationsForSubstation);
router.get('/:substationId/readings', ...readAccess, controller.listReadingsForSubstation);

// Extrapolation beyond spec's explicit prose (which only names the per-installation case): the
// aggregated substation readings collection has no POST, so its 405 Allow is just GET, HEAD.
router.put('/:substationId/readings', methodNotAllowed('GET, HEAD'));
router.patch('/:substationId/readings', methodNotAllowed('GET, HEAD'));
router.delete('/:substationId/readings', methodNotAllowed('GET, HEAD'));

// Grid-substation registry write path (spec 5.3).
router.post('/', ...writeAccess, controller.createGridSubstation);
router.put('/:substationId', ...writeAccess, controller.replaceGridSubstation);
router.patch('/:substationId', ...writeAccess, controller.patchGridSubstation);
router.delete('/:substationId', ...writeAccess, controller.deleteGridSubstation);

module.exports = router;
