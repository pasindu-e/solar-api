// Jest configuration: sets dummy required env vars before any test file loads config/app.
'use strict';

module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/env.setup.js'],
  testTimeout: 30000,
};
