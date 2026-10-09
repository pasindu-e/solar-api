// Attaches a unique id to every request (req.id) and echoes it as the X-Request-Id header.
'use strict';

const { randomUUID } = require('crypto');

function requestId(req, res, next) {
  const id = randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}

module.exports = requestId;
