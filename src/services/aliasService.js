import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR } from '../config/constants.js';
import { fetchSafe, discardResponse } from '../utils/network.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to built-in and dynamically discovered author aliases
const BUILTIN_ALIASES_PATH = path.join(__dirname, '..', 'config', 'authorAliases.json');
const DISCOVERED_ALIASES_FILE = path.join(DATA_DIR, 'discovered_aliases.json');

let builtinAliasList = [];
let builtinAliasMap = new Map();

let discoveredAliasList = [];
let discoveredAliasMap = new Map();

// Avoid repeating network lookups for known or already checked candidates
const CHECKED_CANDIDATES_MAX = 5000;
const checkedCandidates = new Set();
let isSavingDiscovered = false;
let saveTimeout = null;

function loadBuiltinAliases() {
  try {
    if (fs.existsSync(BUILTIN_ALIASES_PATH)) {
      const raw = fs.readFileSync(BUILTIN_ALIASES_PATH, 'utf-8');
      builtinAliasList = JSON.parse(raw);
      rebuildBuiltinMap();
    }
  } catch (err) {
    builtinAliasList = [];
    builtinAliasMap = new Map();
  }
}

function rebuildBuiltinMap() {
  builtinAliasMap = new Map();
  if (!Array.isArray(builtinAliasList)) return;

  for (const entry of builtinAliasList) {
    if (!entry || typeof entry !== 'object') continue;
    const sites = entry.sites || {};
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    
    const allAliases = new Set(aliases.map(a => String(a).trim().toLowerCase()));
    if (entry.id) allAliases.add(String(entry.id).trim().toLowerCase());

    for (const alias of allAliases) {
      if (alias) {
        builtinAliasMap.set(alias, {
          id: entry.id,
          sites
        });
      }
    }
  }
}

function loadDiscoveredAliases() {
  try {
    if (fs.existsSync(DISCOVERED_ALIASES_FILE)) {
      const raw = fs.readFileSync(DISCOVERED_ALIASES_FILE, 'utf-8');
      discoveredAliasList = JSON.parse(raw);
      rebuildDiscoveredMap();
    }
  } catch (err) {
    discoveredAliasList = [];
    discoveredAliasMap = new Map();
  }
}

function rebuildDiscoveredMap() {
  discoveredAliasMap = new Map();
  if (!Array.isArray(discoveredAliasList)) return;

  for (const entry of discoveredAliasList) {
    if (!entry || typeof entry !== 'object') continue;
    const sites = entry.sites || {};
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    
    const allAliases = new Set(aliases.map(a => String(a).trim().toLowerCase()));
    if (entry.id) allAliases.add(String(entry.id).trim().toLowerCase());

    for (const alias of allAliases) {
      if (alias) {
        discoveredAliasMap.set(alias, {
          id: entry.id,
          sites
        });
      }
    }
  }
}

function saveDiscoveredAliasesAsync() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      const dir = path.dirname(DISCOVERED_ALIASES_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await fs.promises.writeFile(DISCOVERED_ALIASES_FILE, JSON.stringify(discoveredAliasList, null, 2), 'utf8');
    } catch (e) {
      logError('AliasService', 'Не удалось сохранить discovered_aliases.json', e);
    }
  }, 400);
}

// Initial load
loadBuiltinAliases();
loadDiscoveredAliases();

/**
 * Clean and normalize potential author handle names.
 */
function cleanAuthorHandle(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw.trim().toLowerCase();
  // Remove trailing emojis or special prefixes like 🔞, @, leading ~, ^.^
  s = s.replace(/[🔞@~^]/g, '').trim();
  s = s.replace(/[\s.-]+/g, '_');
  s = s.replace(/^_+|_+$/g, '');
  if (/^[a-z0-9_]{2,40}$/.test(s)) {
    return s;
  }
  return '';
}

/**
 * Extract handles from artist profile URLs (Twitter/X, Patreon, Pixiv, Iwara, Fanbox).
 */
function extractHandleFromUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);

    // https://x.com/username or https://twitter.com/username
    if (host.includes('twitter.com') || host.includes('x.com')) {
      if (parts[0] && parts[0] !== 'i') return cleanAuthorHandle(parts[0]);
    }
    // https://www.patreon.com/username or https://www.patreon.com/user?u=...
    if (host.includes('patreon.com')) {
      if (parts[0] && parts[0] !== 'user' && parts[0] !== 'posts' && parts[0] !== 'creation') {
        return cleanAuthorHandle(parts[0]);
      }
    }
    // https://username.fanbox.cc or https://www.fanbox.cc/@username
    if (host.includes('fanbox.cc')) {
      const sub = host.split('.')[0];
      if (sub && sub !== 'www' && sub !== 'api') return cleanAuthorHandle(sub);
      if (parts[0] && parts[0].startsWith('@')) return cleanAuthorHandle(parts[0].slice(1));
    }
    // https://fantia.jp/fanclubs/12345
    if (host.includes('fantia.jp') && parts[0] === 'fanclubs' && parts[1]) {
      return cleanAuthorHandle(parts[1]);
    }
    // https://boosty.to/username
    if (host.includes('boosty.to') && parts[0] && !['app', 'feed', 'explore'].includes(parts[0])) {
      return cleanAuthorHandle(parts[0]);
    }
    // https://www.iwara.tv/profile/username
    if (host.includes('iwara.tv') && parts[0] === 'profile' && parts[1]) {
      return cleanAuthorHandle(parts[1]);
    }
    // https://bsky.app/profile/username.bsky.social
    if (host.includes('bsky.app') && parts[0] === 'profile' && parts[1]) {
      const bskyName = parts[1].split('.')[0];
      return cleanAuthorHandle(bskyName);
    }
  } catch {}
  return '';
}

/**
 * Returns all known alias variants for a given name/tag across custom rules, discovered aliases, and built-in aliases.
 * @param {string} rawName
 * @param {Array|string} [customAliases]
 * @returns {string[]}
 */
export function getAllAliasesForName(rawName, customAliases = []) {
  if (!rawName || typeof rawName !== 'string') return [];
  const clean = rawName.trim().toLowerCase().replace(/^(?:artist|author|creator):/i, '');
  if (!clean) return [];

  const result = new Set();
  result.add(clean);

  // 1. Check custom rules
  const rules = parseCustomAliases(customAliases);
  for (const r of rules) {
    if (!r || !Array.isArray(r.aliases)) continue;
    const match = r.aliases.some(a => a.toLowerCase() === clean);
    if (match) {
      r.aliases.forEach(a => result.add(a.toLowerCase()));
      if (r.defaultTarget) result.add(r.defaultTarget.toLowerCase());
      if (r.sites) {
        Object.values(r.sites).forEach(s => s && result.add(String(s).toLowerCase()));
      }
    }
  }

  // 2. Check discovered map
  if (discoveredAliasMap.has(clean)) {
    const entry = discoveredAliasMap.get(clean);
    if (entry.id) result.add(entry.id.toLowerCase());
    if (Array.isArray(entry.aliases)) entry.aliases.forEach(a => result.add(String(a).toLowerCase()));
    if (entry.sites) Object.values(entry.sites).forEach(s => s && result.add(String(s).toLowerCase()));
  }

  // Also scan discoveredAliasList for any entry containing clean
  for (const entry of discoveredAliasList) {
    if (entry.id?.toLowerCase() === clean || entry.aliases?.some(a => a.toLowerCase() === clean)) {
      if (entry.id) result.add(entry.id.toLowerCase());
      if (Array.isArray(entry.aliases)) entry.aliases.forEach(a => result.add(String(a).toLowerCase()));
      if (entry.sites) Object.values(entry.sites).forEach(s => s && result.add(String(s).toLowerCase()));
    }
  }

  // 3. Check built-in map
  if (builtinAliasMap.has(clean)) {
    const entry = builtinAliasMap.get(clean);
    if (entry.id) result.add(entry.id.toLowerCase());
    if (entry.sites) Object.values(entry.sites).forEach(s => s && result.add(String(s).toLowerCase()));
  }

  // Also scan builtinAliasList
  for (const entry of builtinAliasList) {
    if (entry.id?.toLowerCase() === clean || entry.aliases?.some(a => a.toLowerCase() === clean)) {
      if (entry.id) result.add(entry.id.toLowerCase());
      if (Array.isArray(entry.aliases)) entry.aliases.forEach(a => result.add(String(a).toLowerCase()));
      if (entry.sites) Object.values(entry.sites).forEach(s => s && result.add(String(s).toLowerCase()));
    }
  }

  return Array.from(result);
}

