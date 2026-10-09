// Shared diurnal generation-reading math, used by both seed.js and simulate.js so the
// sine-curve power formula, cloud factor, energy accumulation and voltage noise live in
// exactly one place (spec section 4, "Reading generation rules").
'use strict';

const COLOMBO_OFFSET_MINUTES = 5 * 60 + 30; // Asia/Colombo is a fixed UTC+05:30, no DST.
const INTERVAL_MINUTES = 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

// Rounds to 3 decimal places (spec: "round numbers to 3 decimal places before inserting").
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// Returns the local Asia/Colombo hour-of-day (0 to 23.75) for a UTC Date, using the fixed offset.
function localHourOfDay(utcDate) {
  const local = new Date(utcDate.getTime() + COLOMBO_OFFSET_MINUTES * 60 * 1000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

// Returns a "YYYY-MM-DD" key for the local Asia/Colombo calendar day of a UTC Date.
// Used to pick one cloud_factor per day per site.
function localDateKey(utcDate) {
  const local = new Date(utcDate.getTime() + COLOMBO_OFFSET_MINUTES * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  const d = String(local.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Rounds a Date down to the nearest 15-minute boundary (UTC).
function floorTo15Min(date) {
  return new Date(Math.floor(date.getTime() / INTERVAL_MS) * INTERVAL_MS);
}

// A per-day, per-site cloud factor in roughly [0.6, 1.0] (spec: "random per day per site").
function cloudFactorForDay(rng) {
  return round3(0.6 + rng() * 0.4);
}

// power_kw = capacity_kw * max(0, sin(pi * (hour - 6) / 12)) * cloud_factor, plus small
// per-reading noise. Zero outside the 06:00-18:00 local window.
function powerForReading(capacityKw, utcDate, cloudFactor, rng) {
  const hour = localHourOfDay(utcDate);
  const base = Math.max(0, Math.sin((Math.PI * (hour - 6)) / 12));
  if (base <= 0) return 0;
  const noise = 1 + (rng() - 0.5) * 0.04; // +/- 2% per-reading noise
  return round3(Math.max(0, capacityKw * base * cloudFactor * noise));
}

// energy_kwh accumulates: previous + power_kw * (15 minutes in hours).
function nextEnergyKwh(previousEnergyKwh, powerKw) {
  return round3(previousEnergyKwh + powerKw * (INTERVAL_MINUTES / 60));
}

// voltage_v is about 230V with small noise, kept inside [225, 240].
function voltageReading(rng) {
  return round3(230 + rng() * 15 - 5);
}

module.exports = {
  COLOMBO_OFFSET_MINUTES,
  INTERVAL_MINUTES,
  INTERVAL_MS,
  round3,
  localHourOfDay,
  localDateKey,
  floorTo15Min,
  cloudFactorForDay,
  powerForReading,
  nextEnergyKwh,
  voltageReading,
};
