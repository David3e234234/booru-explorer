import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATA_DIR, BROWSER_USER_AGENT } from '../config/constants.js';
import { fetchSafe, discardResponse } from '../utils/network.js';
import { logInfo, logWarn, logError } from '../utils/logger.js';

import { writeJsonFileAsync } from './jsonFileStore.js';
import { isActive as sqliteActive, kvGet as sqliteKvGet, kvSet as sqliteKvSet, kvDelete as sqliteKvDelete } from './sqliteStore.js';

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
// A Danbooru artist page with dozens of other_names is a circle or
// aggregator page, not an alias group. Registering it would alias every name
// on the page to every other name, so a single-author query explodes into a
// multi-author mix (one artist's search returning three unrelated feeds).
const MAX_DISCOVERED_ALIAS_GROUP = 8;
const checkedCandidates = new Set();
let isSavingDiscovered = false;
let saveTimeout = null;

/**
 * Returns true if an alias is in the user's blacklist of ignored/rejected aliases.
 */
export function isAliasIgnored(alias, ignoredList = []) {
  if (!alias || !Array.isArray(ignoredList) || ignoredList.length === 0) return false;
  const clean = String(alias).trim().toLowerCase();
  if (!clean) return false;
  return ignoredList.some(item => String(item).trim().toLowerCase() === clean);
}

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
    if (sqliteActive()) {
      const stored = sqliteKvGet('discovered_aliases', null);
      if (Array.isArray(stored)) {
        discoveredAliasList = stored;
        rebuildDiscoveredMap();
        return;
      }
    } else if (fs.existsSync(DISCOVERED_ALIASES_FILE)) {
      const raw = fs.readFileSync(DISCOVERED_ALIASES_FILE, 'utf-8');
      discoveredAliasList = JSON.parse(raw);
      rebuildDiscoveredMap();
      return;
    }
  } catch (err) {
    logError('AliasService', 'Не удалось загрузить discovered_aliases', err);
  }
  discoveredAliasList = [];
  discoveredAliasMap = new Map();
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
          sites,
          enabled: entry.enabled
        });
      }
    }
  }
}

function saveDiscoveredAliasesAsync() {
  try {
    if (sqliteActive()) {
      sqliteKvSet('discovered_aliases', discoveredAliasList);
      return;
    }
  } catch (e) {
    logError('AliasService', 'Не удалось сохранить discovered_aliases', e);
    return;
  }
  writeJsonFileAsync(DISCOVERED_ALIASES_FILE, discoveredAliasList, 200).catch((e) => {
    logError('AliasService', 'Не удалось сохранить discovered_aliases.json', e);
  });
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
 * Checks a list of candidate tags against Rule34 autocomplete API to find the active tag on Rule34.
 * Returns the exact tag value if found, or null.
 * @param {string[]} candidates
 * @param {object} [settings]
 * @returns {Promise<string|null>}
 */
async function findRule34TagMatch(candidates = [], settings = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const uniqueCandidates = Array.from(new Set(candidates.map(c => String(c).trim().toLowerCase()).filter(Boolean)));
  if (uniqueCandidates.length === 0) return null;

  try {
    const checks = uniqueCandidates.map(async (cand) => {
      const url = `https://api.rule34.xxx/autocomplete.php?q=${encodeURIComponent(cand)}`;
      const res = await fetchSafe(url, {
        timeout: 4000,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Referer': 'https://rule34.xxx/'
        },
        settings,
        site: 'rule34'
      });
      if (!res || !res.ok) {
        if (res) await discardResponse(res);
        return null;
      }
      const list = await res.json().catch(() => []);
      if (!Array.isArray(list) || list.length === 0) return null;

      // Find an exact match for the candidate in autocomplete results
      const exact = list.find(item => item?.value?.toLowerCase() === cand);
      if (!exact) return null;

      // Extract post count from label "tag (count)"
      const match = exact.label?.match(/\((\d+)\)$/);
      const postCount = match ? parseInt(match[1], 10) : 1;
      return { tag: exact.value, postCount };
    });

    const results = (await Promise.allSettled(checks))
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    if (results.length === 0) return null;
    // Pick match with highest post count
    results.sort((a, b) => b.postCount - a.postCount);
    return results[0].tag;
  } catch (err) {
    return null;
  }
}

