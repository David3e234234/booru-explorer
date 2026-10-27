import crypto from 'crypto';
import { SECRET_SETTING_FIELDS } from '../config/constants.js';
import { isSafeExternalUrl, normalizeProxyUrl } from './network.js';

export const AUTH_CACHE_FIELDS = [
  'blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags',
  'aiTags', 'prioritizeUserTags', 'deepFetchPages', 'hideFurry', 'hidePregnant',
  'hideLgbt', 'hideZipPosts', 'groupAlbums', 'customSources', 'customAliases',
  'enableAliasDiscovery', 'ignoredAliases',
  'rule34Provider', 'enablePaheal', 'siteSortTags', 'kemonoService', 'pawchiveService',
  'rule34ApiKey', 'rule34UserId', 'gelbooruApiKey', 'gelbooruUserId',
  'danbooruApiKey', 'danbooruLogin', 'konachanLogin', 'konachanPassword',
  'yandereLogin', 'yanderePassword',
  'pawchiveSession',
  'kemonoSession',
  'globalProxy', 'danbooruProxy', 'gelbooruProxy', 'rule34Proxy',
  'yandereProxy', 'konachanProxy', 'safebooruProxy', 'rule34videoProxy',
  'xbooruProxy', 'hypnohubProxy', 'tbibProxy', 'pawchiveProxy', 'kemonoProxy'
];

const STRING_ENUMS = {
  theme: new Set(['kotobox', 'tokyo-night', 'warm-paper']),
  aiFilter: new Set(['all', 'no-ai', 'only-ai']),
  ratingFilter: new Set(['all', 'nsfw', 'questionable', 'sfw']),
  typeFilter: new Set(['all', 'image', 'video', 'audio', 'zip']),
  ageFilter: new Set(['all', 'adult', 'young']),
  previewQuality: new Set(['low', 'medium', 'high', 'original']),
  telegramBackupInterval: new Set(['daily', 'every_3_days', 'weekly']),
  recommendationMode: new Set(['tags-only', 'off']),
  rule34Provider: new Set(['rule34xxx', 'paheal'])
};

const BOOLEAN_FIELDS = [
  'hideFurry', 'hidePregnant', 'hideLgbt', 'hideZipPosts', 'unpackArchivesOnDownload',
  'showVideoStatusBanner', 'videoAutoplayHover', 'videoAutoplayMobile', 'videoAutoplayViewer',
  'enableSimilarPosts', 'videoMutedDefault', 'proxyThumbnails', 'proxyFullImages',
  'proxyVideos', 'proxyDownloads', 'proxyVideoDefault', 'enableJsDemuxing', 'enablePaheal',
  'groupAlbums', 'prioritizeUserTags', 'telegramBackupEnabled', 'enableRecommendations',
  'enableAliasDiscovery'
];

const INTEGER_RANGES = {
  deepFetchPages: [1, 6],
  maxServerCacheMb: [0, 102400],
  archiveDownloadThreads: [1, 8],
  itemsPerPage: [10, 200]
};

const TAG_LIST_FIELDS = ['blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags', 'aiTags', 'excludedInterestTags', 'ignoredAliases'];

const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks:', 'socks4:', 'socks5:', 'socks5h:']);

// Proxy support includes SOCKS, which isSafeExternalUrl() rejects because it only
// accepts http(s) targets. Check the proxy's own host with the same literal guard
// instead, so a public SOCKS relay stays usable and a private one does not.
function isPublicProxyUrl(rawValue) {
  let parsed;
  try {
    parsed = new URL(normalizeProxyUrl(rawValue));
  } catch {
    return false;
  }
  if (!PROXY_PROTOCOLS.has(parsed.protocol)) return false;
  if (!parsed.hostname) return false;
  return isSafeExternalUrl(`http://${parsed.host}/`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value, maxItems = 500) {
  if (!Array.isArray(value)) return null;
  const normalized = value
    .filter(item => typeof item === 'string')
    .map(item => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, maxItems);
  return normalized;
}

export function parseClientAuthValue(rawValue) {
  if (Array.isArray(rawValue)) return {};
  if (typeof rawValue !== 'string' || !rawValue) return {};
  let parsed;
  try {
    parsed = JSON.parse(decodeURIComponent(rawValue));
  } catch {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return {};
    }
  }
  return isPlainObject(parsed) ? parsed : {};
}

