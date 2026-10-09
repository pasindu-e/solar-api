// /installations routes (read-only in this phase). Open/unauthenticated for now - JWT auth and
// jurisdiction scoping are added in Phase 7 (see docs/SPEC.md section 17). Write methods
// (POST/PUT/PATCH/DELETE) are Phase 8, and are deliberately not present here yet.
'use strict';

const express = require('express');
const controller = require('../controllers/installationController');

const router = express.Router();

router.get('/', controller.listInstallations);
router.get('/:installationId', controller.getInstallation);

module.exports = router;
