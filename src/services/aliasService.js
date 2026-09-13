import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to built-in author aliases
const BUILTIN_ALIASES_PATH = path.join(__dirname, '..', 'config', 'authorAliases.json');

let builtinAliasList = [];
let builtinAliasMap = new Map();

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
    
    // Also include canonical entry id if present
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

// Initial load
loadBuiltinAliases();

/**
 * Parse user custom alias rules from text or array into a normalized structure.
 * Supported line formats:
 *   1) simple synonym: tag_a = tag_b
 *   2) site-specific:  tag_a = danbooru:tag_b, rule34:tag_c
 *   3) bidirectional synonym group: tag_a, tag_b, tag_c
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
      // e.g. redrain3d, redrainsfm
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
 * Handles `-` prefix for negative tags and `category:` prefixes (e.g. `artist:tag`).
 */
export function resolveTagForSite(token, targetSite, customRules = []) {
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
  if (colonIdx > 0) {
    const potCat = core.slice(0, colonIdx).toLowerCase();
    if (['artist', 'character', 'copyright', 'meta', 'general', 'circle', 'author'].includes(potCat)) {
      categoryPrefix = core.slice(0, colonIdx + 1);
      core = core.slice(colonIdx + 1);
    }
  }

  const lookupKey = core.toLowerCase();
  let replacedTag = null;

  // 1. Check user custom rules first
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

  // 2. Check built-in author aliases if no custom rule matched
  if (!replacedTag && builtinAliasMap.has(lookupKey)) {
    const entry = builtinAliasMap.get(lookupKey);
    if (entry.sites && entry.sites[site]) {
      replacedTag = entry.sites[site];
    }
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

  const resolvedTokens = tokens.map(token => resolveTagForSite(token, site, customRules));
  return resolvedTokens.join(' ');
}

/**
 * Expose raw builtin aliases for introspection or testing
 */
export function getBuiltinAliases() {
  return builtinAliasList;
}

export function reloadBuiltinAliases() {
  loadBuiltinAliases();
}