export function parseRequestAuth(req) {
  const parsed = parseClientAuthValue(req?.headers?.['x-booru-auth']);
  // Request-scoped settings come from an untrusted header. Normalizing them here
  // keeps a caller from raising server budgets (deep fetch, archive threads) or
  // sending malformed list fields into every route that merges this object.
  const clean = sanitizeSettingsPatch(parsed);

  // A request may carry the caller's own proxy, which every outbound fetch would
  // connect through. Private and loopback proxy hosts are an SSRF bypass around
  // isSafeExternalUrl, so a header-supplied proxy must be public. An operator's
  // stored global proxy stays trusted and is resolved from settings instead.
  for (const field of Object.keys(clean)) {
    if (field === 'siteMediaProxy') continue;
    if (field !== 'globalProxy' && !field.endsWith('Proxy')) continue;
    if (typeof clean[field] !== 'string' || !clean[field].trim()) {
      delete clean[field];
      continue;
    }
    if (!isPublicProxyUrl(clean[field])) delete clean[field];
  }

  return clean;
}

export function resolveRequestSettings(baseSettings, clientAuth) {
  return isPlainObject(clientAuth) ? { ...(baseSettings || {}), ...clientAuth } : { ...(baseSettings || {}) };
}

export function sanitizeSettingsPatch(input, { anonymous = false } = {}) {
  if (!isPlainObject(input)) return {};
  const clean = { ...input };

  if (anonymous) {
    for (const field of SECRET_SETTING_FIELDS) delete clean[field];
    for (const field of Object.keys(clean)) {
      if (field.endsWith('Proxy')) delete clean[field];
    }
    // Anonymous callers share the root data namespace. Server budgets and shared
    // collections must not be writable through that namespace: a single visitor
    // could otherwise raise the deep-fetch depth or replace every preset.
    delete clean.maxServerCacheMb;
    delete clean.telegramBackupEnabled;
    delete clean.deepFetchPages;
    delete clean.archiveDownloadThreads;
    delete clean.siteMediaProxy;
    delete clean.customAliases;
    delete clean.searchPresets;
  }

  for (const [field, allowed] of Object.entries(STRING_ENUMS)) {
    if (clean[field] !== undefined && !allowed.has(clean[field])) delete clean[field];
  }

  for (const field of BOOLEAN_FIELDS) {
    if (clean[field] !== undefined && typeof clean[field] !== 'boolean') delete clean[field];
  }

  for (const [field, [min, max]] of Object.entries(INTEGER_RANGES)) {
    if (clean[field] === undefined) continue;
    const parsed = Number.parseInt(clean[field], 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) delete clean[field];
    else clean[field] = parsed;
  }

  for (const field of TAG_LIST_FIELDS) {
    if (clean[field] === undefined) continue;
    const list = normalizeStringList(clean[field]);
    if (list) clean[field] = list;
    else delete clean[field];
  }

  if (clean.customSources !== undefined) {
    const sources = normalizeStringList(clean.customSources, 32);
    if (sources) clean.customSources = sources;
    else delete clean.customSources;
  }

  if (clean.customAliases !== undefined) {
    if (!isPlainObject(clean.customAliases)) delete clean.customAliases;
    else {
      const aliases = {};
      for (const [name, target] of Object.entries(clean.customAliases).slice(0, 500)) {
        if (typeof name !== 'string' || typeof target !== 'string') continue;
        aliases[name.trim().slice(0, 100)] = target.trim().slice(0, 300);
      }
      clean.customAliases = aliases;
    }
  }

  if (clean.siteMediaProxy !== undefined) {
    if (!isPlainObject(clean.siteMediaProxy)) delete clean.siteMediaProxy;
    else {
      const allowedModes = new Set(['default', 'server', 'direct']);
      const sanitized = {};
      for (const [siteKey, mode] of Object.entries(clean.siteMediaProxy).slice(0, 50)) {
        if (typeof siteKey !== 'string' || typeof mode !== 'string') continue;
        const cleanSite = siteKey.trim().toLowerCase().slice(0, 40);
        const cleanMode = mode.trim().toLowerCase();
        if (/^[a-z][a-z0-9_-]*$/i.test(cleanSite) && allowedModes.has(cleanMode)) {
          sanitized[cleanSite] = cleanMode;
        }
      }
      clean.siteMediaProxy = sanitized;
    }
  }

  if (clean.searchPresets !== undefined) {
    clean.searchPresets = Array.isArray(clean.searchPresets) ? clean.searchPresets.slice(0, 100) : [];
  }

  return clean;
}

export function buildAuthCacheKey(clientAuth, serverSettings) {
  const merged = resolveRequestSettings(serverSettings, clientAuth);
  const canonical = [...AUTH_CACHE_FIELDS]
    .sort()
    .map(field => [field, merged[field] ?? null]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
}
