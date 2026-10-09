// /districts routes. Open/unauthenticated for now - JWT auth and jurisdiction scoping are added
// in Phase 7 (see docs/SPEC.md section 17), so every read here is temporarily unrestricted.
'use strict';

const express = require('express');
const controller = require('../controllers/districtController');

const router = express.Router();

router.get('/', controller.listDistricts);
router.get('/:districtId', controller.getDistrict);
router.get('/:districtId/grid-substations', controller.listGridSubstationsForDistrict);

module.exports = router;
