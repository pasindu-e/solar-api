// Shared pagination helper (spec section 6.1): runs a paginated find + count, then builds the
// { data, pagination, links } envelope used by every collection endpoint.
'use strict';

const { URLSearchParams } = require('node:url');
const { ApiError } = require('./errors');

const MAX_PAGE_SIZE = 500;

// Builds one page's URL, keeping every other query parameter and swapping only page/page_size.
function buildLink(basePath, query, page, pageSize) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (key === 'page' || key === 'page_size') continue;
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  return `${basePath}?${params.toString()}`;
}

function buildLinks(basePath, query, page, pageSize, totalPages) {
  // When the collection is empty totalPages is 0 (see the note in paginate()); treat that the
  // same as a single, empty, page 1 for the purposes of "first"/"last".
  const lastPage = totalPages > 0 ? totalPages : 1;
  return {
    self: buildLink(basePath, query, page, pageSize),
    first: buildLink(basePath, query, 1, pageSize),
    prev: page > 1 ? buildLink(basePath, query, page - 1, pageSize) : null,
    next: page < lastPage ? buildLink(basePath, query, page + 1, pageSize) : null,
    last: buildLink(basePath, query, lastPage, pageSize),
  };
}

// Defensive re-check of page/page_size, even though the zod query schemas already enforce this
// before a controller ever calls paginate() - cheap, and keeps this helper safe to call directly.
function assertPageParams(page, pageSize) {
  if (!Number.isInteger(page) || page < 1) {
    throw ApiError.badRequest('Invalid pagination parameters.', [
      { field: 'page', issue: 'must be an integer greater than or equal to 1' },
    ]);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw ApiError.badRequest('Invalid pagination parameters.', [
      { field: 'page_size', issue: `must be an integer between 1 and ${MAX_PAGE_SIZE}` },
    ]);
  }
}

// Model: a Mongoose model. filter: the Mongo filter object (built from validated values only).
// sort: a Mongoose sort object (never raw user input, see src/schemas). page/pageSize: integers.
// basePath: the request path with no query string (e.g. "/api/v1/installations"). query: the
// validated query object, used only to reconstruct the other query parameters in `links`.
async function paginate({ Model, filter, sort, page, pageSize, basePath, query }) {
  assertPageParams(page, pageSize);

  const skip = (page - 1) * pageSize;
  const [data, total] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(pageSize),
    Model.countDocuments(filter),
  ]);

  // Convention (documented, not mandated by the spec): an empty collection reports
  // total_pages = 0 rather than 1, since there are no pages of results to count.
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);

  return {
    data,
    pagination: { total, page, page_size: pageSize, total_pages: totalPages },
    links: buildLinks(basePath, query, page, pageSize, totalPages),
  };
}

module.exports = { paginate, MAX_PAGE_SIZE };
