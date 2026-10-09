// Jest setupFiles: provides dummy required env vars so src/config can load during tests.
// NODE_ENV=test also keeps pino-http silent (see src/app.js).
'use strict';

process.env.NODE_ENV = 'test';
process.env.PORT = process.env.PORT || '3000';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/solar_api_test_placeholder';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-for-production';
process.env.JWT_ISSUER = process.env.JWT_ISSUER || 'slsea-api';
process.env.USER_TOKEN_TTL = process.env.USER_TOKEN_TTL || '1h';
process.env.DEVICE_TOKEN_TTL = process.env.DEVICE_TOKEN_TTL || '24h';
process.env.PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
