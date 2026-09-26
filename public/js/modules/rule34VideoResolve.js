/**
 * Single entrypoint for `GET /api/resolve-video` on Rule34Video.
 *
 * The gallery resolves every card without an author and the viewer resolves the
 * same post again when it opens, so the endpoint was hit two to thirty times per
 * page. That is enough to exhaust the per-IP rate limit, and a 429 leaves the
 * viewer without a full stream. Requests are therefore deduplicated per post and
 * successful answers are reused, which also makes opening a post instant when the
 * card was already resolved.
 */
import { getAuthHeaders } from '../api.js';

const CACHE_MAX = 120;
const resolvedCache = new Map();
const inflight = new Map();

function cacheKey(post) {
  // Keyed on the post alone: the preferred author only reorders the model list on
  // the board, it never changes the resolved stream, so a card resolved by the
  // gallery must satisfy the viewer too.
  return String(post?.originalId || post?.id || '');
}

function remember(key, data) {
  if (resolvedCache.size >= CACHE_MAX && !resolvedCache.has(key)) {
    resolvedCache.delete(resolvedCache.keys().next().value);
  }
  resolvedCache.set(key, data);
}

/** Cached answer for a post, or null when it still has to be requested. */
export function getCachedRule34VideoMedia(post) {
  const key = cacheKey(post);
  return resolvedCache.get(key) || null;
}

/** Forgets a cached answer so the next call re-requests the post. */
export function invalidateRule34VideoMedia(post) {
  resolvedCache.delete(cacheKey(post));
}

function buildRequestUrl(post) {
  const params = new URLSearchParams();
  params.set('id', post.originalId || post.id || '');
  params.set('url', post.source || post.postUrl || '');
  params.set('site', 'rule34video');
  if (post.author) params.set('author', post.author);
  return `/api/resolve-video?${params.toString()}`;
}

/**
 * Resolves full media plus metadata for a Rule34Video post.
 * Resolves to `null` on any failure so callers can show a retry affordance;
 * failures are never cached, only successful answers are.
 *
 * @param {Object} post
 * @param {{ force?: boolean }} [options] `force` skips the cache and re-requests.
 * @returns {Promise<Object|null>}
 */
export function resolveRule34VideoMedia(post, options = {}) {
  if (!post || post.site !== 'rule34video') return Promise.resolve(null);

  const key = cacheKey(post);
  if (!options.force) {
    const cached = resolvedCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending;
  }

  const request = fetch(buildRequestUrl(post), { headers: getAuthHeaders() })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.success !== false) remember(key, data);
      return data && data.success !== false ? data : null;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });

  inflight.set(key, request);
  return request;
}
