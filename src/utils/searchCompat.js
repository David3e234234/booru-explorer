/**
 * Shared search compatibility helpers.
 *
 * Every source used to reimplement its own preview ladder, rating-tag injection
 * and page arithmetic. Small differences in those copies are the reason a tag
 * filter that works on one board silently returns nothing on another. Keeping
 * one implementation here makes the contract explicit and testable.
 */

const RATING_TAGS = {
  danbooru: {
    nsfw: 'rating:e',
    questionable: 'rating:q,s',
    '16+': 'rating:q,s',
    sfw: 'rating:g'
  },
  gelbooru: {
    nsfw: 'rating:explicit',
    questionable: 'rating:questionable',
    '16+': 'rating:questionable',
    sfw: 'rating:general'
  },
  rule34: {
    nsfw: 'rating:explicit',
    questionable: 'rating:questionable',
    '16+': 'rating:questionable',
    sfw: 'rating:safe'
  },
  dapi: {
    nsfw: 'rating:e',
    questionable: 'rating:q',
    '16+': 'rating:q',
    sfw: 'rating:s'
  },
  moebooru: {
    nsfw: 'rating:explicit',
    questionable: 'rating:questionable',
    '16+': 'rating:questionable',
    sfw: 'rating:safe'
  }
};

/**
 * Appends the engine-specific rating tag when the query does not already
 * constrain ratings. A user-supplied `rating:*` always wins.
 */
export function appendRatingTag(tags, ratingFilter, engine) {
  const query = typeof tags === 'string' ? tags.trim() : '';
  if (!ratingFilter || ratingFilter === 'all') return query;
  if (/(^|\s)rating:/.test(query)) return query;
  const tag = RATING_TAGS[engine]?.[ratingFilter];
  if (!tag) return query;
  return query ? `${query} ${tag}` : tag;
}

/**
 * Preview tiers from native board URLs.
 *
 * low    -> small thumbnail
 * medium -> sample/preview, never the full file while a smaller preview exists
 * high   -> sample, falling back to the preview before the original
 *
 * Boards that only expose a thumbnail for a video reuse it for every tier:
 * three quality variants of the same remote video mean three full downloads.
 */
export function buildThumbTiers({ previewUrl, rawSampleUrl, fileUrl, isVideo }) {
  const preview = previewUrl || '';
  const rawSample = rawSampleUrl || '';
  const file = fileUrl || '';

  if (isVideo) {
    const shared = preview || rawSample || file;
    return { thumb180: shared, thumb360: shared, thumb720: shared };
  }

  const small = preview || rawSample || file;
  const medium = (rawSample && rawSample !== file) ? rawSample : (preview || rawSample || file);
  const high = rawSample || file || preview;
  return { thumb180: small, thumb360: medium, thumb720: high };
}

/** Parses a request limit and keeps it inside a source's page ceiling. */
export function clampPageLimit(limit, maxPageSize, fallback = 40) {
  const parsed = Number.parseInt(limit, 10);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(Math.max(1, safe), maxPageSize);
}

/**
 * Offset for APIs that paginate by item count rather than page number.
 * `limit` is the effective page size, so page N continues exactly where page
 * N-1 stopped even when the caller asks for fewer than the API maximum.
 */
export function computePageOffset(page, limit, fallback = 40) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.max(1, Number.parseInt(limit, 10) || fallback);
  return (safePage - 1) * safeLimit;
}
