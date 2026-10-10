// Mounts every /api/v1 sub-router. app.js mounts this whole router at the /api/v1 base path.
'use strict';

const express = require('express');
const cacheControl = require('../middleware/cacheControl');

const router = express.Router();

// Spec 6.4: every /api/v1 response is authenticated-style data (never cached across users).
router.use(cacheControl);

router.use('/auth', require('./auth'));
router.use('/provinces', require('./provinces'));
router.use('/districts', require('./districts'));
router.use('/grid-substations', require('./gridSubstations'));
router.use('/installations', require('./installations'));

module.exports = router;