/**
 * Asynchronously discovers aliases for an author from Danbooru's artist directory.
 * Non-blocking, saves to local disk cache upon finding alternatives.
 */
export async function discoverAuthorAliases(authorCandidate, settings = {}) {
  if (!authorCandidate || typeof authorCandidate !== 'string') return null;

  const candidate = authorCandidate.toLowerCase().trim();
  if (candidate.length < 3 || candidate.length > 50) return null;
  if (checkedCandidates.has(candidate)) return null;

  if (checkedCandidates.size >= CHECKED_CANDIDATES_MAX) {
    const it = checkedCandidates.values();
    for (let i = 0; i < 1000; i++) {
      const next = it.next();
      if (next.done) break;
      checkedCandidates.delete(next.value);
    }
  }
  checkedCandidates.add(candidate);

  // If already mapped in builtin or discovered, no lookup needed
  if (builtinAliasMap.has(candidate) || discoveredAliasMap.has(candidate)) {
    return null;
  }

  try {
    const danbooruAuth = settings?.danbooruApiKey && settings?.danbooruLogin
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';

    const url = `https://danbooru.donmai.us/artists.json?search[name]=${encodeURIComponent(candidate)}&only=name,other_names,urls${danbooruAuth}`;

    const res = await fetchSafe(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'BooruExp/1.0' },
      settings,
      site: 'danbooru'
    });

    if (!res || !res.ok) {
      if (res) await discardResponse(res);
      return null;
    }

    const data = await res.json().catch(() => []);
    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    const artistObj = data[0];
    if (!artistObj || !artistObj.name) return null;

    const canonicalName = artistObj.name.toLowerCase().trim();
    const aliasSet = new Set();
    aliasSet.add(canonicalName);

    if (Array.isArray(artistObj.other_names)) {
      for (const on of artistObj.other_names) {
        const cleaned = cleanAuthorHandle(on);
        if (cleaned && cleaned.length >= 3) {
          aliasSet.add(cleaned);
        }
      }
    }

    if (Array.isArray(artistObj.urls)) {
      for (const uObj of artistObj.urls) {
        const handle = extractHandleFromUrl(uObj?.url);
        if (handle && handle.length >= 3) {
          aliasSet.add(handle);
        }
      }
    }

    // Only register if we discovered at least one alternative name!
    if (aliasSet.size > 1) {
      const aliases = Array.from(aliasSet);
      
      // Determine site-specific mappings if names follow typical patterns (e.g. name3d vs namesfm)
      const sites = { danbooru: canonicalName };
      const sfmName = aliases.find(a => a.endsWith('sfm'));
      if (sfmName) {
        sites.rule34 = sfmName;
        sites.rule34video = sfmName;
      }

      // Check if entry already exists in discovered list
      const existingIdx = discoveredAliasList.findIndex(e => e.id === canonicalName);
      if (existingIdx >= 0) {
        const existing = discoveredAliasList[existingIdx];
        const mergedAliases = Array.from(new Set([...existing.aliases, ...aliases]));
        discoveredAliasList[existingIdx] = {
          ...existing,
          aliases: mergedAliases,
          sites: { ...existing.sites, ...sites },
          updatedAt: new Date().toISOString()
        };
      } else {
        discoveredAliasList.push({
          id: canonicalName,
          aliases,
          sites,
          discoveredAt: new Date().toISOString()
        });
      }

      rebuildDiscoveredMap();
      saveDiscoveredAliasesAsync();
      logInfo('AliasService', `Автоматически обнаружены алиасы для автора "${canonicalName}": ${aliases.join(', ')}`);
      return { id: canonicalName, aliases, sites };
    }
  } catch (err) {
    logWarn('AliasService', `Ошибка автопоиска алиасов для "${candidate}": ${err.message}`);
  }

  return null;
}

/**
 * Self-learning: automatically correlates author tags across sites when posts share the same source artwork URL.
 */
