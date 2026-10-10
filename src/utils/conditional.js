// Conditional GET helpers (spec 6.4): ETag/Last-Modified computation, the If-None-Match /
// If-Modified-Since 304 decision, and the If-Match check used by future (Phase 8) writes for 412.
// Implemented explicitly (not via Express's req.fresh) so Last-Modified is always set and the
// logic is easy to explain at viva.
'use strict';

const crypto = require('node:crypto');

// Atomic resource ETag: "<prefix>-<id>-v<version>" (e.g. "inst-6650...-v3", spec 6.4's example).
// Readings have no version (they are immutable, see GenerationReading model), so when `version`
// is null/undefined the "-v<version>" segment is left off entirely rather than printing "-vnull".
function computeAtomicETag(resourceType, id, version) {
  const base = `${resourceType}-${id}`;
  const value = version === null || version === undefined ? base : `${base}-v${version}`;
  return `"${value}"`;
}

// Collection/composite/derived resource ETag: a hash of the exact JSON body about to be sent.
// SHA-1 is plenty for a change-detection ETag (no cryptographic requirement here) and is shorter
// than SHA-256. JSON.stringify on the same object shape always produces the same key order, since
// every caller builds that object the same way on every call - no need for deep key-sorting.
function computeHashETag(body) {
  const hash = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex');
  return `"${hash}"`;
}

// Parses the (possibly comma-separated, possibly weak "W/"-prefixed) If-None-Match header into
// a list of bare quoted-string values, per RFC 7232 section 3.2.
function parseETagList(headerValue) {
  return headerValue
    .split(',')
    .map((part) => part.trim())
    .map((part) => (part.startsWith('W/') ? part.slice(2) : part))
    .filter((part) => part.length > 0);
}

// True if `etag` satisfies the client's If-None-Match header: "*" matches any current
// representation, otherwise any exact match in the comma-separated list counts.
function ifNoneMatchSatisfied(headerValue, etag) {
  if (!headerValue) return false;
  if (headerValue.trim() === '*') return true;
  return parseETagList(headerValue).includes(etag);
}

// True if the resource is unchanged since the client's If-Modified-Since date (fallback, spec
// 6.4). HTTP-date has only second precision, so compare at the second.
function ifModifiedSinceSatisfied(headerValue, lastModified) {
  if (!headerValue || !lastModified) return false;
  const since = new Date(headerValue);
  if (Number.isNaN(since.getTime())) return false;
  const lastModifiedSeconds = Math.floor(lastModified.getTime() / 1000);
  const sinceSeconds = Math.floor(since.getTime() / 1000);
  return lastModifiedSeconds <= sinceSeconds;
}

// Sends either a 304 (If-None-Match match, or If-Modified-Since fallback) or the real response.
// Always sets ETag; sets Last-Modified too when given. A 304 has no body (res.status(304).end()),
// per spec 6.4 ("304 with an empty body (also send ETag)").
function sendConditional(req, res, { etag, lastModified, body, status = 200, headers = {} }) {
  res.set('ETag', etag);
  if (lastModified) {
    res.set('Last-Modified', lastModified.toUTCString());
  }
  for (const [key, value] of Object.entries(headers)) {
    res.set(key, value);
  }

  const ifNoneMatch = req.headers['if-none-match'];
  const ifModifiedSince = req.headers['if-modified-since'];

  if (ifNoneMatchSatisfied(ifNoneMatch, etag)) {
    return res.status(304).end();
  }
  // If-Modified-Since is only a fallback: spec 6.4 says to use it when If-None-Match is absent.
  if (!ifNoneMatch && ifModifiedSinceSatisfied(ifModifiedSince, lastModified)) {
    return res.status(304).end();
  }

  return res.status(status).json(body);
}

// Used by future (Phase 8) write endpoints: if the client sent If-Match, it must equal the
// resource's current ETag or the write is rejected with 412 (spec 6.4). Returns 'absent' when no
// If-Match header was sent at all (writes proceed unconditionally in that case), or true/false
// once a header is present. Not called by any route yet - no write routes exist until Phase 8,
// this is the reusable piece that route will call before applying its update.
function checkIfMatch(req, currentETag) {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) return 'absent';
  if (ifMatch.trim() === '*') return true;
  return parseETagList(ifMatch).includes(currentETag);
}

// Small DRY wrapper for the common "atomic resource" case (province/district/substation/
// installation/reading GET by id): compute the ETag from resourceType/id/version, Last-Modified
// from the given date, and send. Keeps the 4+ controllers that repeat this pattern from
// duplicating the computeAtomicETag + sendConditional pair.
function sendAtomicConditional(req, res, { resourceType, id, version, lastModified, body }) {
  const etag = computeAtomicETag(resourceType, id, version);
  return sendConditional(req, res, { etag, lastModified, body });
}

// Small DRY wrapper for the common "hash the full body" case (collections, composite/derived
// resources): the ETag is a hash of the exact body about to be sent, Last-Modified is optional
// and endpoint-specific (e.g. the newest recorded_at for a readings list).
function sendHashConditional(req, res, { body, lastModified }) {
  const etag = computeHashETag(body);
  return sendConditional(req, res, { etag, lastModified, body });
}

module.exports = {
  computeAtomicETag,
  computeHashETag,
  sendConditional,
  sendAtomicConditional,
  sendHashConditional,
  checkIfMatch,
};
