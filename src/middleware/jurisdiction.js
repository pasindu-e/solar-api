// Jurisdiction enforcement (spec 8.3): a hybrid of scopes (checked by requireScope) and attributes
// (checked here). Exports:
//   scopeFilter(auth)                      - Mongo filter fragment merged into every list query
//   assertResourceWithinJurisdiction(auth, scope) - direct-resource-access check (403)
//   assertProvinceFilterInJurisdiction / assertDistrictFilterInJurisdiction /
//   assertSubstationFilterInJurisdiction  - narrowing-filter-can-only-narrow checks (403)
//   assertOwnInstallation(auth, installationId)   - device-token-vs-path check (403, spec 5.4a)
'use strict';

const { ApiError } = require('../utils/errors');

function outOfJurisdiction() {
  return new ApiError(403, 'OUT_OF_JURISDICTION', 'This resource is outside your jurisdiction.');
}

// Mongo filter fragment for any list query, derived from the token's jurisdiction claim. {} for
// national level (admin and national_analyst) - no restriction. Callers merge this into the SAME
// filter object used by both the list query and countDocuments (never two separate filters), so
// pagination's `total` can never include out-of-scope documents (spec 8.3 point 5).
function scopeFilter(auth) {
  const jurisdiction = auth && auth.jurisdiction;
  if (!jurisdiction || jurisdiction.level === 'national') return {};
  if (jurisdiction.level === 'province') return { province_id: jurisdiction.province_id };
  if (jurisdiction.level === 'district') return { district_id: jurisdiction.district_id };
  return {};
}

// Direct resource access check (spec 8.3 point 1). `scope` is { province_id, district_id }
// describing where the loaded resource itself sits. district_id is omitted/undefined for a
// Province document (a province has no district_id of its own) - see the judgment-call note below.
function assertResourceWithinJurisdiction(auth, scope) {
  const jurisdiction = auth && auth.jurisdiction;
  if (!jurisdiction || jurisdiction.level === 'national') return;

  if (jurisdiction.level === 'province') {
    if (String(scope.province_id) !== String(jurisdiction.province_id)) throw outOfJurisdiction();
    return;
  }

  // jurisdiction.level === 'district'
  if (scope.district_id !== undefined && scope.district_id !== null) {
    if (String(scope.district_id) !== String(jurisdiction.district_id)) throw outOfJurisdiction();
    return;
  }
  // Judgment call: a resource with no district_id of its own (only a Province document reaches
  // this branch) is treated as visible when it is the user's own ancestor province. Spec 8.3's
  // table does not explicitly list provinces as visible to province/district users, but denying a
  // user their own ancestor province would be inconsistent with every other "see your own branch
  // of the tree" rule in this spec, so this is the most defensible reading - documented for the
  // viva.
  if (String(scope.province_id) !== String(jurisdiction.province_id)) throw outOfJurisdiction();
}

// province_id query filter: always a direct id comparison, no database lookup needed - both
// province- and district-level tokens already carry their own province_id.
function assertProvinceFilterInJurisdiction(auth, provinceId) {
  const jurisdiction = auth && auth.jurisdiction;
  if (!jurisdiction || jurisdiction.level === 'national') return;
  if (String(provinceId) !== String(jurisdiction.province_id)) throw outOfJurisdiction();
}

// district_id query filter. District-level: direct id comparison (no lookup). Province-level:
// needs the district's own province_id (districtDoc, looked up by the caller) to know which
// province it belongs to. If the district does not exist at all, this is left to the normal
// "filter matches nothing" 200-empty-result behaviour rather than a 403 - a non-existent district
// cannot be judged "out of jurisdiction".
function assertDistrictFilterInJurisdiction(auth, districtId, districtDoc) {
  const jurisdiction = auth && auth.jurisdiction;
  if (!jurisdiction || jurisdiction.level === 'national') return;
  if (jurisdiction.level === 'district') {
    if (String(districtId) !== String(jurisdiction.district_id)) throw outOfJurisdiction();
    return;
  }
  if (districtDoc && String(districtDoc.province_id) !== String(jurisdiction.province_id)) {
    throw outOfJurisdiction();
  }
}

// substation_id query filter. Needs the substation's own province_id/district_id (substationDoc,
// looked up by the caller) for either jurisdiction level. Same "unknown id falls through to an
// empty result" reasoning as assertDistrictFilterInJurisdiction.
function assertSubstationFilterInJurisdiction(auth, substationDoc) {
  const jurisdiction = auth && auth.jurisdiction;
  if (!jurisdiction || jurisdiction.level === 'national' || !substationDoc) return;
  if (jurisdiction.level === 'district' && String(substationDoc.district_id) !== String(jurisdiction.district_id)) {
    throw outOfJurisdiction();
  }
  if (jurisdiction.level === 'province' && String(substationDoc.province_id) !== String(jurisdiction.province_id)) {
    throw outOfJurisdiction();
  }
}

// Device-specific check (spec 5.4a): the device token's installation_id claim must equal the path
// installationId, else 403 FORBIDDEN - the generic code, not OUT_OF_JURISDICTION, since devices
// have no jurisdiction concept (follows the spec literally). Called before any database lookup so
// a device can never distinguish "wrong installation" from "installation does not exist".
function assertOwnInstallation(auth, installationId) {
  if (!auth || auth.installation_id !== installationId) {
    throw ApiError.forbidden('This token is not authorized to write to this installation.');
  }
}

module.exports = {
  scopeFilter,
  assertResourceWithinJurisdiction,
  assertProvinceFilterInJurisdiction,
  assertDistrictFilterInJurisdiction,
  assertSubstationFilterInJurisdiction,
  assertOwnInstallation,
};
