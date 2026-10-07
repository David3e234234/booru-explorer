// Persisted collections (likes, favorites, dislikes) are never trimmed - every
// entry the user made stays forever. Their cost is therefore a per-record
// question, and a record is a full post copy. Two things dominated it:
//
// - Internal viewer state leaked into storage. A liked post from the viewer
//   carried its whole similar-posts pool (`_similarPosts`, up to ~120 posts)
//   because nothing stripped underscore-prefixed fields on the way in.
// - Redundant URL tiers. `thumbOriginal` was byte-identical to `fileUrl` in
//   278 of 278 cases and `thumbSample` equal to `sampleUrl` in 319 of 320.
//
// An allowlist rather than a denylist is the point: any field added to a post
// later (upstream noise, viewer cache, resolved metadata) stays out of storage
// by default instead of being persisted forever.
const STORED_POST_FIELDS = new Set([
  // Identity and routing
  'id', 'originalId', 'site', 'siteName', 'author', 'assistants',
  // Media and previews
  'fileUrl', 'fileExt', 'previewUrl', 'sampleUrl',
  'thumb180', 'thumb360', 'thumb720', 'thumbSample', 'thumbOriginal',
  'isVideo', 'isGif', 'hasSound', 'duration', 'durationText', 'width', 'height',
  // Taxonomy, drives content filters and recommendations
  'tags', 'tagDetails', 'rating', 'score', 'favCount', 'isAi',
  // Series and albums
  'isAlbum', 'albumCount', 'seriesKey', 'canFetchAlbum',
  'parentId', 'hasChildren', 'poolId',
  // Provenance
  'source', 'postUrl', 'createdAt', 'views', 'viewsText',
  // Text, archives and embeds
  'title', 'content',
  'embedUrl', 'embedSubject', 'embedDescription', 'embed',
  'isArchive', 'archiveUrls', 'archiveNames', 'archiveSizes',
  'inspectedLinks', 'service', 'user',
  // Match metadata for smart search
  'matchPercent', 'matchedTags', 'matchedDetails',
  'visualMatchPercent', 'similarityPercent', 'similarityScore', 'isViewed',
  // Collection timestamps
  'savedAt', 'likedAt', 'dislikedAt', 'favoritedAt'
]);

/**
 * Reduce a post to the fields worth persisting.
 *
 * `rawCompact` opts out of the redundant URL tier elision: the backup builder
 * needs it so an exported document is a faithful, self-contained copy.
 */
export function sanitizeStoredPost(post, { rawCompact = false } = {}) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) return post;

  const clean = {};
  for (const [key, value] of Object.entries(post)) {
    if (!STORED_POST_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }

  if (rawCompact) return clean;

  // Aliases of a tier we already keep.
  // `thumbOriginal` is dropped only when byte-identical to `fileUrl`, so the
  // viewer's video-extension check keeps deciding identically either way.
  // `thumbSample` is dropped only when `thumb720` exists, since it is still
  // the chosen card preview when there is no higher tier.
  if (clean.fileUrl && clean.thumbOriginal === clean.fileUrl) {
    delete clean.thumbOriginal;
  }
  if (clean.sampleUrl && clean.thumbSample === clean.sampleUrl && clean.thumb720) {
    delete clean.thumbSample;
  }

  return clean;
}

/**
 * Shrink a single record without re-deriving which fields matter.
 *
 * Used to compact collections written before the allowlist existed. Internal
 * state and heavy derived payloads are dropped; public fields are preserved
 * as-is, so nothing a renderer reads disappears.
 */
export function compactStoredPost(post) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) return post;

  const clean = {};
  for (const [key, value] of Object.entries(post)) {
    if (key.startsWith('_')) continue;
    if (key === 'albumItems' || key === 'allSeriesKeys') continue;
    if (value === undefined) continue;
    clean[key] = value;
  }

  if (clean.fileUrl && clean.thumbOriginal === clean.fileUrl) {
    delete clean.thumbOriginal;
  }
  if (clean.sampleUrl && clean.thumbSample === clean.sampleUrl && clean.thumb720) {
    delete clean.thumbSample;
  }

  return clean;
}