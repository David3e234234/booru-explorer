import express from 'express';
import { tagAutocompleteCache } from '../services/cacheService.js';
import { getSettings } from '../services/storageService.js';
import { getCreatorsDirectory } from '../parsers/pawchive.js';
import { getCreatorsDirectory as getKemonoCreatorsDirectory } from '../parsers/kemono.js';
import { loadGlobalTagSummary, getTagCategory, META_KEYWORDS } from '../utils/tagClassifier.js';
import { fetchSafe } from '../utils/network.js';
import { getAllAliasesForName } from '../services/aliasService.js';
import { parseRequestAuth, buildAuthCacheKey, resolveRequestSettings } from '../utils/settingsValidation.js';

const router = express.Router();

// GET /api/tags/autocomplete
router.get('/tags/autocomplete', async (req, res) => {
  const rawValue = Array.isArray(req.query.q) ? req.query.q[0] : (req.query.q ?? req.query.query);
  const rawQuery = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (!rawQuery) return res.json({ tags: [] });

  // Normalize: replace spaces with underscores (hu ta -> hu_ta)
  const query = rawQuery.replace(/\s+/g, '_');
  const site = typeof req.query.site === 'string' ? req.query.site : 'danbooru';
  const clientAuth = parseRequestAuth(req);
  const serverSettings = getSettings();
  const settings = resolveRequestSettings(serverSettings, clientAuth);
  const authKey = buildAuthCacheKey(clientAuth, serverSettings);

  const cacheKey = `${site}:${query.toLowerCase()}:${authKey}`;
  const cached = tagAutocompleteCache.get(cacheKey);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return res.json({ tags: cached });
  }

  // Universal query against Danbooru as the tag reference
  const fetchDanbooruTags = async (q) => {
    try {
      const url = `https://danbooru.donmai.us/tags.json?search[name_matches]=*${encodeURIComponent(q)}*&limit=15&search[order]=count`;
      const resp = await fetchSafe(url, { timeout: 3500, settings, site: 'danbooru' });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          return data.map(item => ({
            value: item.name,
            label: item.name.replace(/_/g, ' '),
            count: item.post_count || 0,
            category: item.category === 1 ? 'artist' : item.category === 3 ? 'copyright' : item.category === 4 ? 'character' : item.category === 5 ? 'meta' : 'general'
          }));
        }
      }
    } catch {}
    return [];
  };

  try {
    let tagsResult = [];

    if (site === 'danbooru') {
      tagsResult = await fetchDanbooruTags(query);
    } else if (site === 'rule34') {
      const authQuery = (settings?.rule34ApiKey && settings?.rule34UserId)
        ? `&api_key=${encodeURIComponent(settings.rule34ApiKey)}&user_id=${encodeURIComponent(settings.rule34UserId)}`
        : '';
      try {
        const url = `https://api.rule34.xxx/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}${authQuery}`;
        const resp = await fetchSafe(url, {
          headers: { 'Referer': 'https://rule34.xxx/' },
          timeout: 3000,
          settings,
          site: 'rule34'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => {
              const val = typeof item === 'string' ? item : (item.value || item.label || '');
              const total = typeof item === 'object' ? (parseInt(item.total || item.count, 10) || 0) : 0;
              const type = typeof item === 'object' ? (item.type || 'general') : 'general';
              return {
                value: val,
                label: val.replace(/_/g, ' '),
                count: total,
                category: type === 'tag' ? 'general' : type
              };
            });
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'gelbooru') {
      try {
        const url = `https://gelbooru.com/index.php?page=autocomplete2&term=${encodeURIComponent(query.toLowerCase())}&type=tag_query&limit=15`;
        const resp = await fetchSafe(url, {
          headers: { 'Referer': 'https://gelbooru.com/' },
          timeout: 3000,
          settings,
          site: 'gelbooru'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => {
              let cat = 'general';
              const rawCat = String(item.category || '').toLowerCase();
              if (rawCat === '1' || rawCat === 'artist') cat = 'artist';
              else if (rawCat === '3' || rawCat === 'copyright') cat = 'copyright';
              else if (rawCat === '4' || rawCat === 'character') cat = 'character';
              else if (rawCat === '5' || rawCat === '6' || rawCat === 'metadata' || rawCat === 'meta') cat = 'meta';

              return {
                value: item.value || item.label,
                label: (item.label || item.value || '').replace(/_/g, ' '),
                count: parseInt(item.post_count || item.count, 10) || 0,
                category: cat
              };
            });
          }
        }
      } catch {}
    } else if (site === 'xbooru') {
      try {
        const url = `https://xbooru.com/public/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
        const resp = await fetchSafe(url, {
          headers: { 'Referer': 'https://xbooru.com/' },
          timeout: 3000,
          settings,
          site: 'xbooru'
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => {
              const matchCount = String(item.label || '').match(/\((\d+)\)$/);
              const count = matchCount ? parseInt(matchCount[1], 10) : (parseInt(item.total || item.count, 10) || 0);
              const val = item.value || (item.label ? item.label.replace(/\s*\(\d+\)$/, '').trim() : '');
              let cat = 'general';
              const tLow = String(item.type || '').toLowerCase();
              if (tLow === 'artist' || tLow === '1') cat = 'artist';
              else if (tLow === 'copyright' || tLow === '3') cat = 'copyright';
              else if (tLow === 'character' || tLow === '4') cat = 'character';
              else if (tLow === 'metadata' || tLow === 'meta' || tLow === '6') cat = 'meta';

              return {
                value: val,
                label: val.replace(/_/g, ' '),
                count,
                category: cat
              };
            });
          }
        }
      } catch {}
    } else if (site === 'tbib' || site === 'hypnohub') {
      const host = site === 'tbib' ? 'https://tbib.org' : 'https://hypnohub.net';
      try {
        const url = `${host}/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
        const resp = await fetchSafe(url, {
          headers: { 'Referer': `${host}/` },
          timeout: 3000,
          settings,
          site
        });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            const tagMap = await loadGlobalTagSummary(settings);
            tagsResult = data.map(item => {
              const matchCount = String(item.label || '').match(/\((\d+)\)$/);
              const count = matchCount ? parseInt(matchCount[1], 10) : (parseInt(item.total || item.count, 10) || 0);
              const val = item.value || (item.label ? item.label.replace(/\s*\(\d+\)$/, '').trim() : '');
              return {
                value: val,
                label: val.replace(/_/g, ' '),
                count,
                category: getTagCategory(val, tagMap)
              };
            });
          }
        }
      } catch {}
    } else if (site === 'yandere' || site === 'konachan') {
      const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.com';
      try {
        const url = `${base}/tag.json?name=${encodeURIComponent(query)}&limit=15&order=count`;
        const resp = await fetchSafe(url, { timeout: 3000, settings, site });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            tagsResult = data.map(item => ({
              value: item.name,
              label: item.name.replace(/_/g, ' '),
              count: item.count || 0,
              category: item.type === 1 ? 'artist' : (item.type === 3 || item.type === 6) ? 'copyright' : item.type === 4 ? 'character' : (item.type === 5 || META_KEYWORDS.has(item.name.toLowerCase())) ? 'meta' : 'general'
            }));
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'rule34video') {
      try {
        const modelJsonUrl = `https://rule34video.com/models_json.php?advanced_search=true&q=${encodeURIComponent(query)}`;
        const resModels = await fetchSafe(modelJsonUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'X-Requested-With': 'XMLHttpRequest'
          },
          timeout: 4000,
          settings,
          site: 'rule34video'
        });
        if (resModels.ok) {
          const data = await resModels.json();
          if (data && Array.isArray(data.items) && data.items.length > 0) {
            const seen = new Set();
            for (const item of data.items) {
              const name = (item.title || '').trim();
              if (name && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase());
                const totalCount = parseInt(item.total, 10) || 0;
                tagsResult.push({
                  value: `artist:${name.toLowerCase().replace(/\s+/g, '_')}`,
                  label: `${name} (${totalCount} видео)`,
                  count: totalCount,
                  category: 'artist'
                });
              }
            }
          }
        }
      } catch {}
      const danbooruTags = await fetchDanbooruTags(query);
      tagsResult = [...tagsResult, ...danbooruTags];
    } else if (site === 'safebooru') {
      try {
        const url = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
        const resp = await fetchSafe(url, { timeout: 3000, settings, site: 'safebooru' });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data) && data.length > 0) {
            const tagMap = await loadGlobalTagSummary(settings);
            tagsResult = data.map(item => {
              const val = item.value || item.label || '';
              return {
                value: val,
                label: (item.label || item.value || '').replace(/_/g, ' '),
                count: parseInt(item.total || item.count, 10) || 0,
                category: getTagCategory(val, tagMap)
              };
            });
          }
        }
      } catch {}

      if (tagsResult.length === 0) {
        tagsResult = await fetchDanbooruTags(query);
      }
    } else if (site === 'pawchive') {
      try {
        const { list } = await getCreatorsDirectory(settings);
        if (Array.isArray(list) && list.length > 0) {
          const cleanQ = query.toLowerCase().replace(/[\s_.-]+/g, '');
          const queryAliases = getAllAliasesForName(query, settings?.customAliases).map(a => a.toLowerCase().replace(/[\s_.-]+/g, ''));
          const aliasSet = new Set(queryAliases);

          const matches = list.filter(c => {
            const nameClean = (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '');
            if (nameClean.includes(cleanQ) || (c.service && c.service.toLowerCase().includes(cleanQ))) return true;
            for (const al of aliasSet) {
              if (al.length >= 2 && (nameClean === al || nameClean.includes(al))) return true;
            }
            return false;
          }).slice(0, 15);

          tagsResult = matches.map(c => ({
            value: `artist:${(c.name || '').toLowerCase().replace(/[\s_.-]+/g, '_')}`,
            label: `${c.name} (${c.service})`,
            count: 0,
            category: 'artist'
          }));
        }
      } catch {}
    } else if (site === 'kemono') {
      try {
        const { list } = await getKemonoCreatorsDirectory(settings);
        if (Array.isArray(list) && list.length > 0) {
          const cleanQ = query.toLowerCase().replace(/[\s_.-]+/g, '');
          const queryAliases = getAllAliasesForName(query, settings?.customAliases).map(a => a.toLowerCase().replace(/[\s_.-]+/g, ''));
          const aliasSet = new Set(queryAliases);

          const matches = list.filter(c => {
            const nameClean = (c.name || '').toLowerCase().replace(/[\s_.-]+/g, '');
            if (nameClean.includes(cleanQ) || (c.service && c.service.toLowerCase().includes(cleanQ))) return true;
            for (const al of aliasSet) {
              if (al.length >= 2 && (nameClean === al || nameClean.includes(al))) return true;
            }
            return false;
          }).slice(0, 15);

          tagsResult = matches.map(c => ({
            value: `artist:${(c.name || '').toLowerCase().replace(/[\s_.-]+/g, '_')}`,
            label: `${c.name} (${c.service})`,
            count: 0,
            category: 'artist'
          }));
        }
      } catch {}
    }

    if (tagsResult.length > 0) {
      tagAutocompleteCache.set(cacheKey, tagsResult);
    }

    res.json({ tags: tagsResult });
  } catch (err) {
    res.json({ tags: [] });
  }
});

export default router;
