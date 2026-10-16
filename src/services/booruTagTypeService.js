import fs from 'fs';
import path from 'path';
import { fetchSafe, discardResponse, safeJsonParse } from '../utils/network.js';
import { getSettings } from './storageService.js';
import { CACHE_DIR } from '../config/constants.js';

/**
 * Ground-truth tag categories read from the booru that owns the tags.
 *
 * `tagClassifier.js` classifies Gelbooru/Rule34 tags through a Konachan
 * summary dictionary (Moebooru/Danbooru 1.x naming). That vocabulary belongs
 * to a different booru genealogy, so the real artist tags of these boards are
 * mostly absent from it and the classifier can only guess. Both boards publish
 * the type of every tag themselves, and this service reads that.
 *
 * Lookups go through a per-site cache so a 40-card gallery does not mean
 * 40 x N upstream calls. Every request goes through `fetchSafe()`.
 */

const TAG_TYPE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DISK_CACHE_VERSION = 1;
const MAX_DISK_ENTRIES = 200000;
const MAX_PARALLEL_LOOKUPS = 4;

// Boorus whose own tag API is authoritative for the artist category.
const SUPPORTED_SITES = new Set(['gelbooru', 'rule34', 'paheal']);

/** Canonical categories shared with `classifyPostTags()`. */
export const TAG_TYPE = {
  GENERAL: 0,
  ARTIST: 1,
  COPYRIGHT: 3,
  CHARACTER: 4,
  META: 5
};

// Raw numbers differ per board: Gelbooru uses 5 for metatags, while Rule34
// (e621 lineage) uses 5 for "invalid" and 6 for metatags.
const RAW_TYPE_MAP = {
  gelbooru: { 0: 0, 1: 1, 3: 3, 4: 4, 5: 5, 6: 3 },
  rule34: { 0: 0, 1: 1, 3: 3, 4: 4, 6: 5, 9: 3 },
  paheal: { 0: 0, 1: 1, 3: 3, 4: 4, 6: 5, 9: 3 }
};

function normalizeSite(site) {
  const s = String(site || '').toLowerCase();
  return SUPPORTED_SITES.has(s) ? s : '';
}

export function normalizeBooruTagType(site, rawType) {
  const normalizedSite = normalizeSite(site);
  if (!normalizedSite) return null;
  const map = RAW_TYPE_MAP[normalizedSite];
  const num = parseInt(rawType, 10);
  if (Number.isNaN(num)) return null;
  const canonical = map[num];
  // "invalid" and unknown codes carry no signal: report the tag as unknown so
  // the caller keeps its own heuristic instead of being actively misled.
  return canonical === undefined ? null : canonical;
}

function cacheFileFor(site) {
  return path.join(CACHE_DIR, `booru_tag_types_${site}.json`);
}

// site -> Map<lowercased tag, { type: number, at: number }>
const memoryCache = new Map();
const inflight = new Map();
const dirtySites = new Set();
let saveTimer = null;

function getMemoryMap(site) {
  if (!memoryCache.has(site)) memoryCache.set(site, new Map());
  return memoryCache.get(site);
}

function loadDiskCache(site) {
  if (memoryCache.has(site)) return getMemoryMap(site);
  const map = new Map();
  try {
    const file = cacheFileFor(site);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.version === DISK_CACHE_VERSION && Array.isArray(parsed.entries)) {
        const now = Date.now();
        for (const [tag, entry] of parsed.entries) {
          if (!Array.isArray(entry)) continue;
          const [type, at] = entry;
          if (typeof tag !== 'string' || !Number.isFinite(at)) continue;
          if (now - at > TAG_TYPE_TTL_MS) continue;
          map.set(tag, { type, at });
        }
      }
    }
  } catch {
    // A corrupt cache must never break a search: start empty and refill.
  }
  memoryCache.set(site, map);
  return map;
}

function scheduleDiskSave(site) {
  dirtySites.add(site);
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const sites = Array.from(dirtySites);
    dirtySites.clear();
    for (const s of sites) {
      const map = memoryCache.get(s);
      if (!map || map.size === 0) continue;
      try {
        const entries = Array.from(map.entries())
          .slice(0, MAX_DISK_ENTRIES)
          .map(([tag, v]) => [tag, [v.type, v.at]]);
        if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
        await fs.promises.writeFile(
          cacheFileFor(s),
          JSON.stringify({ version: DISK_CACHE_VERSION, entries }),
          'utf8'
        );
      } catch {
        // Cache persistence is best-effort; losing it only costs extra lookups.
      }
    }
  }, 5000);
  if (typeof saveTimer.unref === 'function') saveTimer.unref();
}

