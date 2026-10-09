// npm run seed:verify - proves referential integrity without foreign keys (spec section 3.4).
// Uses aggregation $lookup to assert zero orphans at every level of the hierarchy, plus a
// logical check that the unique (installation_id, recorded_at) reading index assumption holds.
// Exits 0 if every check passes, non-zero (and prints offending ids) otherwise.
'use strict';

const mongoose = require('mongoose');
const connectDB = require('../connect');

const Province = require('../models/Province');
const District = require('../models/District');
const GridSubstation = require('../models/GridSubstation');
const SolarInstallation = require('../models/SolarInstallation');
const GenerationReading = require('../models/GenerationReading');
const User = require('../models/User');

let failed = false;

function report(name, offenders) {
  if (offenders.length === 0) {
    console.log(`PASS  ${name}`);
    return;
  }
  failed = true;
  console.log(`FAIL  ${name} (${offenders.length} offending document(s))`);
  for (const o of offenders.slice(0, 20)) {
    console.log(`        - ${JSON.stringify(o)}`);
  }
  if (offenders.length > 20) {
    console.log(`        ... and ${offenders.length - 20} more`);
  }
}

// Districts whose province_id does not resolve to an existing province.
async function checkDistrictsHaveValidProvince() {
  const rows = await District.aggregate([
    {
      $lookup: {
        from: 'provinces',
        localField: 'province_id',
        foreignField: '_id',
        as: 'province',
      },
    },
    { $match: { province: { $size: 0 } } },
    { $project: { _id: 1, name: 1, province_id: 1 } },
  ]);
  report('districts -> provinces (no orphans)', rows);
}

// Substations with a missing district_id, or whose stored province_id disagrees with the
// province_id of their own district_id (denormalisation consistency, spec 3.3).
async function checkSubstationsConsistent() {
  const rows = await GridSubstation.aggregate([
    {
      $lookup: {
        from: 'districts',
        localField: 'district_id',
        foreignField: '_id',
        as: 'district',
      },
    },
    {
      $match: {
        $or: [
          { district: { $size: 0 } },
          {
            $expr: {
              $ne: ['$province_id', { $arrayElemAt: ['$district.province_id', 0] }],
            },
          },
        ],
      },
    },
    { $project: { _id: 1, name: 1, district_id: 1, province_id: 1 } },
  ]);
  report('grid_substations -> districts (valid parent, province_id matches)', rows);
}

// Installations with a missing substation_id, or whose denormalised district_id/province_id
// disagree with their substation's actual district/province.
async function checkInstallationsConsistent() {
  const rows = await SolarInstallation.aggregate([
    {
      $lookup: {
        from: 'gridsubstations',
        localField: 'substation_id',
        foreignField: '_id',
        as: 'substation',
      },
    },
    {
      $match: {
        $or: [
          { substation: { $size: 0 } },
          {
            $expr: {
              $ne: ['$district_id', { $arrayElemAt: ['$substation.district_id', 0] }],
            },
          },
          {
            $expr: {
              $ne: ['$province_id', { $arrayElemAt: ['$substation.province_id', 0] }],
            },
          },
        ],
      },
    },
    { $project: { _id: 1, meter_id: 1, substation_id: 1, district_id: 1, province_id: 1 } },
  ]);
  report('solar_installations -> grid_substations (valid parent, district/province match)', rows);
}

// Readings whose installation_id does not resolve to an existing installation.
async function checkReadingsHaveValidInstallation() {
  const rows = await GenerationReading.aggregate([
    {
      $lookup: {
        from: 'solarinstallations',
        localField: 'installation_id',
        foreignField: '_id',
        as: 'installation',
      },
    },
    { $match: { installation: { $size: 0 } } },
    { $limit: 1000 },
    { $project: { _id: 1, installation_id: 1, recorded_at: 1 } },
  ]);
  report('generation_readings -> solar_installations (no orphans)', rows);
}

// Logical check standing in for the unique (installation_id, recorded_at) index: the number
// of readings should equal the number of distinct (installation_id, recorded_at) pairs.
async function checkNoDuplicateReadingKeys() {
  const totalReadings = await GenerationReading.countDocuments();
  const distinctGroups = await GenerationReading.aggregate([
    { $group: { _id: { installation_id: '$installation_id', recorded_at: '$recorded_at' } } },
    { $count: 'distinctCount' },
  ]);
  const distinctCount = distinctGroups.length > 0 ? distinctGroups[0].distinctCount : 0;

  if (distinctCount === totalReadings) {
    console.log(
      `PASS  generation_readings unique (installation_id, recorded_at) ` +
        `(${totalReadings} readings, ${distinctCount} distinct keys)`
    );
  } else {
    failed = true;
    console.log(
      `FAIL  generation_readings unique (installation_id, recorded_at) ` +
        `(${totalReadings} readings, only ${distinctCount} distinct keys - ` +
        `${totalReadings - distinctCount} duplicate key(s))`
    );
  }
}

// Users whose province_id/district_id (required by jurisdiction_level) point at nothing.
async function checkUsersHaveValidJurisdiction() {
  const rows = await User.aggregate([
    {
      $lookup: {
        from: 'provinces',
        localField: 'province_id',
        foreignField: '_id',
        as: 'province',
      },
    },
    {
      $lookup: {
        from: 'districts',
        localField: 'district_id',
        foreignField: '_id',
        as: 'district',
      },
    },
    {
      $match: {
        $or: [
          { $and: [{ province_id: { $ne: null } }, { province: { $size: 0 } }] },
          { $and: [{ district_id: { $ne: null } }, { district: { $size: 0 } }] },
        ],
      },
    },
    { $project: { _id: 1, email: 1, province_id: 1, district_id: 1 } },
  ]);
  report('users -> provinces/districts (no dangling jurisdiction refs)', rows);
}

async function printCounts() {
  const counts = {
    provinces: await Province.countDocuments(),
    districts: await District.countDocuments(),
    grid_substations: await GridSubstation.countDocuments(),
    solar_installations: await SolarInstallation.countDocuments(),
    generation_readings: await GenerationReading.countDocuments(),
    users: await User.countDocuments(),
  };
  console.log('\n=== Collection counts ===');
  console.log(counts);
}

async function run() {
  await connectDB();

  console.log('=== seed:verify - referential integrity checks ===');
  await checkDistrictsHaveValidProvince();
  await checkSubstationsConsistent();
  await checkInstallationsConsistent();
  await checkReadingsHaveValidInstallation();
  await checkNoDuplicateReadingKeys();
  await checkUsersHaveValidJurisdiction();

  await printCounts();

  await mongoose.disconnect();

  if (failed) {
    console.log('\nRESULT: FAIL - one or more integrity checks failed. See details above.');
    process.exit(1);
  }
  console.log('\nRESULT: PASS - zero orphans at every level.');
  process.exit(0);
}

run().catch((err) => {
  console.error(`seed:verify crashed: ${err.message}`);
  process.exit(1);
});
