import fs from 'fs';
import path from 'path';
import { CACHE_DIR } from '../config/constants.js';
import { fetchSafe, safeJsonParse, discardResponse } from '../utils/network.js';

/**
 * Danbooru's real tag budget per account level.
 *
 * `PostQuery#term_count` counts tag names and wildcards only: every metatag in
 * `PostQuery::UNLIMITED_METATAGS` (rating, order, score, id, date, parent, ...)
 * is free. The budget itself is 2 for anonymous callers, 3 for members and
 * unlimited from Gold upward (since 2026-11-10 Gold no longer has a 6-tag cap).
 *
 * Sending one tag over budget is a 422, and a 422 means an empty gallery. That
 * makes the budget part of the request contract, not a cosmetic detail: the
 * query builder has to spend the slots on the tags the user typed and never on
 * a metatag.
 */

export const DANBOORU_ANONYMOUS_TAG_LIMIT = 2;
export const DANBOORU_MEMBER_TAG_LIMIT = 3;

// Mirrors PostQuery::UNLIMITED_METATAGS: these terms do not consume the
// account's tag budget. `order:` is **not** in that list — the live API answers
// 422 for `solo 1girl order:score` — so a sort directive still costs a slot and
// must never displace a tag the user typed.
const FREE_METATAGS = new Set([
  'status', 'rating', 'limit', 'is', 'id', 'date', 'age', 'filesize',
  'filetype', 'parent', 'child', 'md5', 'width', 'height', 'duration',
  'mpixels', 'ratio', 'score', 'upvote', 'downvotes', 'favcount', 'embedded',
  'tagcount', 'pixiv_id', 'pixiv'
]);

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAILED_LOOKUP_RETRY_MS = 10 * 60 * 1000;
const DISK_CACHE_VERSION = 1;
const MAX_DISK_ENTRIES = 500;
const CACHE_FILE = path.join(CACHE_DIR, 'danbooru_tag_limits.json');

/** True when a query token does not count against the Danbooru tag budget. */
export function isFreeDanbooruMetatag(token) {
  const raw = String(token || '').trim().replace(/^[-~]/, '');
  if (!raw) return false;
  const colon = raw.indexOf(':');
  if (colon === -1) return false;
  return FREE_METATAGS.has(raw.slice(0, colon).toLowerCase());
}

// lowercased login -> { limit: number | Infinity, at: number }
const limitCache = new Map();
const inflight = new Map();
// login -> timestamp of the last unusable profile answer
const failedLookups = new Map();
let diskLoaded = false;
let saveTimer = null;
let cacheDirty = false;

function loadDiskCache() {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    if (!fs.existsSync(CACHE_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (!parsed || parsed.version !== DISK_CACHE_VERSION || typeof parsed.entries !== 'object') return;
    const now = Date.now();
    for (const [login, entry] of Object.entries(parsed.entries)) {
      if (!entry || typeof entry !== 'object') continue;
      const at = Number(entry.at);
      if (!Number.isFinite(at) || now - at > CACHE_TTL_MS) continue;
      const limit = entry.unlimited === true
        ? Number.POSITIVE_INFINITY
        : Number(entry.limit);
      if (limit !== Number.POSITIVE_INFINITY && (!Number.isFinite(limit) || limit < 1)) continue;
      limitCache.set(login, { limit, at });
    }
  } catch {
    // A corrupt cache only costs one extra profile lookup.
  }
}

function scheduleDiskSave() {
  cacheDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!cacheDirty) return;
    cacheDirty = false;
    try {
      const entries = {};
      for (const [login, entry] of limitCache) {
        entries[login] = entry.limit === Number.POSITIVE_INFINITY
          ? { unlimited: true, at: entry.at }
          : { limit: entry.limit, at: entry.at };
      }
      // Keep the newest answers when the cache outgrows its bound.
      const keys = Object.keys(entries);
      if (keys.length > MAX_DISK_ENTRIES) {
        keys
          .sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0))
          .slice(0, keys.length - MAX_DISK_ENTRIES)
          .forEach(key => { delete entries[key]; });
      }
      if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.promises
        .writeFile(CACHE_FILE, JSON.stringify({ version: DISK_CACHE_VERSION, entries }), 'utf8')
        .catch(() => {});
    } catch {
      // Cache persistence is best-effort.
    }
  }, 5000);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