export function setCachedTagType(site, tag, type) {
  const normalizedSite = normalizeSite(site);
  if (!normalizedSite || !tag || type === null || type === undefined) return;
  const canonical = typeof type === 'number' ? type : normalizeBooruTagType(normalizedSite, type);
  if (canonical === null || canonical === undefined) return;
  const map = loadDiskCache(normalizedSite);
  const low = String(tag).toLowerCase().trim();
  map.set(low, { type: canonical, at: Date.now() });
  scheduleDiskSave(normalizedSite);
}

export function getCachedTagType(site, tag) {
  const normalizedSite = normalizeSite(site);
  if (!normalizedSite || !tag) return null;
  const entry = getMemoryMap(normalizedSite).get(String(tag).toLowerCase());
  return entry ? entry.type : null;
}

export function getBooruTagCacheSize(site) {
  const normalizedSite = normalizeSite(site);
  return normalizedSite ? getMemoryMap(normalizedSite).size : 0;
}

let activeLookups = 0;
const lookupQueue = [];

function acquireSlot() {
  if (activeLookups < MAX_PARALLEL_LOOKUPS) {
    activeLookups++;
    return Promise.resolve();
  }
  return new Promise(resolve => lookupQueue.push(resolve));
}

function releaseSlot() {
  activeLookups--;
  const next = lookupQueue.shift();
  if (next) {
    activeLookups++;
    next();
  }
}

function buildTagApiUrl(site, tag, effectiveSettings) {
  const name = encodeURIComponent(tag);
  if (site === 'gelbooru') {
    const key = effectiveSettings?.gelbooruApiKey;
    const uid = effectiveSettings?.gelbooruUserId;
    const creds = key && uid ? `&api_key=${encodeURIComponent(key)}&user_id=${encodeURIComponent(uid)}` : '';
    return {
      url: `https://gelbooru.com/index.php?page=dapi&s=tag&q=index&name=${name}${creds}`,
      referer: 'https://gelbooru.com/'
    };
  }
  const key = effectiveSettings?.rule34ApiKey;
  const uid = effectiveSettings?.rule34UserId;
  const creds = key && uid ? `&api_key=${encodeURIComponent(key)}&user_id=${encodeURIComponent(uid)}` : '';
  const host = site === 'paheal' ? 'https://rule34.paheal.net' : 'https://api.rule34.xxx';
  return {
    url: `${host}/index.php?page=dapi&s=tag&q=index&name=${name}${creds}`,
    referer: site === 'paheal' ? 'https://rule34.paheal.net/' : 'https://rule34.xxx/'
  };
}

async function fetchTagTypeOnce(site, tag, effectiveSettings) {
  await acquireSlot();
  try {
    const { url, referer } = buildTagApiUrl(site, tag, effectiveSettings);
    const res = await fetchSafe(url, {
      headers: { Referer: referer },
      timeout: 6000,
      settings: effectiveSettings,
      site
    }).catch(() => null);

    let resolvedType = null;
    let resolvedName = String(tag).toLowerCase();

    if (res && res.ok) {
      const text = await res.text();
      // 1. Both boards answer the tag DAPI with a single <tag .../> element.
      const m = text.match(/<tag\s+([^>]*?)\/?>/i);
      if (m) {
        const typeM = m[1].match(/type="(\d+)"/i);
        const nameM = m[1].match(/name="([^"]+)"/i);
        if (typeM) {
          resolvedType = normalizeBooruTagType(site, typeM[1]);
          if (nameM && nameM[1]) resolvedName = nameM[1].toLowerCase();
        }
      } else {
        // Check if DAPI answered with JSON
        const data = safeJsonParse(text, null);
        if (data) {
          const item = Array.isArray(data) ? data[0] : (data?.tag?.[0] || data?.tag || null);
          if (item && (item.type !== undefined || item.category !== undefined)) {
            resolvedType = normalizeBooruTagType(site, item.type ?? item.category);
            if (item.name) resolvedName = String(item.name).toLowerCase();
          }
        }
      }
    } else if (res) {
      await discardResponse(res);
    }

    // 2. Zero-credential public autocomplete fallback for Gelbooru
    if (resolvedType === null && site === 'gelbooru') {
      try {
        const autoUrl = `https://gelbooru.com/index.php?page=autocomplete2&term=${encodeURIComponent(tag.toLowerCase())}&type=tag_query&limit=5`;
        const autoRes = await fetchSafe(autoUrl, {
          headers: { Referer: 'https://gelbooru.com/' },
          timeout: 4000,
          settings: effectiveSettings,
          site: 'gelbooru'
        }).catch(() => null);

        if (autoRes && autoRes.ok) {
          const autoData = await autoRes.json().catch(() => null);
          if (Array.isArray(autoData)) {
            const cleanTarget = tag.toLowerCase().trim();
            const match = autoData.find(item => {
              const val = String(item.value || item.label || '').toLowerCase().trim();
              return val === cleanTarget || val.replace(/_/g, ' ') === cleanTarget.replace(/_/g, ' ');
            });
            if (match && match.category) {
              const catLow = String(match.category).toLowerCase();
              if (catLow === 'artist' || catLow === '1') resolvedType = TAG_TYPE.ARTIST;
              else if (catLow === 'character' || catLow === '4') resolvedType = TAG_TYPE.CHARACTER;
              else if (catLow === 'copyright' || catLow === '3') resolvedType = TAG_TYPE.COPYRIGHT;
              else if (catLow === 'metadata' || catLow === 'meta' || catLow === '5' || catLow === '6') resolvedType = TAG_TYPE.META;
              else if (catLow === 'general' || catLow === '0' || catLow === 'tag') resolvedType = TAG_TYPE.GENERAL;
              if (match.value) resolvedName = String(match.value).toLowerCase();
            }
          }
        } else if (autoRes) {
          await discardResponse(autoRes);
        }
      } catch {}
    }

    if (resolvedType === null) return null;

    const map = getMemoryMap(site);
    map.set(resolvedName, { type: resolvedType, at: Date.now() });
    scheduleDiskSave(site);
    return { tag: resolvedName, type: resolvedType };
  } catch {
    return null;
  } finally {
    releaseSlot();
  }
}

