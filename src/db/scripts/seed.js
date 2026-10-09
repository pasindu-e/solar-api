// Repeatable seed script (npm run seed): drops the six domain collections and reloads a
// deterministic dataset (seeded PRNG) in dependency order, per spec section 4 and 3.4:
// provinces -> districts -> grid_substations -> solar_installations -> generation_readings -> users.
'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const seedrandom = require('seedrandom');
const bcrypt = require('bcryptjs');

const connectDB = require('../connect');
const config = require('../../config');

const Province = require('../models/Province');
const District = require('../models/District');
const GridSubstation = require('../models/GridSubstation');
const SolarInstallation = require('../models/SolarInstallation');
const GenerationReading = require('../models/GenerationReading');
const User = require('../models/User');

const {
  floorTo15Min,
  localDateKey,
  cloudFactorForDay,
  powerForReading,
  nextEnergyKwh,
  voltageReading,
  round3,
} = require('./lib/generateReading');

// --- Fixed seed data (spec section 4 table) -------------------------------------------------

// Province codes are not given by the spec beyond the "WP" example in 3.3, so these were
// invented for this seed (short, unique, documented in the Phase 3 report).
const PROVINCES = [
  { code: 'WP', name: 'Western', districts: ['Colombo', 'Gampaha', 'Kalutara'] },
  { code: 'CP', name: 'Central', districts: ['Kandy', 'Matale', 'Nuwara Eliya'] },
  { code: 'SP', name: 'Southern', districts: ['Galle', 'Matara', 'Hambantota'] },
  {
    code: 'NP',
    name: 'Northern',
    districts: ['Jaffna', 'Kilinochchi', 'Mannar', 'Vavuniya', 'Mullaitivu'],
  },
  { code: 'EP', name: 'Eastern', districts: ['Batticaloa', 'Ampara', 'Trincomalee'] },
  { code: 'NWP', name: 'North Western', districts: ['Kurunegala', 'Puttalam'] },
  { code: 'NCP', name: 'North Central', districts: ['Anuradhapura', 'Polonnaruwa'] },
  { code: 'UP', name: 'Uva', districts: ['Badulla', 'Monaragala'] },
  { code: 'SG', name: 'Sabaragamuwa', districts: ['Ratnapura', 'Kegalle'] },
];

const TOTAL_SUBSTATIONS = 30;
const TOTAL_INSTALLATIONS = 250;
const READING_DAYS = 7;
const READINGS_PER_DAY = 96;
const READINGS_PER_INSTALLATION = READING_DAYS * READINGS_PER_DAY; // 672
const BATCH_SIZE = 4000;
const DEMO_PASSWORD = 'Demo123!'; // deterministic demo password for all seeded users

const FIRST_NAMES = ['A.', 'B.', 'C.', 'D.', 'K.', 'M.', 'N.', 'P.', 'R.', 'S.', 'T.', 'W.'];
const LAST_NAMES = [
  'Perera',
  'Fernando',
  'Silva',
  'Rajapaksa',
  'Gunawardena',
  'Jayasuriya',
  'Wickramasinghe',
  'Bandara',
  'Kumar',
  'Ahamed',
  'de Mel',
  'Senanayake',
];

// Sri Lanka's approximate bounding box, used to place installations at plausible coordinates.
const SL_LAT_RANGE = [5.9, 9.9];
const SL_LON_RANGE = [79.6, 81.9];

