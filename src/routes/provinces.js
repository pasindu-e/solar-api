// /provinces routes. Open/unauthenticated for now - JWT auth and jurisdiction scoping are added
// in Phase 7 (see docs/SPEC.md section 17), so every read here is temporarily unrestricted.
'use strict';

const express = require('express');
const controller = require('../controllers/provinceController');

const router = express.Router();

router.get('/', controller.listProvinces);
router.get('/:provinceId', controller.getProvince);
// Path-parent rule: a province that does not exist 404s rather than returning an empty list,
// matching section 7's "unknown resource or route -> 404" (see provinceController.js).
router.get('/:provinceId/districts', controller.listDistrictsForProvince);

module.exports = router;