/**
 * Returns all known alias variants for a given name/tag across custom rules, discovered aliases, and built-in aliases.
 * @param {string} rawName
 * @param {Array|string} [customAliases]
 * @returns {string[]}
 */
export function getAllAliasesForName(rawName, customAliases = [], ignoredAliases = []) {
  if (!rawName || typeof rawName !== 'string') return [];
  const clean = rawName.trim().toLowerCase().replace(/^(?:artist|author|creator):/i, '');
  if (!clean || isAliasIgnored(clean, ignoredAliases)) return [];

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
    if (entry.enabled !== false) {
      if (entry.id) result.add(entry.id.toLowerCase());
      if (Array.isArray(entry.aliases)) entry.aliases.forEach(a => result.add(String(a).toLowerCase()));
      if (entry.sites) Object.values(entry.sites).forEach(s => s && result.add(String(s).toLowerCase()));
    }
  }

  // Also scan discoveredAliasList for any entry containing clean
  for (const entry of discoveredAliasList) {
    if (entry.enabled === false) continue;
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

  // Filter out any ignored/banned aliases
  return Array.from(result).filter(a => !isAliasIgnored(a, ignoredAliases));
}

/**
 * Checks Danbooru's tag directory for the canonical tag's post count, so an
 * alias group pointing at a name with zero posts is never registered.
 * Any lookup trouble resolves to true: verification may only block a group on
 * a definitive answer, not on a network error.
 */
async function verifyDanbooruTagHasPosts(tag, settings = {}) {
  try {
    const danbooruAuth = settings?.danbooruApiKey && settings?.danbooruLogin
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';

    const url = `https://danbooru.donmai.us/tags.json?search[name_matches]=${encodeURIComponent(tag)}&only=name,post_count${danbooruAuth}`;
    const res = await fetchSafe(url, {
      timeout: 6000,
      headers: { 'User-Agent': 'BooruExp/1.0' },
      settings,
      site: 'danbooru'
    });

    if (!res || !res.ok) {
      if (res) await discardResponse(res);
      return true;
    }

    const data = await res.json().catch(() => []);
    if (!Array.isArray(data)) return true;

    const match = data.find(t => t && typeof t.name === 'string' && t.name.toLowerCase() === tag);
    if (!match) return false;
    return (parseInt(match.post_count, 10) || 0) > 0;
  } catch (err) {
    return true;
  }
}

/**
 * Asynchronously discovers aliases for an author from Danbooru's artist directory.
 * Non-blocking, saves to local disk cache upon finding alternatives.
 */