/** Cached budget for a login, or null when it has never been resolved. */
export function getCachedDanbooruTagLimit(login) {
  const key = normalizeLogin(login);
  if (!key) return null;
  loadDiskCache();
  const entry = limitCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    limitCache.delete(key);
    scheduleDiskSave();
    return null;
  }
  return entry.limit;
}

/**
 * Stores a budget reported by Danbooru. `rawLimit` is the `tag_query_limit`
 * field of `/profile.json`: a finite number for member accounts, and `null`
 * (ActiveSupport serializes Float::INFINITY that way) once the level is Gold
 * or above.
 */
export function rememberDanbooruTagLimit(login, rawLimit) {
  const key = normalizeLogin(login);
  if (!key) return;
  let limit;
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit) && rawLimit >= 1) {
    limit = Math.floor(rawLimit);
  } else if (rawLimit === null) {
    limit = Number.POSITIVE_INFINITY;
  } else if (typeof rawLimit === 'string' && /^infinity$/i.test(rawLimit.trim())) {
    limit = Number.POSITIVE_INFINITY;
  } else {
    // Absent or unusable answer: keep whatever we already had.
    return;
  }
  loadDiskCache();
  limitCache.set(key, { limit, at: Date.now() });
  scheduleDiskSave();
}

/**
 * Budget for the credentials currently in use.
 *
 * Anonymous callers get 2. With credentials the answer is 3 until the account's
 * real limit is known: 3 is the member budget, so it can never produce a 422 for
 * any registered level, and Gold accounts simply get a slightly narrower query
 * for one round before the background lookup stores "unlimited".
 */
export function getDanbooruQueryTagCap(settings = {}) {
  const login = String(settings?.danbooruLogin || '').trim();
  const apiKey = String(settings?.danbooruApiKey || '').trim();
  if (!login || !apiKey) return DANBOORU_ANONYMOUS_TAG_LIMIT;

  const cached = getCachedDanbooruTagLimit(login);
  if (cached !== null) return cached;

  warmDanbooruTagLimit(login, apiKey, settings);
  return DANBOORU_MEMBER_TAG_LIMIT;
}

/**
 * Learns the account's budget in the background. Search never waits for it: a
 * missing answer only means one round with the conservative member budget.
 * A failed lookup is remembered briefly so an invalid key does not add a
 * profile request to every single search.
 */
export function warmDanbooruTagLimit(login, apiKey, settings = {}) {
  const key = normalizeLogin(login);
  if (!key || !apiKey) return;
  if (inflight.has(key)) return;
  const failedAt = failedLookups.get(key);
  if (failedAt && Date.now() - failedAt < FAILED_LOOKUP_RETRY_MS) return;
  const task = fetchTagLimitOnce(login, apiKey, settings)
    .then(result => {
      if (result === null) failedLookups.set(key, Date.now());
      else failedLookups.delete(key);
      return result;
    })
    .catch(() => {
      failedLookups.set(key, Date.now());
      return null;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, task);
}

async function fetchTagLimitOnce(login, apiKey, settings) {
  const url = 'https://danbooru.donmai.us/profile.json'
    + `?login=${encodeURIComponent(login)}&api_key=${encodeURIComponent(apiKey)}`;
  let res;
  try {
    res = await fetchSafe(url, { timeout: 8000, settings, site: 'danbooru' });
  } catch {
    return null;
  }
  if (!res.ok) {
    await discardResponse(res);
    return null;
  }
  const data = safeJsonParse(await res.text(), null);
  if (!data || typeof data !== 'object') return null;
  // Only the account's own profile exposes `tag_query_limit`. A missing key
  // means the answer is unusable, which keeps the conservative default.
  if (!Object.prototype.hasOwnProperty.call(data, 'tag_query_limit')) return null;
  rememberDanbooruTagLimit(login, data.tag_query_limit);
  return getCachedDanbooruTagLimit(login);
}

/** Resolves the budget synchronously for callers that already know the answer. */
export function setDanbooruTagLimitForTests(login, limit) {
  const key = normalizeLogin(login);
  if (!key) return;
  loadDiskCache();
  limitCache.set(key, { limit, at: Date.now() });
}

/** Test seam: drops the in-memory and on-disk budget cache. */
export function clearDanbooruTagLimitCache() {
  limitCache.clear();
  inflight.clear();
  failedLookups.clear();
  diskLoaded = true;
  cacheDirty = false;
  try {
    if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
  } catch {
    // The cache is disposable.
  }
}
