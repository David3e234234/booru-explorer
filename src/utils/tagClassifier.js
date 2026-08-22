import { fetchSafe } from './network.js';
import { logError } from './logger.js';
import { extractAuthor as extractAuthorFromSource } from './tagHelpers.js';

// Кеш глобальной карты тегов (1 = artist, 3 = copyright, 4 = character, 0 = general, 6 = meta)
let globalTagMap = null;
let isLoadingMap = null;
let lastFetchedTime = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

const KNOWN_EXTRA_TAGS = {
  // Популярные художники и аниматоры
  minus8: 1,
  derpixon: 1,
  'zone-sama': 1,
  zone_sama: 1,
  diives: 1,
  vic_bw: 1,
  nyantastic: 1,
  redmoa: 1,
  afrobull: 1,
  general_zoi: 1,
  kuroodod: 1,
  nagoonimate: 1,
  slymr: 1,
  dross: 1,
  incase: 1,
  geiru: 1,
  merunyaa: 1,
  kamome: 1,
  hirame: 1,
  asagi: 1,
  cutesexyrobutts: 1,
  sakimichan: 1,
  dishwasher1910: 1,
  quasarturkey: 1,
  krekkov: 1,
  heartbreak_juan: 1,
  maplestar: 1,
  telepurte: 1,
  atdan: 1,
  yd: 1,
  as109: 1,
  raiko: 1,
  reDrop: 1,
  wlop: 1,

  // Популярные франшизы (Copyright)
  hololive: 3,
  genshin_impact: 3,
  honkai_star_rail: 3,
  blue_archive: 3,
  fate_grand_order: 3,
  azur_lane: 3,
  overwatch: 3,
  league_of_legends: 3,
  pokemon: 3,
  touhou: 3,
  vocaloid: 3,
  arknights: 3,
  nikke: 3,
  zenless_zone_zero: 3
};

const GENERIC_NON_ARTIST_TAGS = new Set([
  '2d', '3d', 'art', 'artwork', 'animation', 'video', 'sound', 'audio', 'highres', 'lowres', 
  'comic', 'parody', 'original', 'cosplay', 'edit', 'cg', 'illustration', 'sketch', 
  'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'ai_generated', 'ai', 'unknown', 
  'anonymous', 'various', 'bad_id', 'bad_link', 'translated', 'translation', 'sample', 'thumbnail',
  'throat', 'oral', 'solo', 'female', 'male', 'breasts', 'nipples', 'pussy', 'penis', 'anal', 'hentai'
]);

const META_KEYWORDS = new Set([
  'highres', 'absurdres', 'superabsurdres', '4k', 'sound', 'audio', 'video', 'animated', 
  'ugoira', 'translated', 'translation_request', 'commentary', 'commentary_request', 
  'tagme', 'bad_id', 'bad_link', 'duplicate', 'source_request', 'check_my_note', 
  'lossless', 'third-party_edit', 'watermark', 'sample', 'thumbnail', 'patreon_reward', 
  'fantia', 'fanbox', 'skeb', 'lowres', 'downscaled', 'text', 'signature', 'username',
  'official_art', 'scan', 'wallpaper'
]);

async function loadGlobalTagSummary() {
  if (globalTagMap && Date.now() - lastFetchedTime < CACHE_TTL_MS) {
    return globalTagMap;
  }

  if (isLoadingMap) {
    return await isLoadingMap;
  }

  isLoadingMap = (async () => {
    try {
      // Загружаем полную базу тегов с konachan (или yandere при ошибке)
      let res = await fetchSafe('https://konachan.com/tag/summary.json', { timeout: 15000 });
      if (!res.ok) {
        res = await fetchSafe('https://yande.re/tag/summary.json', { timeout: 15000 });
      }
      if (!res.ok) {
        res = await fetchSafe('https://konachan.net/tag/summary.json', { timeout: 15000 });
      }

      if (res && res.ok) {
        const json = await res.json();
        if (json && typeof json.data === 'string') {
          const entries = json.data.split(' ');
          const map = new Map();

          // Добавляем теги из summary
          for (const entryStr of entries) {
            if (!entryStr) continue;
            const parts = entryStr.split('`');
            const type = parseInt(parts[0], 10);
            for (let i = 1; i < parts.length; i++) {
              const tName = parts[i];
              if (tName) {
                map.set(tName.toLowerCase(), type);
              }
            }
          }

          // Добавляем дополнительные теги
          for (const [tag, type] of Object.entries(KNOWN_EXTRA_TAGS)) {
            map.set(tag.toLowerCase(), type);
          }

          globalTagMap = map;
          lastFetchedTime = Date.now();
          return map;
        }
      }
    } catch (err) {
      logError('TagClassifier', 'Не удалось загрузить глобальную сводку тегов', err);
    } finally {
      isLoadingMap = null;
    }

    // Fallback: базовый набор
    if (!globalTagMap) {
      globalTagMap = new Map(Object.entries(KNOWN_EXTRA_TAGS));
    }
    return globalTagMap;
  })();

  return await isLoadingMap;
}

