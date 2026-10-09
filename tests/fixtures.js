// Small, fast fixture dataset for Phase 4 read-endpoint tests. Inserted directly through the
// Mongoose models (not the full seed.js script, which is meant for the large diurnal dataset).
'use strict';

const Province = require('../src/db/models/Province');
const District = require('../src/db/models/District');
const GridSubstation = require('../src/db/models/GridSubstation');
const SolarInstallation = require('../src/db/models/SolarInstallation');

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

  return {
    provinces: { western, central },
    districts: { colombo, gampaha, kandy },
    substations: { colomboSub, kandySub },
    installations,
    kandyInstallation,
  };
}

module.exports = { seedFixtures };
