// Small, fast fixture dataset for Phase 4 read-endpoint tests. Inserted directly through the
// Mongoose models (not the full seed.js script, which is meant for the large diurnal dataset).
'use strict';

const Province = require('../src/db/models/Province');
const District = require('../src/db/models/District');
const GridSubstation = require('../src/db/models/GridSubstation');
const SolarInstallation = require('../src/db/models/SolarInstallation');
const GenerationReading = require('../src/db/models/GenerationReading');

async function seedFixtures() {
  const western = await Province.create({ code: 'WP', name: 'Western' });
  const central = await Province.create({ code: 'CP', name: 'Central' });

  const colombo = await District.create({ province_id: western._id, name: 'Colombo' });
  const gampaha = await District.create({ province_id: western._id, name: 'Gampaha' });
  const kandy = await District.create({ province_id: central._id, name: 'Kandy' });

  const colomboSub = await GridSubstation.create({
    district_id: colombo._id,
    province_id: western._id,
    name: 'Colombo GSS',
    capacity_mva: 20,
  });
  const kandySub = await GridSubstation.create({
    district_id: kandy._id,
    province_id: central._id,
    name: 'Kandy GSS',
    capacity_mva: 15,
  });

  // Five installations under the Colombo substation: mixed status and capacity, for pagination,
  // filtering and sorting tests. meter_id values sort differently to capacity_kw on purpose.
  const installations = await SolarInstallation.insertMany([
    {
      substation_id: colomboSub._id,
      district_id: colombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-000005',
      capacity_kw: 5,
      status: 'active',
      device_secret_hash: 'test-hash-1',
    },
    {
      substation_id: colomboSub._id,
      district_id: colombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-000004',
      capacity_kw: 3,
      status: 'active',
      device_secret_hash: 'test-hash-2',
    },
    {
      substation_id: colomboSub._id,
      district_id: colombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-000003',
      capacity_kw: 8,
      status: 'inactive',
      device_secret_hash: 'test-hash-3',
    },
    {
      substation_id: colomboSub._id,
      district_id: colombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-000002',
      capacity_kw: 1,
      status: 'active',
      device_secret_hash: 'test-hash-4',
    },
    {
      substation_id: colomboSub._id,
      district_id: colombo._id,
      province_id: western._id,
      meter_id: 'SL-MTR-000001',
      capacity_kw: 10,
      status: 'decommissioned',
      device_secret_hash: 'test-hash-5',
    },
  ]);

  // One installation under the Kandy substation, so cross-jurisdiction filters have something to
  // exclude.
  const kandyInstallation = await SolarInstallation.create({
    substation_id: kandySub._id,
    district_id: kandy._id,
    province_id: central._id,
    meter_id: 'SL-MTR-000100',
    capacity_kw: 6,
    status: 'active',
    device_secret_hash: 'test-hash-6',
  });

  // Readings fixtures (Phase 5). Times are relative to "now" so the aggregated endpoints' default
  // 24h window, and from/to filtering, behave deterministically regardless of when tests run.
  // installations[0] (SL-MTR-000005, Colombo sub) gets a reading older than 24h on purpose, to
  // prove the default window and explicit from/to filters both exclude it.
  const now = Date.now();
  const minutesAgo = (m) => new Date(now - m * 60 * 1000);

  const instA = installations[0]; // SL-MTR-000005, Colombo substation
  const instB = installations[1]; // SL-MTR-000004, Colombo substation
  const instNoReadings = installations[3]; // SL-MTR-000002, Colombo substation - zero readings

  const readingDocs = [
    // instA: one reading outside the last 24h, three inside it.
    { installation_id: instA._id, recorded_at: minutesAgo(60 * 24 * 2), power_kw: 1, energy_kwh: 100, voltage_v: 230 },
    { installation_id: instA._id, recorded_at: minutesAgo(180), power_kw: 2, energy_kwh: 200, voltage_v: 231 },
    { installation_id: instA._id, recorded_at: minutesAgo(60), power_kw: 3, energy_kwh: 300, voltage_v: 232 },
    { installation_id: instA._id, recorded_at: minutesAgo(10), power_kw: 4, energy_kwh: 400, voltage_v: 233 },
    // instB: two readings, both inside the last 24h.
    { installation_id: instB._id, recorded_at: minutesAgo(50), power_kw: 5, energy_kwh: 500, voltage_v: 234 },
    { installation_id: instB._id, recorded_at: minutesAgo(5), power_kw: 6, energy_kwh: 600, voltage_v: 235 },
    // kandyInstallation (different substation/district/province): two readings.
    { installation_id: kandyInstallation._id, recorded_at: minutesAgo(40), power_kw: 7, energy_kwh: 700, voltage_v: 236 },
    { installation_id: kandyInstallation._id, recorded_at: minutesAgo(2), power_kw: 8, energy_kwh: 800, voltage_v: 237 },
  ];
  const readings = await GenerationReading.insertMany(readingDocs);

  return {
    provinces: { western, central },
    districts: { colombo, gampaha, kandy },
    substations: { colomboSub, kandySub },
    installations,
    kandyInstallation,
    instA,
    instB,
    instNoReadings,
    readings,
  };
}

module.exports = { seedFixtures };
