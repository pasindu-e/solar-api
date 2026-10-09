// npm run simulate - appends the missing 15-minute readings up to "now" for every active
// installation, so current power / today's energy are not stale (spec section 4). Writes
// through the GenerationReading model directly, not through the API - there is no HTTP call
// here, this script talks to MongoDB the same way a very well-behaved device would.
//
// Automating this (a scheduled job every 15 minutes) is explicitly deferred to the deployment
// phase; this script is only the manual/one-shot building block the spec asks for in Phase 3.
'use strict';

const mongoose = require('mongoose');
const seedrandom = require('seedrandom');

const connectDB = require('../connect');
const config = require('../../config');

const SolarInstallation = require('../models/SolarInstallation');
const GenerationReading = require('../models/GenerationReading');

const {
  floorTo15Min,
  localDateKey,
  cloudFactorForDay,
  powerForReading,
  nextEnergyKwh,
  voltageReading,
  round3,
  INTERVAL_MS,
} = require('./lib/generateReading');

const BATCH_SIZE = 4000;

async function simulateInstallation(inst, now) {
  const latest = await GenerationReading.findOne({ installation_id: inst._id })
    .sort({ recorded_at: -1 })
    .lean();

  if (!latest) {
    // No history at all for this installation (for example a brand-new one created after
    // seeding). Judgment call: skip it rather than inventing a start point - there is no
    // lifetime energy offset to continue from, and the next real device/seed run will create
    // a proper starting reading. Report it as skipped so it is visible, not silently dropped.
    return { meterId: inst.meter_id, inserted: 0, skippedReason: 'no existing readings' };
  }

  const lastTimestamp = new Date(latest.recorded_at);
  const firstMissing = new Date(lastTimestamp.getTime() + INTERVAL_MS);

  if (firstMissing.getTime() > now.getTime()) {
    return { meterId: inst.meter_id, inserted: 0, skippedReason: 'already up to date' };
  }

  const rng = seedrandom(`${config.seedRandom}:simulate:${inst.meter_id}:${lastTimestamp.getTime()}`);
  let energy = latest.energy_kwh;
  const cloudFactorByDay = new Map();
  const readings = [];

  for (let ts = firstMissing.getTime(); ts <= now.getTime(); ts += INTERVAL_MS) {
    const recordedAt = new Date(ts);
    const dayKey = localDateKey(recordedAt);
    if (!cloudFactorByDay.has(dayKey)) {
      cloudFactorByDay.set(dayKey, cloudFactorForDay(rng));
    }
    const cloudFactor = cloudFactorByDay.get(dayKey);

    const power = powerForReading(inst.capacity_kw, recordedAt, cloudFactor, rng);
    energy = nextEnergyKwh(energy, power);
    const voltage = voltageReading(rng);

    readings.push({
      installation_id: inst._id,
      recorded_at: recordedAt,
      power_kw: power,
      energy_kwh: energy,
      voltage_v: round3(voltage),
    });
  }

  return { meterId: inst.meter_id, readings };
}

async function insertInBatches(readings) {
  let inserted = 0;
  for (let i = 0; i < readings.length; i += BATCH_SIZE) {
    const batch = readings.slice(i, i + BATCH_SIZE);
    try {
      // ordered: false so one duplicate-key race does not block the rest of the batch; the
      // precise next-timestamp computation above should make duplicates impossible in normal
      // use, this is just a safety net against a concurrent run.
      const result = await GenerationReading.insertMany(batch, { ordered: false });
      inserted += result.length;
    } catch (err) {
      // insertMany with ordered:false still throws a BulkWriteError after attempting every
      // document; count what actually got written and report the rest as duplicates/errors.
      const writeErrors = (err && err.writeErrors) || [];
      inserted += batch.length - writeErrors.length;
      const nonDuplicateErrors = writeErrors.filter((e) => e.code !== 11000);
      if (nonDuplicateErrors.length > 0) {
        throw err;
      }
    }
  }
  return inserted;
}

async function run() {
  await connectDB();

  const now = floorTo15Min(new Date());
  const activeInstallations = await SolarInstallation.find({ status: 'active' }).lean();

  console.log(`Simulating up to ${now.toISOString()} for ${activeInstallations.length} active installations...`);

  let installationsUpdated = 0;
  let installationsSkipped = 0;
  let totalInserted = 0;
  const skippedReasons = [];

  for (const inst of activeInstallations) {
    const result = await simulateInstallation(inst, now);

    if (result.skippedReason) {
      installationsSkipped += 1;
      skippedReasons.push(`${result.meterId}: ${result.skippedReason}`);
      continue;
    }

    if (result.readings.length === 0) {
      installationsSkipped += 1;
      continue;
    }

    const inserted = await insertInBatches(result.readings);
    totalInserted += inserted;
    installationsUpdated += 1;
  }

  console.log('\n=== Simulate summary ===');
  console.log(`Installations updated: ${installationsUpdated}`);
  console.log(`Installations skipped: ${installationsSkipped}`);
  console.log(`Readings inserted: ${totalInserted}`);
  if (skippedReasons.length > 0) {
    console.log('Skip reasons (installations with no prior readings):');
    for (const reason of skippedReasons.slice(0, 20)) {
      console.log(`  - ${reason}`);
    }
    if (skippedReasons.length > 20) {
      console.log(`  ... and ${skippedReasons.length - 20} more`);
    }
  }

  await mongoose.disconnect();
  console.log('\nSimulate complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(`Simulate failed: ${err.message}`);
  process.exit(1);
});
