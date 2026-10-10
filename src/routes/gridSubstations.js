// /grid-substations routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers (spec 8.3).
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const controller = require('../controllers/gridSubstationController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];

router.get('/', ...readAccess, controller.listGridSubstations);
router.get('/:substationId', ...readAccess, controller.getGridSubstation);
router.get('/:substationId/installations', ...readAccess, controller.listInstallationsForSubstation);
router.get('/:substationId/readings', ...readAccess, controller.listReadingsForSubstation);

module.exports = router;
