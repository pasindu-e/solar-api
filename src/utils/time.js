// Asia/Colombo helpers (spec section 9, 5.5). Sri Lanka uses a single fixed UTC+05:30 offset with
// no daylight saving, so plain Date arithmetic with a constant offset is correct and needs no
// timezone library.
'use strict';

const COLOMBO_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Start of "today" in Asia/Colombo, expressed as the equivalent UTC instant. Shift `now` forward
// by the Colombo offset, truncate to that shifted date's calendar day (midnight UTC of the shifted
// instant IS local midnight), then shift back by the same offset to get the real UTC Date that
// corresponds to local midnight.
function startOfTodayColombo(now = new Date()) {
  const shifted = new Date(now.getTime() + COLOMBO_OFFSET_MS);
  const localMidnightShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(localMidnightShifted - COLOMBO_OFFSET_MS);
}

module.exports = { COLOMBO_OFFSET_MS, startOfTodayColombo };