export async function discoverAuthorAliases(authorCandidate, settings = {}) {
  if (settings?.enableAliasDiscovery === false) return null;
  if (!authorCandidate || typeof authorCandidate !== 'string') return null;

  const candidate = authorCandidate.toLowerCase().trim();
  if (candidate.length < 3 || candidate.length > 50) return null;
  const ignoredList = Array.isArray(settings?.ignoredAliases) ? settings.ignoredAliases : [];
  if (isAliasIgnored(candidate, ignoredList)) return null;
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

    const url = `https://danbooru.donmai.us/artists.json?search[any_name_matches]=${encodeURIComponent(candidate)}&only=name,other_names,urls${danbooruAuth}`;

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
    if (isAliasIgnored(canonicalName, ignoredList)) return null;

    // any_name_matches is fuzzy: data[0] can be an unrelated artist that merely
    // resembles the query. Only register when the queried candidate is this
    // artist's own name or one of its listed other_names.
    const rawOtherNames = Array.isArray(artistObj.other_names)
      ? artistObj.other_names.map(n => String(n).toLowerCase().trim())
      : [];
    if (canonicalName !== candidate && !rawOtherNames.includes(candidate)) {
      return null;
    }

    const aliasSet = new Set();
    aliasSet.add(canonicalName);

    if (Array.isArray(artistObj.other_names)) {
      for (const on of artistObj.other_names) {
        const cleaned = cleanAuthorHandle(on);
        if (cleaned && cleaned.length >= 3 && !isAliasIgnored(cleaned, ignoredList)) {
          aliasSet.add(cleaned);
        }
      }
    }

    if (Array.isArray(artistObj.urls)) {
      for (const uObj of artistObj.urls) {
        const handle = extractHandleFromUrl(uObj?.url);
        if (handle && handle.length >= 3 && !isAliasIgnored(handle, ignoredList)) {
          aliasSet.add(handle);
        }
      }
    }

    // Only register if we discovered at least one alternative name!
    if (aliasSet.size > 1 && aliasSet.size <= MAX_DISCOVERED_ALIAS_GROUP) {
      const aliases = Array.from(aliasSet).filter(a => !isAliasIgnored(a, ignoredList));
      if (aliases.length <= 1) return null;

      // The canonical tag becomes the query actually sent to Danbooru, so a
      // name with zero posts would blank every search it is substituted into.
      // Fail-open on lookup trouble: a network hiccup must not block a plausible group.
      if (!(await verifyDanbooruTagHasPosts(canonicalName, settings))) {
        return null;
      }

      const sites = { danbooru: canonicalName };

      // Dynamically discover valid tag variant on Rule34 (verified against the
      // autocomplete post count, so unverified guesses are not registered)
      const rule34Match = await findRule34TagMatch(aliases, settings);
      if (rule34Match && !isAliasIgnored(rule34Match, ignoredList)) {
        sites.rule34 = rule34Match;
        sites.rule34video = rule34Match;
      }

      // Check if entry already exists in discovered list
      const existingIdx = discoveredAliasList.findIndex(e => e.id === canonicalName);
      if (existingIdx >= 0) {
        const existing = discoveredAliasList[existingIdx];
        const mergedAliases = Array.from(new Set([...existing.aliases, ...aliases])).filter(a => !isAliasIgnored(a, ignoredList));
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
export function learnAliasesFromPostMatches(posts = [], settings = {}) {
  if (settings?.enableAliasDiscovery === false) return;
  if (!Array.isArray(posts) || posts.length < 2) return;

  const ignoredList = Array.isArray(settings?.ignoredAliases) ? settings.ignoredAliases : [];

  const sourceGroups = new Map();
  for (const post of posts) {
    if (!post || !post.source || !post.author || !post.site) continue;
    const authorClean = post.author.toLowerCase().trim();
    if (isAliasIgnored(authorClean, ignoredList)) continue;
    try {
      const u = new URL(post.source);
      const host = u.hostname.toLowerCase();
      // Correlate on specific author platforms with distinct work IDs
      if (['twitter.com', 'x.com', 'pixiv.net', 'artstation.com', 'patreon.com', 'fanbox.cc', 'fantia.jp', 'boosty.to', 'subscribestar.adult', 'subscribestar.com'].some(h => host.includes(h))) {
        const normKey = `${host}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
        if (!sourceGroups.has(normKey)) sourceGroups.set(normKey, []);
        sourceGroups.get(normKey).push({ site: post.site, author: authorClean });
      }
    } catch {}
  }

  let hasNew = false;
  for (const [key, items] of sourceGroups.entries()) {
    if (items.length < 2) continue;
    
    // Check if we have different sites with different author names
    const distinctSites = new Set(items.map(i => i.site));
    const distinctAuthors = new Set(items.map(i => i.author).filter(a => !isAliasIgnored(a, ignoredList)));

    if (distinctSites.size > 1 && distinctAuthors.size > 1 && distinctAuthors.size <= MAX_DISCOVERED_ALIAS_GROUP) {
      const canonical = items.find(i => i.site === 'danbooru')?.author || Array.from(distinctAuthors)[0];
      if (isAliasIgnored(canonical, ignoredList)) continue;
      const sitesMap = {};
      for (const item of items) {
        if (item.author && !isAliasIgnored(item.author, ignoredList)) sitesMap[item.site] = item.author;
      }

      const aliasArray = Array.from(distinctAuthors);
      const existingIdx = discoveredAliasList.findIndex(e => e.id === canonical || e.aliases?.some(a => distinctAuthors.has(a)));

      if (existingIdx >= 0) {
        const existing = discoveredAliasList[existingIdx];
        const mergedAliases = Array.from(new Set([...existing.aliases, ...aliasArray])).filter(a => !isAliasIgnored(a, ignoredList));
        // Never grow a group past the plausibility cap: a source-URL that keeps
        // matching new names is an aggregator, not one author
        if (mergedAliases.length > MAX_DISCOVERED_ALIAS_GROUP) continue;
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
 * Splits a raw search token into its structural parts: negative prefix, category
 * prefix, lowercased core and the explicit-artist flag.
 */
function splitTokenParts(token) {
  let prefix = '';
  let core = String(token || '').trim();

  if (core.startsWith('-')) {
    prefix = '-';
    core = core.slice(1);
  }

  let categoryPrefix = '';
  let isExplicitArtist = false;
  const colonIdx = core.indexOf(':');
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

  return { prefix, categoryPrefix, core: core.toLowerCase(), isExplicitArtist };
}

/**
 * Resolve a single tag token for a target booru site.
 * `settings.bypassDiscoveredAliases` skips the auto-discovered map: it backs the
 * empty-result retry that keeps a bad discovered alias from killing a search.
 */
export function resolveTagForSite(token, targetSite, customRules = [], settings = null) {
  if (!token || typeof token !== 'string') return token;

  const site = String(targetSite || '').toLowerCase();
  const { prefix, categoryPrefix, core: lookupKey, isExplicitArtist } = splitTokenParts(token);
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

  // 2. Check dynamically discovered aliases. Groups quarantined by the
  // empty-result tracker (enabled === false) stay out of the rewrite.
  if (!replacedTag && settings?.bypassDiscoveredAliases !== true && discoveredAliasMap.has(lookupKey)) {
    const entry = discoveredAliasMap.get(lookupKey);
    if (entry.enabled !== false && entry.sites && entry.sites[site]) {
      replacedTag = entry.sites[site];
    }
  }

  // 3. Check built-in author aliases
  if (!replacedTag && builtinAliasMap.has(lookupKey)) {
    const entry = builtinAliasMap.get(lookupKey);
    if (entry.sites && entry.sites[site]) {
      replacedTag = entry.sites[site];
    }
  }

  const ignoredList = Array.isArray(settings?.ignoredAliases) ? settings.ignoredAliases : [];
  if (isAliasIgnored(lookupKey, ignoredList)) {
    return token;
  }

  // If unknown and explicitly an artist or bare single word, trigger background discovery (non-blocking)
  if (process.env.NODE_ENV !== 'test' && !replacedTag && settings?.enableAliasDiscovery !== false && settings?.bypassDiscoveredAliases !== true && (isExplicitArtist || (!lookupKey.includes(':') && !lookupKey.startsWith('order:') && !lookupKey.startsWith('sort:')))) {
    discoverAuthorAliases(lookupKey, settings).catch(() => {});
  }

  if (replacedTag && !isAliasIgnored(replacedTag, ignoredList)) {
    return `${prefix}${categoryPrefix}${replacedTag}`;
  }

  return token;
}

/**
 * Describes every alias substitution a query would receive, without applying it.
 * Powers the empty-result fallback in fetchPosts: when a substituted query comes
 * back empty and this list is non-empty, the query is retried as the user wrote it.
 */
export function getQuerySubstitutions(rawTags, targetSites, settings = null) {
  if (!rawTags || typeof rawTags !== 'string') return [];
  const sites = (Array.isArray(targetSites) ? targetSites : [targetSites])
    .map(s => String(s || '').toLowerCase())
    .filter(Boolean);
  if (sites.length === 0) return [];

  const customRules = parseCustomAliases(settings?.customAliases);
  const ignoredList = Array.isArray(settings?.ignoredAliases) ? settings.ignoredAliases : [];
  const tokens = rawTags.split(/\s+/).filter(Boolean);
  const substitutions = [];

  for (const token of tokens) {
    const { prefix, categoryPrefix, core } = splitTokenParts(token);
    if (!core || isAliasIgnored(core, ignoredList)) continue;

    for (const site of sites) {
      let replacement = null;
      let source = null;
      let entryId = null;

      if (Array.isArray(customRules) && customRules.length > 0) {
        for (const rule of customRules) {
          if (!rule || !Array.isArray(rule.aliases)) continue;
          if (rule.aliases.includes(core)) {
            const target = (rule.sites && rule.sites[site]) || rule.defaultTarget;
            if (target) {
              replacement = target;
              source = 'custom';
              break;
            }
          }
        }
      }

      if (!replacement && settings?.bypassDiscoveredAliases !== true && discoveredAliasMap.has(core)) {
        const entry = discoveredAliasMap.get(core);
        if (entry.enabled !== false && entry.sites && entry.sites[site]) {
          replacement = entry.sites[site];
          source = 'discovered';
          entryId = entry.id;
        }
      }

      if (!replacement && builtinAliasMap.has(core)) {
        const entry = builtinAliasMap.get(core);
        if (entry.sites && entry.sites[site]) {
          replacement = entry.sites[site];
          source = 'builtin';
        }
      }

      if (replacement && !isAliasIgnored(replacement, ignoredList)) {
        const resolved = `${prefix}${categoryPrefix}${replacement}`;
        // Identity rewrites carry no risk and get no tracking
        if (resolved !== token) {
          substitutions.push({ token, resolved, site, source, entryId });
        }
      }
    }
  }

  return substitutions;
}

// How many empty-result failures an auto-discovered alias may cause before it is
// disabled. Manual edits (PUT /api/aliases/discovered/:id) reset the counter.
const ALIAS_AUTO_DISABLE_THRESHOLD = 3;

/**
 * Feeds the outcome of a substituted search back into the discovered alias store.
 * `success` means the substituted query returned posts (failure counter resets);
 * `empty` means the substituted query returned nothing while the original query
 * did return posts, which is proof the alias blocked a working search. After
 * ALIAS_AUTO_DISABLE_THRESHOLD failures the group is disabled but kept visible
 * in the manager so the operator can inspect or re-enable it.
 */
export function reportAliasOutcome(substitutions, outcome) {
  if (!Array.isArray(substitutions) || substitutions.length === 0) return;
  if (outcome !== 'success' && outcome !== 'empty') return;

  let changed = false;
  for (const sub of substitutions) {
    if (!sub || sub.source !== 'discovered' || !sub.entryId) continue;
    const entry = discoveredAliasList.find(e => e.id === sub.entryId);
    if (!entry || entry.enabled === false) continue;

    if (outcome === 'success') {
      if (entry.failCount) entry.failCount = 0;
      entry.hitCount = (entry.hitCount || 0) + 1;
    } else {
      entry.failCount = (entry.failCount || 0) + 1;
      if (entry.failCount >= ALIAS_AUTO_DISABLE_THRESHOLD) {
        entry.enabled = false;
        entry.disabledAt = new Date().toISOString();
        logWarn('AliasService', `Алиас "${entry.id}" автоматически отключен: подмена запроса ${entry.failCount} раз привела к пустой выдаче`);
      }
    }
    changed = true;
  }

  if (changed) {
    rebuildDiscoveredMap();
    saveDiscoveredAliasesAsync();
  }
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
    if (sqliteActive()) sqliteKvDelete('discovered_aliases');
    else if (fs.existsSync(DISCOVERED_ALIASES_FILE)) fs.unlinkSync(DISCOVERED_ALIASES_FILE);
  } catch {}
  logInfo('AliasService', 'Кэш автоматически обнаруженных алиасов очищен');
  return true;
}

export function getDiscoveredAliasesList() {
  return [...discoveredAliasList];
}

export function updateDiscoveredAliasEntry(originalId, { id, aliases, sites, enabled } = {}) {
  if (!originalId || typeof originalId !== 'string') return { success: false, error: 'Идентификатор не указан' };
  const targetId = originalId.trim().toLowerCase();
  const idx = discoveredAliasList.findIndex(e => (e.id || '').trim().toLowerCase() === targetId);

  const newId = typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : targetId;
  const newAliases = Array.isArray(aliases)
    ? Array.from(new Set(aliases.map(a => String(a).trim().toLowerCase()).filter(Boolean)))
    : (idx !== -1 ? discoveredAliasList[idx].aliases : [newId]);
  const newSites = (sites && typeof sites === 'object' && !Array.isArray(sites))
    ? { ...sites }
    : (idx !== -1 ? discoveredAliasList[idx].sites : {});
  const existingEnabled = idx !== -1 ? discoveredAliasList[idx].enabled : undefined;
  const newEnabled = typeof enabled === 'boolean' ? enabled : existingEnabled;

  // Ensure newId is in aliases or present
  if (!newAliases.includes(newId)) {
    newAliases.unshift(newId);
  }

  let updatedEntry;
  if (idx === -1) {
    updatedEntry = {
      id: newId,
      aliases: newAliases,
      sites: newSites,
      discoveredAt: new Date().toISOString()
    };
    if (typeof newEnabled === 'boolean') updatedEntry.enabled = newEnabled;
    discoveredAliasList.push(updatedEntry);
  } else {
    const existing = discoveredAliasList[idx];
    updatedEntry = {
      ...existing,
      id: newId,
      aliases: newAliases,
      sites: newSites,
      updatedAt: new Date().toISOString()
    };
    if (typeof newEnabled === 'boolean') {
      updatedEntry.enabled = newEnabled;
      // A manual re-enable (or any edit) is an operator verdict that the
      // quarantine counter cannot outvote
      if (newEnabled) {
        delete updatedEntry.disabledAt;
        updatedEntry.failCount = 0;
      }
    }
    discoveredAliasList[idx] = updatedEntry;
  }

  rebuildDiscoveredMap();
  saveDiscoveredAliasesAsync();
  logInfo('AliasService', `Алиас "${originalId}" ${idx === -1 ? 'добавлен' : 'обновлен'} пользователем: ${newAliases.join(', ')}`);
  return { success: true, entry: updatedEntry };
}

export function deleteDiscoveredAliasEntry(id) {
  if (!id || typeof id !== 'string') return { success: false, error: 'Идентификатор не указан' };
  const targetId = id.trim().toLowerCase();
  const idx = discoveredAliasList.findIndex(e => (e.id || '').trim().toLowerCase() === targetId);
  if (idx === -1) {
    return { success: false, error: 'Запись не найдена' };
  }

  discoveredAliasList.splice(idx, 1);
  rebuildDiscoveredMap();
  saveDiscoveredAliasesAsync();
  logInfo('AliasService', `Алиас "${id}" удален пользователем`);
  return { success: true };
}

/**
 * Returns a complete bidirectional alias mapping: lowercased alias/name -> Array of lowercased alias variants.
 * Used by client-side Following and Recommended algorithms to resolve aliases across sites.
 */
export function getAllKnownAliasesMap(ignoredAliases = []) {
  const map = {};

  const addVariants = (variants) => {
    const list = Array.from(new Set(variants.map(v => String(v).trim().toLowerCase()).filter(Boolean)))
      .filter(v => !isAliasIgnored(v, ignoredAliases));
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
    if (!entry || entry.enabled === false) continue;
    const items = [entry.id, ...(entry.aliases || []), ...Object.values(entry.sites || {})];
    addVariants(items);
  }

  return map;
}
