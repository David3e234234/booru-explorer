import crypto from 'crypto';
import { SECRET_SETTING_FIELDS } from '../config/constants.js';

export const AUTH_CACHE_FIELDS = [
  'blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags',
  'aiTags', 'prioritizeUserTags', 'deepFetchPages', 'hideFurry', 'hidePregnant',
  'hideLgbt', 'hideZipPosts', 'groupAlbums', 'customSources', 'customAliases',
  'enablePaheal', 'siteSortTags', 'kemonoService', 'pawchiveService',
  'rule34ApiKey', 'rule34UserId', 'gelbooruApiKey', 'gelbooruUserId',
  'danbooruApiKey', 'danbooruLogin', 'konachanLogin', 'konachanPassword',
  'yandereLogin', 'yanderePassword', 'pawchiveSession', 'kemonoSession',
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
  recommendationMode: new Set(['tags-only', 'off'])
};

const BOOLEAN_FIELDS = [
  'hideFurry', 'hidePregnant', 'hideLgbt', 'hideZipPosts', 'unpackArchivesOnDownload',
  'showVideoStatusBanner', 'videoAutoplayHover', 'videoAutoplayMobile', 'videoAutoplayViewer',
  'enableSimilarPosts', 'videoMutedDefault', 'proxyThumbnails', 'proxyFullImages',
  'proxyVideos', 'proxyDownloads', 'proxyVideoDefault', 'enableJsDemuxing', 'enablePaheal',
  'groupAlbums', 'prioritizeUserTags', 'telegramBackupEnabled', 'enableRecommendations'
];

const INTEGER_RANGES = {
  deepFetchPages: [1, 6],
  maxServerCacheMb: [0, 102400],
  archiveDownloadThreads: [1, 8],
  itemsPerPage: [10, 200]
};

const TAG_LIST_FIELDS = ['blacklist', 'curvyTags', 'petiteTags', 'furryTags', 'pregnantTags', 'lgbtTags', 'aiTags', 'excludedInterestTags'];

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
  return parseClientAuthValue(req?.headers?.['x-booru-auth']);
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
    delete clean.maxServerCacheMb;
    delete clean.telegramBackupEnabled;
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

  if (clean.searchPresets !== undefined) {
    clean.searchPresets = Array.isArray(clean.searchPresets) ? clean.searchPresets.slice(0, 100) : [];
  }

  return clean;
}

export function buildAuthCacheKey(clientAuth, serverSettings) {
  const merged = resolveRequestSettings(serverSettings, clientAuth);
  const canonical = AUTH_CACHE_FIELDS
    .sort()
    .map(field => [field, merged[field] ?? null]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 24);
}
