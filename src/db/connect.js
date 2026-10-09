// Connects Mongoose to MongoDB. Never logs the connection string, success or failure.
'use strict';

const mongoose = require('mongoose');
const config = require('../config');

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

async function connectDB() {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log('Connected to MongoDB.');
    return mongoose.connection;
  } catch (_err) {
    // Intentionally generic: never include the connection string or raw driver error text.
    throw new Error('Failed to connect to MongoDB. Check MONGODB_URI, network access and credentials.');
  }
}

module.exports = connectDB;
