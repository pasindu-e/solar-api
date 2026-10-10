// /districts routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers (spec 8.3).
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const controller = require('../controllers/districtController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];

router.get('/', ...readAccess, controller.listDistricts);
router.get('/:districtId', ...readAccess, controller.getDistrict);
router.get('/:districtId/grid-substations', ...readAccess, controller.listGridSubstationsForDistrict);
router.get('/:districtId/readings', ...readAccess, controller.listReadingsForDistrict);

module.exports = router;
