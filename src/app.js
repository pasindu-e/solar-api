// Express application: wires up middleware and routes. Does not call .listen() (see server.js).
'use strict';

const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');

const requestId = require('./middleware/requestId');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { ApiError } = require('./utils/errors');

const app = express();

// Needed for correct client IPs / protocol behind a reverse proxy (Render, Railway, Fly.io).
app.set('trust proxy', 1);
// Flat query strings only - blocks nested operator-injection syntax such as ?field[$ne]=x
// from ever being parsed into an object (see spec section 8.5).
app.set('query parser', 'simple');

app.use(requestId);
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.use(
  pinoHttp({
    // Silent during tests so Jest output stays readable.
    enabled: process.env.NODE_ENV !== 'test',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  })
);

// Rate limiting, CORS, content negotiation (406/415) and auth middleware are added in later
// phases, once there are routes that need them (see docs/SPEC.md section 8.4 for the full chain).

app.get('/health', (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    // Placeholder code: the spec does not name a specific code for this case, flagged for approval.
    return next(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Database connection is not available.'));
  }
  res.status(200).json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
