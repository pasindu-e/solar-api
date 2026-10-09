// /grid-substations routes. Open/unauthenticated for now - JWT auth and jurisdiction scoping are
// added in Phase 7 (see docs/SPEC.md section 17), so every read here is temporarily unrestricted.
'use strict';

const express = require('express');
const controller = require('../controllers/gridSubstationController');

const router = express.Router();

router.get('/', controller.listGridSubstations);
router.get('/:substationId', controller.getGridSubstation);
router.get('/:substationId/installations', controller.listInstallationsForSubstation);

module.exports = router;
