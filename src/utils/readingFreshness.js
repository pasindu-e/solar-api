// Shared by every readings-collection controller: finds the newest recorded_at in a page of
// readings, for use as that response's Last-Modified (spec 6.4: "for readings: the newest
// recorded_at in the result"). Returns null when the page is empty - there is nothing meaningful
// to report, so the caller should omit Last-Modified in that case.
'use strict';

function newestRecordedAt(readings) {
  if (!readings || readings.length === 0) return null;
  return readings.reduce((latest, reading) => {
    const recordedAt = reading.recorded_at;
    return !latest || recordedAt > latest ? recordedAt : latest;
  }, null);
}

module.exports = { newestRecordedAt };