function randomBetween(rng, min, max) {
  return min + rng() * (max - min);
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

async function dropCollections() {
  // deleteMany (not drop()) so the script also works the first time, before indexes exist.
  await Promise.all([
    GenerationReading.deleteMany({}),
    SolarInstallation.deleteMany({}),
    GridSubstation.deleteMany({}),
    District.deleteMany({}),
    Province.deleteMany({}),
    User.deleteMany({}),
  ]);
  console.log('Cleared existing provinces, districts, grid_substations, solar_installations,'
    + ' generation_readings and users.');
}

async function seedHierarchy(rng) {
  const provinceDocs = await Province.insertMany(
    PROVINCES.map((p) => ({ code: p.code, name: p.name }))
  );
  const provinceByName = new Map(provinceDocs.map((p) => [p.name, p]));

  const districtInputs = [];
  for (const p of PROVINCES) {
    for (const districtName of p.districts) {
      districtInputs.push({ province_id: provinceByName.get(p.name)._id, name: districtName });
    }
  }
  const districtDocs = await District.insertMany(districtInputs);
  console.log(`Seeded ${provinceDocs.length} provinces and ${districtDocs.length} districts.`);

  // One substation per district first (25), guaranteeing no district is empty, then
  // TOTAL_SUBSTATIONS - districtDocs.length extra substations dropped onto random districts.
  const substationInputs = districtDocs.map((d) => ({
    district_id: d._id,
    province_id: d.province_id,
    name: `${d.name} GSS`,
    capacity_mva: round3(randomBetween(rng, 5, 40)),
  }));

  const extraCount = TOTAL_SUBSTATIONS - districtDocs.length;
  for (let i = 0; i < extraCount; i += 1) {
    const d = pick(rng, districtDocs);
    const countForDistrict = substationInputs.filter((s) => String(s.district_id) === String(d._id)).length;
    substationInputs.push({
      district_id: d._id,
      province_id: d.province_id,
      name: `${d.name} GSS ${countForDistrict + 1}`,
      capacity_mva: round3(randomBetween(rng, 5, 40)),
    });
  }

  const substationDocs = await GridSubstation.insertMany(substationInputs);
  console.log(`Seeded ${substationDocs.length} grid substations (>=1 per district).`);

  return { provinceDocs, districtDocs, substationDocs };
}

async function seedInstallations(rng, substationDocs) {
  // A random weight (1-10) per substation so installations are spread unevenly across them.
  const weights = substationDocs.map(() => randomBetween(rng, 1, 10));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  function pickSubstationIndex() {
    let r = rng() * totalWeight;
    for (let i = 0; i < substationDocs.length; i += 1) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return substationDocs.length - 1;
  }

  const installationInputs = [];
  const demoSecrets = []; // { meter_id, secret } for device-credentials.csv

  for (let i = 1; i <= TOTAL_INSTALLATIONS; i += 1) {
    const substation = substationDocs[pickSubstationIndex()];
    const meterId = `SL-MTR-${pad(i, 6)}`;
    const secret = `demo-secret-${meterId}`;
    const secretHash = bcrypt.hashSync(secret, 10);
    demoSecrets.push({ meter_id: meterId, secret });

    // About 5% of installations are inactive ("include a few", spec section 4).
    const status = rng() < 0.05 ? 'inactive' : 'active';

    const installedYearsAgo = randomBetween(rng, 0.1, 8);
    const installedAt = new Date(Date.now() - installedYearsAgo * 365 * 24 * 60 * 60 * 1000);

    installationInputs.push({
      substation_id: substation._id,
      district_id: substation.district_id,
      province_id: substation.province_id,
      meter_id: meterId,
      owner_name: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      capacity_kw: round3(randomBetween(rng, 3, 50)),
      status,
      latitude: round3(randomBetween(rng, SL_LAT_RANGE[0], SL_LAT_RANGE[1])),
      longitude: round3(randomBetween(rng, SL_LON_RANGE[0], SL_LON_RANGE[1])),
      installed_at: installedAt,
      device_secret_hash: secretHash,
    });
  }

  const installationDocs = await SolarInstallation.insertMany(installationInputs);
  console.log(
    `Seeded ${installationDocs.length} solar installations ` +
      `(${installationDocs.filter((d) => d.status === 'inactive').length} inactive).`
  );

  // Gitignored plaintext device-credentials file (spec section 4 suggestion).
  const csvPath = path.join(__dirname, '..', '..', '..', 'device-credentials.csv');
  const csvLines = ['meter_id,device_secret', ...demoSecrets.map((d) => `${d.meter_id},${d.secret}`)];
  fs.writeFileSync(csvPath, csvLines.join('\n') + '\n', 'utf8');
  console.log(`Wrote ${demoSecrets.length} demo device credentials to device-credentials.csv (gitignored).`);

  return installationDocs;
}

async function seedReadings(installationDocs) {
  const end = floorTo15Min(new Date());
  const start = new Date(end.getTime() - (READINGS_PER_INSTALLATION - 1) * 15 * 60 * 1000);

  let batch = [];
  let inserted = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await GenerationReading.insertMany(batch, { ordered: false });
    inserted += batch.length;
    batch = [];
  };

  for (let idx = 0; idx < installationDocs.length; idx += 1) {
    const inst = installationDocs[idx];
    const rng = seedrandom(`${config.seedRandom}:readings:${inst.meter_id}`);
    let energy = round3(randomBetween(rng, 1000, 50000)); // random lifetime offset
    const cloudFactorByDay = new Map();

    for (let step = 0; step < READINGS_PER_INSTALLATION; step += 1) {
      const recordedAt = new Date(start.getTime() + step * 15 * 60 * 1000);
      const dayKey = localDateKey(recordedAt);
      if (!cloudFactorByDay.has(dayKey)) {
        cloudFactorByDay.set(dayKey, cloudFactorForDay(rng));
      }
      const cloudFactor = cloudFactorByDay.get(dayKey);

      const power = powerForReading(inst.capacity_kw, recordedAt, cloudFactor, rng);
      energy = nextEnergyKwh(energy, power);
      const voltage = voltageReading(rng);

      batch.push({
        installation_id: inst._id,
        recorded_at: recordedAt,
        power_kw: power,
        energy_kwh: energy,
        voltage_v: voltage,
      });

      if (batch.length >= BATCH_SIZE) {
        await flush();
      }
    }

    if ((idx + 1) % 25 === 0 || idx === installationDocs.length - 1) {
      console.log(
        `Generated readings for ${idx + 1}/${installationDocs.length} installations ` +
          `(${inserted + batch.length} readings so far)...`
      );
    }
  }

  await flush();
  console.log(`Seeded ${inserted} generation readings (${READINGS_PER_INSTALLATION} per installation).`);
  return { inserted, start, end };
}

