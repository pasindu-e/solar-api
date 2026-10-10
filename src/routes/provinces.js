// /provinces routes. Every GET requires a valid user/admin token with the data:read scope
// (spec 8.1, 8.4); jurisdiction enforcement happens inside the controllers once the resource is
// loaded or the list filter is built (spec 8.3).
'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const requireScope = require('../middleware/requireScope');
const controller = require('../controllers/provinceController');

const router = express.Router();
const readAccess = [authenticate, requireScope('data:read')];

router.get('/', ...readAccess, controller.listProvinces);
router.get('/:provinceId', ...readAccess, controller.getProvince);
// Path-parent rule: a province that does not exist 404s rather than returning an empty list,
// matching section 7's "unknown resource or route -> 404" (see provinceController.js).
router.get('/:provinceId/districts', ...readAccess, controller.listDistrictsForProvince);
router.get('/:provinceId/readings', ...readAccess, controller.listReadingsForProvince);

module.exports = router;
