// Redirects plain HTTP to HTTPS (spec 8.5: "redirect plain HTTP when x-forwarded-proto is http").
// The host (Render/Railway/Fly.io) terminates TLS and forwards every request to this app over
// plain HTTP internally, setting X-Forwarded-Proto to say what the ORIGINAL client used. With
// `trust proxy` set (src/app.js), Express only trusts that header from the proxy, not from an
// arbitrary client. Locally (dev/test) no proxy sets this header at all, so this middleware is a
// no-op there - it only ever acts behind a real reverse proxy.
'use strict';

function httpsRedirect(req, res, next) {
  if (req.headers['x-forwarded-proto'] === 'http') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  next();
}

module.exports = httpsRedirect;