export function learnAliasesFromPostMatches(posts = []) {
  if (!Array.isArray(posts) || posts.length < 2) return;

  const sourceGroups = new Map();
  for (const post of posts) {
    if (!post || !post.source || !post.author || !post.site) continue;
    try {
      const u = new URL(post.source);
      const host = u.hostname.toLowerCase();
      // Correlate on specific author platforms with distinct work IDs
      if (['twitter.com', 'x.com', 'pixiv.net', 'artstation.com', 'patreon.com', 'fanbox.cc', 'fantia.jp', 'boosty.to', 'subscribestar.adult', 'subscribestar.com'].some(h => host.includes(h))) {
        const normKey = `${host}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
        if (!sourceGroups.has(normKey)) sourceGroups.set(normKey, []);
        sourceGroups.get(normKey).push({ site: post.site, author: post.author.toLowerCase().trim() });
      }
    } catch {}
  }

  let hasNew = false;
  for (const [key, items] of sourceGroups.entries()) {
    if (items.length < 2) continue;
    
    // Check if we have different sites with different author names
    const distinctSites = new Set(items.map(i => i.site));
    const distinctAuthors = new Set(items.map(i => i.author));

    if (distinctSites.size > 1 && distinctAuthors.size > 1) {
      const canonical = items.find(i => i.site === 'danbooru')?.author || Array.from(distinctAuthors)[0];
      const sitesMap = {};
      for (const item of items) {
        if (item.author) sitesMap[item.site] = item.author;
      }

      const aliasArray = Array.from(distinctAuthors);
      const existingIdx = discoveredAliasList.findIndex(e => e.id === canonical || e.aliases?.some(a => distinctAuthors.has(a)));

      if (existingIdx >= 0) {
        const existing = discoveredAliasList[existingIdx];
        const mergedAliases = Array.from(new Set([...existing.aliases, ...aliasArray]));
        const mergedSites = { ...existing.sites, ...sitesMap };
        if (mergedAliases.length > existing.aliases.length || Object.keys(mergedSites).length > Object.keys(existing.sites).length) {
          discoveredAliasList[existingIdx] = {
            ...existing,
            aliases: mergedAliases,
            sites: mergedSites,
            updatedAt: new Date().toISOString()
          };
          hasNew = true;
        }
      } else {
        discoveredAliasList.push({
          id: canonical,
          aliases: aliasArray,
          sites: sitesMap,
          learnedFromSource: true,
          discoveredAt: new Date().toISOString()
        });
        hasNew = true;
      }
    }
  }

  if (hasNew) {
    rebuildDiscoveredMap();
    saveDiscoveredAliasesAsync();
    logInfo('AliasService', `База алиасов пополнена на основе совпадения источников (${discoveredAliasList.length} авторов в кэше)`);
  }
}

/**
 * Parse user custom alias rules from text or array into a normalized structure.
 */
export function parseCustomAliases(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;

  const lines = String(input).split(/\r?\n/);
  const rules = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    if (line.includes('=')) {
      const [leftSide, rightSide] = line.split('=').map(s => s.trim());
      if (!leftSide || !rightSide) continue;

      const inputAliases = leftSide.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      const rightParts = rightSide.split(',').map(s => s.trim()).filter(Boolean);
      const sitesMap = {};
      let defaultTarget = null;

      for (const part of rightParts) {
        if (part.includes(':')) {
          const [sName, sTag] = part.split(':').map(x => x.trim());
          if (sName && sTag) {
            sitesMap[sName.toLowerCase()] = sTag;
          }
        } else {
          if (!defaultTarget) defaultTarget = part;
        }
      }

      rules.push({
        aliases: inputAliases,
        sites: sitesMap,
        defaultTarget
      });
    } else if (line.includes(',')) {
      const group = line.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if (group.length > 1) {
        rules.push({
          aliases: group,
          sites: {},
          defaultTarget: group[0]
        });
      }
    }
  }

  return rules;
}

/**
 * Resolve a single tag token for a target booru site.
 */
export function resolveTagForSite(token, targetSite, customRules = [], settings = null) {
  if (!token || typeof token !== 'string') return token;

  const site = String(targetSite || '').toLowerCase();
  let prefix = '';
  let core = token.trim();

  // Handle negative tag prefix
  if (core.startsWith('-')) {
    prefix = '-';
    core = core.slice(1);
  }

  // Handle category prefix (artist:, character:, copyright:, meta:, etc.)
  let categoryPrefix = '';
  const colonIdx = core.indexOf(':');
  let isExplicitArtist = false;
  if (colonIdx > 0) {
    const potCat = core.slice(0, colonIdx).toLowerCase();
    if (['artist', 'character', 'copyright', 'meta', 'general', 'circle', 'author', 'creator'].includes(potCat)) {
      categoryPrefix = core.slice(0, colonIdx + 1);
      core = core.slice(colonIdx + 1);
      if (['artist', 'author', 'creator'].includes(potCat)) {
        isExplicitArtist = true;
      }
    }
  }

  const lookupKey = core.toLowerCase();
  let replacedTag = null;

  // 1. Check user custom rules first (highest priority)
  if (Array.isArray(customRules) && customRules.length > 0) {
    for (const rule of customRules) {
      if (!rule || !Array.isArray(rule.aliases)) continue;
      if (rule.aliases.includes(lookupKey)) {
        if (rule.sites && rule.sites[site]) {
          replacedTag = rule.sites[site];
          break;
        } else if (rule.defaultTarget) {
          replacedTag = rule.defaultTarget;
          break;
        }
      }
    }
  }

  // 2. Check dynamically discovered aliases
  if (!replacedTag && discoveredAliasMap.has(lookupKey)) {
    const entry = discoveredAliasMap.get(lookupKey);
    if (entry.sites && entry.sites[site]) {
      replacedTag = entry.sites[site];
    } else if (entry.id) {
      replacedTag = entry.id;
    }
  }

  // 3. Check built-in author aliases
  if (!replacedTag && builtinAliasMap.has(lookupKey)) {
    const entry = builtinAliasMap.get(lookupKey);
    if (entry.sites && entry.sites[site]) {
      replacedTag = entry.sites[site];
    }
  }

  // If unknown and explicitly an artist or bare single word, trigger background discovery (non-blocking)
  if (process.env.NODE_ENV !== 'test' && !replacedTag && (isExplicitArtist || (!lookupKey.includes(':') && !lookupKey.startsWith('order:') && !lookupKey.startsWith('sort:')))) {
    discoverAuthorAliases(lookupKey, settings).catch(() => {});
  }

  if (replacedTag) {
    return `${prefix}${categoryPrefix}${replacedTag}`;
  }

  return token;
}

/**
 * Resolve all tags within a raw query string for a specific booru site.
 */
export function resolveQueryTagsForSite(rawTags, targetSite, settings = null) {
  if (!rawTags || typeof rawTags !== 'string') return rawTags || '';

  const site = String(targetSite || '').toLowerCase();
  const customRules = parseCustomAliases(settings?.customAliases);

  const tokens = rawTags.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';

  const resolvedTokens = tokens.map(token => resolveTagForSite(token, site, customRules, settings));
  return resolvedTokens.join(' ');
}

/**
 * Introspection & Management API
 */
export function getAliasesInfo() {
  return {
    builtinCount: builtinAliasList.length,
    discoveredCount: discoveredAliasList.length,
    discovered: discoveredAliasList
  };
}

export function clearDiscoveredAliases() {
  discoveredAliasList = [];
  discoveredAliasMap.clear();
  checkedCandidates.clear();
  try {
    if (fs.existsSync(DISCOVERED_ALIASES_FILE)) {
      fs.unlinkSync(DISCOVERED_ALIASES_FILE);
    }
  } catch {}
  logInfo('AliasService', 'Кэш автоматически обнаруженных алиасов очищен');
  return true;
}

/**
 * Returns a complete bidirectional alias mapping: lowercased alias/name -> Array of lowercased alias variants.
 * Used by client-side Following and Recommended algorithms to resolve aliases across sites.
 */
export function getAllKnownAliasesMap() {
  const map = {};

  const addVariants = (variants) => {
    const list = Array.from(new Set(variants.map(v => String(v).trim().toLowerCase()).filter(Boolean)));
    if (list.length <= 1) return;
    for (const item of list) {
      if (!map[item]) map[item] = [];
      for (const other of list) {
        if (!map[item].includes(other)) {
          map[item].push(other);
        }
      }
    }
  };

  // 1. Built-in aliases
  for (const entry of builtinAliasList) {
    if (!entry) continue;
    const items = [entry.id, ...(entry.aliases || []), ...Object.values(entry.sites || {})];
    addVariants(items);
  }

  // 2. Discovered aliases
  for (const entry of discoveredAliasList) {
    if (!entry) continue;
    const items = [entry.id, ...(entry.aliases || []), ...Object.values(entry.sites || {})];
    addVariants(items);
  }

  return map;
}