/**
 * Resolves the authoritative category of each candidate tag for a booru.
 * Unresolvable tags are simply absent from the returned map, which leaves the
 * caller's own heuristics in charge of exactly those tags.
 *
 * @param {string} site - 'gelbooru' | 'rule34' | 'paheal'
 * @param {string[]} tags - Raw tag names
 * @param {object} settings - Request settings
 * @returns {Promise<Map<string, number>>} lowercased tag -> canonical type
 */
export async function resolveBooruTagTypes(site, tags = [], settings = {}) {
  const normalizedSite = normalizeSite(site);
  const resolved = new Map();
  if (!normalizedSite || !Array.isArray(tags) || tags.length === 0) return resolved;

  const map = loadDiskCache(normalizedSite);
  const now = Date.now();
  const effectiveSettings = { ...(getSettings ? getSettings() : {}), ...(settings || {}) };

  const pending = [];
  const seen = new Set();
  for (const raw of tags) {
    if (!raw || typeof raw !== 'string') continue;
    const low = raw.toLowerCase();
    if (!low || seen.has(low)) continue;
    seen.add(low);

    const entry = map.get(low);
    if (entry) {
      if (now - entry.at <= TAG_TYPE_TTL_MS) {
        resolved.set(low, entry.type);
        continue;
      }
      map.delete(low);
    }
    pending.push(raw);
  }

  if (pending.length === 0) return resolved;

  const results = await Promise.allSettled(
    pending.map(async tag => {
      const key = `${normalizedSite}:${tag.toLowerCase()}`;
      if (inflight.has(key)) return inflight.get(key);
      const promise = fetchTagTypeOnce(normalizedSite, tag, effectiveSettings);
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        inflight.delete(key);
      }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      resolved.set(r.value.tag, r.value.type);
    }
  }

  return resolved;
}

/** Test seam: drops the in-memory and on-disk tag type caches. */
export function clearBooruTagTypeCache() {
  memoryCache.clear();
  inflight.clear();
  for (const site of SUPPORTED_SITES) {
    try {
      const file = cacheFileFor(site);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      // Ignore: the cache is disposable.
    }
  }
}

/**
 * Resolves the author name from the user's search query tags for a specific site.
 * Supports explicit prefixes (artist:x, author:x, creator:x, by_x) as well as bare artist tags
 * (e.g. "xaea_xp") by consulting in-memory and disk cached booru tag types.
 * Does NOT perform network calls during search feeds to adhere to AGENTS.md rule 129.
 *
 * @param {string} site - 'gelbooru' | 'rule34' | 'paheal'
 * @param {string} searchTagsStr - User search tags string
 * @returns {string} Author name, or empty string
 */
export function resolveSearchAuthor(site, searchTagsStr = '') {
  const normalizedSite = normalizeSite(site);
  if (!searchTagsStr || typeof searchTagsStr !== 'string') return '';
  const tokens = searchTagsStr.split(/\s+/).map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0) return '';

  for (const tok of tokens) {
    const lower = tok.toLowerCase();
    if (lower.startsWith('artist:') || lower.startsWith('author:') || lower.startsWith('creator:')) {
      return tok.replace(/^(artist|author|creator):/i, '').trim();
    }
    if (lower.startsWith('by_') && lower.length > 3) {
      return tok.slice(3).trim();
    }
    // Skip operational / meta search tokens
    if (lower.includes(':') || lower.startsWith('-') || lower.startsWith('~')) continue;
    // Check if tag is known artist in memory or disk cache
    if (normalizedSite) {
      const cached = getCachedTagType(normalizedSite, lower);
      if (cached === TAG_TYPE.ARTIST) {
        return tok;
      }
    }
  }

  return '';
}

