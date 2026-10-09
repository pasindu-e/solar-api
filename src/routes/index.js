// Mounts every /api/v1 sub-router. app.js mounts this whole router at the /api/v1 base path.
'use strict';

const express = require('express');

const router = express.Router();

router.use('/provinces', require('./provinces'));
router.use('/districts', require('./districts'));
router.use('/grid-substations', require('./gridSubstations'));
router.use('/installations', require('./installations'));

module.exports = router;
