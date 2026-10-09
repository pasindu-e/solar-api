// Connects to MongoDB, registers all six models, and calls syncIndexes() on each.
// Run with `npm run db:indexes`. Must be run against Atlas before the 409 duplicate-reading
// rule can be relied on in a real deployment.
'use strict';

const mongoose = require('mongoose');
const connectDB = require('../connect');

const Province = require('../models/Province');
const District = require('../models/District');
const GridSubstation = require('../models/GridSubstation');
const SolarInstallation = require('../models/SolarInstallation');
const GenerationReading = require('../models/GenerationReading');
const User = require('../models/User');

const models = [
  ['Province', Province],
  ['District', District],
  ['GridSubstation', GridSubstation],
  ['SolarInstallation', SolarInstallation],
  ['GenerationReading', GenerationReading],
  ['User', User],
];

async function run() {
  await connectDB();

  for (const [name, model] of models) {
    const result = await model.syncIndexes();
    console.log(`Synced indexes for ${name}:`, result);
  }

  await mongoose.disconnect();
  console.log('Index sync complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(`Index sync failed: ${err.message}`);
  process.exit(1);
});
