// Reads and validates required environment variables. Fails fast, never logs secret values.
'use strict';

require('dotenv').config();

const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_ISSUER',
  'USER_TOKEN_TTL',
  'DEVICE_TOKEN_TTL',
  'PUBLIC_BASE_URL',
];

function loadConfig() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name] || process.env[name].trim() === '');

  if (missing.length > 0) {
    // Only the variable NAMES are logged, never their values.
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in real values.'
    );
  }

  return {
    nodeEnv: process.env.NODE_ENV,
    port: Number(process.env.PORT),
    mongodbUri: process.env.MONGODB_URI,
    jwtSecret: process.env.JWT_SECRET,
    jwtIssuer: process.env.JWT_ISSUER,
    userTokenTtl: process.env.USER_TOKEN_TTL,
    deviceTokenTtl: process.env.DEVICE_TOKEN_TTL,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    seedRandom: process.env.SEED_RANDOM || 'slsea-2026',
  };
}

module.exports = loadConfig();