/**
 * Универсальная классификация тегов поста для любых Booru сайтов (Rule34, Danbooru, Gelbooru, Moebooru и т.д.)
 * @param {string[]} rawTags - исходный массив тегов
 * @param {string} sourceUrl - ссылка на источник (источник Pixiv, Twitter и т.д.)
 * @param {string} initialAuthor - заранее известный автор (если передан)
 * @returns {Promise<{ tagDetails: { artist: string[], copyright: string[], character: string[], general: string[], meta: string[] }, author: string }>}
 */
export async function classifyPostTags(rawTags = [], sourceUrl = '', initialAuthor = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const tagMap = await loadGlobalTagSummary();

  const artist = [];
  const copyright = [];
  const character = [];
  const meta = [];
  const general = [];

  const addUnique = (arr, val) => {
    if (val && !arr.includes(val)) arr.push(val);
  };

  for (const tag of tags) {
    if (!tag) continue;
    const originalTag = String(tag).trim();
    const lower = originalTag.toLowerCase();
    const cleanLower = lower
      .replace(/^(artist|creator|author|draw|channel|uploader|character|copyright|meta):/i, '')
      .replace(/_?\((artist|creator|circle|studio|character|cosplay|person|series|game|anime|manga|vtuber|novel|comic|franchise|project)\)$/i, '')
      .replace(/^by_/i, '');

    // 1. Проверка явных префиксов и маркеров
    if (lower.startsWith('artist:') || lower.startsWith('creator:') || lower.startsWith('author:') || lower.startsWith('draw:') ||
        lower.endsWith('_(artist)') || lower.endsWith('_(creator)') || lower.endsWith('_(circle)') || lower.endsWith('_(studio)') || lower.startsWith('by_')) {
      addUnique(artist, cleanLower);
      continue;
    }

    if (lower.startsWith('character:') || lower.endsWith('_(character)') || lower.endsWith('_(cosplay)') || lower.endsWith('_(person)')) {
      addUnique(character, cleanLower);
      continue;
    }

    if (lower.startsWith('copyright:') || lower.endsWith('_(series)') || lower.endsWith('_(game)') || lower.endsWith('_(anime)') || 
        lower.endsWith('_(manga)') || lower.endsWith('_(vtuber)') || lower.endsWith('_(novel)') || lower.endsWith('_(comic)') || 
        lower.endsWith('_(franchise)') || lower.endsWith('_(project)')) {
      addUnique(copyright, cleanLower);
      continue;
    }

    if (lower.startsWith('meta:') || META_KEYWORDS.has(lower) || lower.endsWith('_(medium)') || lower.endsWith('_(style)')) {
      addUnique(meta, cleanLower);
      continue;
    }

    // 2. Поиск по словарю типов тегов (tagMap)
    const type = tagMap ? (tagMap.get(lower) ?? tagMap.get(cleanLower)) : undefined;

    if (type === 1 && !GENERIC_NON_ARTIST_TAGS.has(cleanLower)) {
      addUnique(artist, cleanLower);
    } else if (type === 3) {
      addUnique(copyright, cleanLower);
    } else if (type === 4) {
      addUnique(character, cleanLower);
    } else if (type === 6 || META_KEYWORDS.has(cleanLower)) {
      addUnique(meta, cleanLower);
    } else {
      addUnique(general, originalTag);
    }
  }

  // Извлечение автора:
  // Приоритет 1: определенные теги художника
  // Приоритет 2: заранее переданный автор (например из tag_string_artist на Danbooru)
  // Приоритет 3: ссылка на источник (Pixiv ID, Twitter аккаунт и т.д.)
  let author = '';
  if (artist.length > 0) {
    author = artist.join(', ');
  } else if (initialAuthor && typeof initialAuthor === 'string' && initialAuthor.trim()) {
    author = initialAuthor.trim();
    // Добавляем в категорию artist если его там еще нет
    author.split(',').forEach(a => {
      const cleanA = a.trim().replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      if (cleanA) addUnique(artist, cleanA);
    });
  } else if (sourceUrl) {
    const authorFromSource = extractAuthorFromSource(tags, sourceUrl, '');
    if (authorFromSource) {
      author = authorFromSource;
      const cleanA = author.replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      if (cleanA) addUnique(artist, cleanA);
    }
  }

  return {
    tagDetails: { artist, copyright, character, general, meta },
    author
  };
}
