// Entry point: connect to MongoDB first, then start listening. Exits on connection failure.
'use strict';

const config = require('./config');
const connectDB = require('./db/connect');
const app = require('./app');

async function start() {
  try {
    await connectDB();
  } catch (err) {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`Solar API listening on port ${config.port}`);
  });
}

start();
