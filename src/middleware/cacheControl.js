// Sets Cache-Control on every /api/v1 response (spec 6.4): authenticated data must always be
// revalidated, never served stale from a shared/browser cache.
'use strict';

function cacheControl(req, res, next) {
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  next();
}

module.exports = cacheControl;