async function seedUsers(provinceDocs, districtDocs) {
  const byProvinceName = new Map(provinceDocs.map((p) => [p.name, p]));
  const byDistrictName = new Map(districtDocs.map((d) => [d.name, d]));
  const passwordHash = bcrypt.hashSync(DEMO_PASSWORD, 10);

  const userInputs = [
    {
      email: 'national@slsea.demo',
      full_name: 'National Analyst',
      role: 'national_analyst',
    },
    {
      email: 'provincial.western@slsea.demo',
      full_name: 'Western Provincial Analyst',
      role: 'provincial_analyst',
      province_id: byProvinceName.get('Western')._id,
    },
    {
      email: 'provincial.central@slsea.demo',
      full_name: 'Central Provincial Analyst',
      role: 'provincial_analyst',
      province_id: byProvinceName.get('Central')._id,
    },
    {
      email: 'provincial.southern@slsea.demo',
      full_name: 'Southern Provincial Analyst',
      role: 'provincial_analyst',
      province_id: byProvinceName.get('Southern')._id,
    },
    {
      email: 'district.colombo@slsea.demo',
      full_name: 'Colombo District Analyst',
      role: 'district_analyst',
      district_id: byDistrictName.get('Colombo')._id,
    },
    {
      email: 'district.kandy@slsea.demo',
      full_name: 'Kandy District Analyst',
      role: 'district_analyst',
      district_id: byDistrictName.get('Kandy')._id,
    },
    {
      email: 'district.galle@slsea.demo',
      full_name: 'Galle District Analyst',
      role: 'district_analyst',
      district_id: byDistrictName.get('Galle')._id,
    },
    {
      email: 'district.jaffna@slsea.demo',
      full_name: 'Jaffna District Analyst',
      role: 'district_analyst',
      district_id: byDistrictName.get('Jaffna')._id,
    },
    {
      email: 'admin@slsea.demo',
      full_name: 'SLSEA Admin',
      role: 'admin',
    },
  ].map((u) => ({ ...u, password_hash: passwordHash }));

  // Inserted one by one (not insertMany) so the User model's pre('validate') hook runs for
  // each document and derives jurisdiction_level from role, exercising that Phase 2 hook.
  const userDocs = [];
  for (const u of userInputs) {
    const doc = new User(u);
    await doc.save();
    userDocs.push(doc);
  }

  console.log(`Seeded ${userDocs.length} users.`);
  return userDocs;
}

function printSummary(counts, userDocs, readingsWindow) {
  console.log('\n=== Seed summary ===');
  console.log(counts);
  console.log(
    `Readings window: ${readingsWindow.start.toISOString()} to ${readingsWindow.end.toISOString()} (UTC)`
  );
  console.log('\n=== Demo user credentials (password for all: "Demo123!") ===');
  console.log('email'.padEnd(32) + 'role');
  for (const u of userDocs) {
    console.log(u.email.padEnd(32) + u.role);
  }
  console.log('\nDevice demo secrets: see device-credentials.csv (gitignored, not printed here).');
}

async function run() {
  await connectDB();
  const rng = seedrandom(config.seedRandom);

  await dropCollections();
  const { provinceDocs, districtDocs, substationDocs } = await seedHierarchy(rng);
  const installationDocs = await seedInstallations(rng, substationDocs);
  const { start, end } = await seedReadings(installationDocs);
  const userDocs = await seedUsers(provinceDocs, districtDocs);

  const counts = {
    provinces: await Province.countDocuments(),
    districts: await District.countDocuments(),
    grid_substations: await GridSubstation.countDocuments(),
    solar_installations: await SolarInstallation.countDocuments(),
    generation_readings: await GenerationReading.countDocuments(),
    users: await User.countDocuments(),
  };

  printSummary(counts, userDocs, { start, end });

  await mongoose.disconnect();
  console.log('\nSeed complete.');
  process.exit(0);
}

run().catch((err) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
