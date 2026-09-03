import fs from 'fs';
import path from 'path';
import { fetchSafe, discardResponse } from './network.js';
import { extractAuthor as extractAuthorFromSource, decodeHtmlEntities } from './tagHelpers.js';

// Cache of the global tag map (1 = artist, 3 = copyright, 4 = character, 0 = general, 6 = meta)
let globalTagMap = null;
let isLoadingMap = null;
let lastFetchedTime = 0;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_DIR = path.resolve('data/cache');
const TAGS_SUMMARY_CACHE_FILE = path.join(CACHE_DIR, 'tags_summary.json');

export const KNOWN_EXTRA_TAGS = {
  // Popular artists, animators and studios
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
  redrop: 1,
  wlop: 1,
  artgerm: 1,
  alp: 1,
  mignon: 1,
  cubex55: 1,
  fugtrup: 1,
  tororo: 1,
  fkey: 1,
  hews: 1,
  hiten: 1,
  sydsnap: 1,
  tiv: 1,
  reina: 1,
  ciloranko: 1,
  krenz_cushart: 1,
  mika_pikazo: 1,
  anmi: 1,
  rurudo: 1,
  mocha: 1,
  shirabii: 1,
  pocomi: 1,
  kantoku: 1,
  tony_taka: 1,

  // Popular franchises, publishers, studios and series (copyright)
  mihoyo: 3,
  hoyoverse: 3,
  'type-moon': 3,
  typemoon: 3,
  nintendo: 3,
  capcom: 3,
  bandai_namco: 3,
  square_enix: 3,
  sega: 3,
  konami: 3,
  atlus: 3,
  fromsoftware: 3,
  valve: 3,
  riot_games: 3,
  blizzard: 3,
  epic_games: 3,
  arc_system_works: 3,
  snk: 3,
  koei_tecmo: 3,
  marvel: 3,
  dc_comics: 3,
  disney: 3,
  sanrio: 3,
  studio_trigger: 3,
  trigger: 3,
  kyoto_animation: 3,
  kyoani: 3,
  cloverworks: 3,
  ufotable: 3,
  mappa: 3,
  'a-1_pictures': 3,
  wit_studio: 3,
  shaft: 3,
  bones: 3,
  madhouse: 3,
  toei_animation: 3,
  gainax: 3,
  sunrise: 3,
  doga_kobo: 3,
  'production_i.g': 3,
  'j.c.staff': 3,
  feel: 3,
  silver_link: 3,
  kuro_games: 3,
  yostar: 3,
  manjuu: 3,
  hypergryph: 3,
  shift_up: 3,
  project_moon: 3,
  hololive: 3,
  nijisanji: 3,
  vshojo: 3,
  genshin_impact: 3,
  honkai_star_rail: 3,
  honkai_impact_3rd: 3,
  zenless_zone_zero: 3,
  wuthering_waves: 3,
  blue_archive: 3,
  fate_grand_order: 3,
  'fate/grand_order': 3,
  'fate_(series)': 3,
  fate_stay_night: 3,
  azur_lane: 3,
  arknights: 3,
  nikke: 3,
  'goddess_of_victory:_nikke': 3,
  overwatch: 3,
  overwatch_2: 3,
  league_of_legends: 3,
  pokemon: 3,
  pocket_monsters: 3,
  touhou: 3,
  touhou_project: 3,
  vocaloid: 3,
  idolmaster: 3,
  the_idolmaster: 3,
  'the_idolm@ster': 3,
  'love_live!': 3,
  'love_live!_sunshine!!': 3,
  'love_live!_superstar!!': 3,
  granblue_fantasy: 3,
  kantai_collection: 3,
  chainsaw_man: 3,
  jujutsu_kaisen: 3,
  demon_slayer: 3,
  kimetsu_no_yaiba: 3,
  my_hero_academia: 3,
  boku_no_hero_academia: 3,
  naruto: 3,
  naruto_shippuuden: 3,
  one_piece: 3,
  bleach: 3,
  dragon_ball: 3,
  dragon_ball_z: 3,
  dragon_ball_super: 3,
  final_fantasy: 3,
  final_fantasy_vii: 3,
  final_fantasy_xiv: 3,
  persona: 3,
  persona_3: 3,
  persona_4: 3,
  persona_5: 3,
  nier: 3,
  nier_automata: 3,
  'nier:automata': 3,
  danganronpa: 3,
  rwby: 3,
  spy_x_family: 3,
  sousou_no_frieren: 3,
  frieren: 3,
  dungeon_meshi: 3,
  delicious_in_dungeon: 3,
  evangelion: 3,
  neon_genesis_evangelion: 3,
  cyberpunk: 3,
  cyberpunk_2077: 3,
  'cyberpunk:_edgerunners': 3,
  elden_ring: 3,
  dark_souls: 3,
  bloodborne: 3,
  monster_hunter: 3,
  zelda: 3,
  the_legend_of_zelda: 3,
  mario: 3,
  super_mario: 3,
  sonic_the_hedgehog: 3,
  street_fighter: 3,
  tekken: 3,
  guilty_gear: 3,
  dead_or_alive: 3,
  atelier: 3,
  tales_of: 3,
  xenoblade: 3,
  xenoblade_chronicles: 3,
  fire_emblem: 3,
  fire_emblem_heroes: 3,
  fire_emblem_three_houses: 3,
  girls_frontline: 3,
  'princess_connect!': 3,
  'princess_connect!_re:dive': 3,
  'bang_dream!': 3,
  project_sekai: 3,
  uma_musume: 3,
  uma_musume_pretty_derby: 3,
  'bocchi_the_rock!': 3,
  oshi_no_ko: 3,
  mushoku_tensei: 3,
  sword_art_online: 3,
  're:zero': 3,
  're:zero_kara_hajimeru_isekai_seikatsu': 3,
  konosuba: 3,
  fate: 3,
  hololive_en: 3,
  hololive_jp: 3,
  hololive_id: 3
};

export const LOCATION_BY_NOUNS = new Set([
  'window', 'bed', 'door', 'river', 'sea', 'ocean', 'water', 'pool', 'tree', 'trees',
  'wall', 'mirror', 'table', 'chair', 'couch', 'sofa', 'fireplace', 'fence', 'stairs',
  'beach', 'lake', 'road', 'car', 'counter', 'railing', 'pole', 'curtain', 'pillar',
  'bridge', 'balcony', 'desk', 'bookshelf', 'shelf', 'sink', 'bathtub', 'shower',
  'cliff', 'rock', 'forest', 'field', 'grass', 'bench', 'steps', 'gate', 'street'
]);

export const GENERIC_NON_ARTIST_TAGS = new Set([
  '2d', '3d', 'art', 'artwork', 'animation', 'video', 'sound', 'audio', 'highres', 'lowres', 
  'comic', 'parody', 'original', 'cosplay', 'edit', 'cg', 'illustration', 'sketch', 
  'webm', 'gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'psd', 'clip', 'sai', 'c4d', 'blend',
  'zip', 'rar', '7z', 'tar', 'pack', 'reward', 'tier', 'patreon', 'fanbox', 'fantia', 'boosty', 'gumroad', 'subscribestar',
  'ai_generated', 'ai', 'unknown', 'anonymous', 'various', 'bad_id', 'bad_link', 'translated', 'translation', 'sample', 'thumbnail',
  'throat', 'oral', 'solo', 'female', 'male', 'breasts', 'nipples', 'pussy', 'penis', 'anal', 'hentai', 'r18', 'nsfw', 'sfw',
  'selfie', 'wip', 'alt', 'version', 'ver', 'set', 'bundle', 'part', 'vol', 'volume',
  'preview', 'trailer', 'teaser', 'short', 'commission', 'leak', 'remastered', 'fan_animation', 'gameplay', 'no_ai', 'voiced',
  'overwatch', 'pokemon', 'genshin_impact', 'honkai_star_rail', 'zenless_zone_zero', 'wuthering_waves', 'resident_evil', 
  'final_fantasy', 'cyberpunk', 'nier', 'nier_automata', 'league_of_legends', 'touhou', 'fate', 'naruto', 'one_piece', 'bleach',
  'artist_request', 'artist request', 'source_request', 'source request', 'character_request', 'character request', 'copyright_request', 'meta_request',
  ...LOCATION_BY_NOUNS
]);

export const META_KEYWORDS = new Set([
  // Resolution and quality
  'highres', 'high_res', 'absurdres', 'superabsurdres', 'incredibly_absurdres', 'lowres', 'low_res', 'downscaled', 'lossless', '4k', '8k', 'hd', '60fps', 
  'ultra_high_res', 'bad_quality', 'poor_quality', 'huge_filesize', 'large_filesize', 'webp_artifacts', 'jpeg_artifacts', 'bad_aspect_ratio', 'dated',
  
  // Media types and formats
  'sound', 'audio', 'video', 'animated', 'animation', 'ugoira', 'web_audio', 'has_sound', 'with_sound', 
  'muted', 'loop', 'silent', 'mp4', 'webm', 'gif', 'flash', 'swf', 'apng', 'interactive',
  
  // Text, language and translations
  'translated', 'partially_translated', 'translation_request', 'commentary', 'commentary_request', 'partial_commentary',
  'check_commentary', 'check_my_note', 'annotated', 'hard_translated', 'text', 'subtitles', 'rus_sub', 'eng_sub', 
  'speech_bubble', 'watermark', 'sample', 'thumbnail', 'signature', 'username', 'artist_name', 'character_name', 'url', 'web_address', 
  'timestamp', 'twitter_username', 'pixiv_id', 'bad_pixiv_id', 'bad_id', 'bad_link', 'bad_source', 
  'source_request', 'source request', 'source_needed', 'tagme', 'duplicate', 'third-party_edit', 'edit', 'official_art', 
  'scan', 'magazine_scan', 'wallpaper', 'artbook', 'cover', 'doujinshi_cover', 'comic', 'manga', 'multi-panel', 
  'column_layout', 'page_number', 'omake', 'monochrome', 'greyscale', 'sketch', 'lineart', 'traditional_media', 'digital_media',

  // Platforms and monetization
  'patreon', 'patreon_reward', 'patreon_logo', 'patreon_username', 'fanbox', 'fanbox_reward', 
  'fantia', 'fantia_reward', 'boosty', 'gumroad', 'subscribestar', 'skeb', 'ci-en', 'afdian', 'ko-fi',
  'psd', 'clip', 'zip', 'rar', '7z', 'pack', 'reward', 'tier',

  // AI detection & metadata
  'ai_generated', 'ai_assisted', 'created_by_ai', 'stable_diffusion', 'novelai', 'midjourney', 'dall-e', 'dall-e_3', 'synthetic',

  // Tag requests
  'artist_request', 'artist request', 'character_request', 'character request', 'copyright_request', 'copyright request', 'meta_request', 'source_needed'
]);

const ARTIST_SUFFIXES = ['_(artist)', '_(creator)', '_(circle)', '_(studio)', '_(animator)', '_(mangaka)', '_(illustrator)'];
const COPYRIGHT_SUFFIXES = ['_(series)', '_(game)', '_(anime)', '_(manga)', '_(vtuber)', '_(novel)', '_(comic)', '_(franchise)', '_(project)', '_(visual_novel)', '_(light_novel)', '_(web_novel)', '_(mobile_game)'];
const META_SUFFIXES = ['_(medium)', '_(style)', '_(artwork)'];
const CHARACTER_SUFFIXES = ['_(character)', '_(cosplay)', '_(person)', '_(actor)', '_(actress)'];

const RESERVED_PAREN_WORDS = new Set([
  'artist', 'creator', 'circle', 'studio', 'animator', 'mangaka', 'illustrator', 'doujin_circle', 'cosplayer',
  'series', 'game', 'anime', 'manga', 'vtuber', 'novel', 'comic', 'franchise', 'project', 'visual_novel', 'light_novel', 'web_novel', 'mobile_game', 'company', 'label', 'universe',
  'medium', 'style', 'artwork',
  'character', 'cosplay', 'person', 'actor', 'actress',
  'fruit', 'food', 'animal', 'vehicle', 'object', 'clothing', 'instrument', 'weapon', 'anatomy', 'pose', 'hair', 'eyes', 'color', 'background', 'furniture', 'disambiguation'
]);

async function fetchAndCacheSummary(settings = {}) {
  try {
    // Try konachan.net first (reliable/unblocked), then yande.re, then konachan.com
    let res = await fetchSafe('https://konachan.net/tag/summary.json', { timeout: 3500, settings, site: 'konachan' }).catch(() => null);
    if (!res || !res.ok) {
      if (res) await discardResponse(res);
      res = await fetchSafe('https://yande.re/tag/summary.json', { timeout: 3500, settings, site: 'yandere' }).catch(() => null);
    }
    if (!res || !res.ok) {
      if (res) await discardResponse(res);
      res = await fetchSafe('https://konachan.com/tag/summary.json', { timeout: 3500, settings, site: 'konachan' }).catch(() => null);
    }

    if (res && res.ok) {
      const json = await res.json().catch(() => null);
      if (json && typeof json.data === 'string') {
        const entries = json.data.split(' ');
        const map = new Map();

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

        for (const [tag, type] of Object.entries(KNOWN_EXTRA_TAGS)) {
          map.set(tag.toLowerCase(), type);
        }

        globalTagMap = map;
        lastFetchedTime = Date.now();

        // Persist to local disk so future boots/restarts load instantly (10ms)
        try {
          if (!fs.existsSync(CACHE_DIR)) {
            fs.mkdirSync(CACHE_DIR, { recursive: true });
          }
          const serialized = JSON.stringify(Array.from(map.entries()));
          await fs.promises.writeFile(TAGS_SUMMARY_CACHE_FILE, serialized, 'utf8');
        } catch (writeErr) {
          console.warn('[TagClassifier] Не удалось сохранить tags_summary.json на диск:', writeErr.message);
        }
      }
    } else if (res) {
      await discardResponse(res);
    }
  } catch (err) {
    // Non-fatal, fallback to local dictionary
  } finally {
    isLoadingMap = null;
  }
  return globalTagMap;
}

export async function loadGlobalTagSummary(settings = {}) {
  // If memory map is fresh, return it immediately
  if (globalTagMap && globalTagMap.size > 1000 && Date.now() - lastFetchedTime < CACHE_TTL_MS) {
    return globalTagMap;
  }

  // 1. First run: attempt to load from local disk cache (near-instant ~15ms, provides all 83,000+ tags on boot)
  if (!globalTagMap) {
    try {
      if (fs.existsSync(TAGS_SUMMARY_CACHE_FILE)) {
        const raw = fs.readFileSync(TAGS_SUMMARY_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const map = new Map(parsed);
          for (const [tag, type] of Object.entries(KNOWN_EXTRA_TAGS)) {
            map.set(tag.toLowerCase(), type);
          }
          globalTagMap = map;
          lastFetchedTime = Date.now();
        }
      }
    } catch (e) {
      console.warn('[TagClassifier] Не удалось прочитать tags_summary.json с диска:', e.message);
    }
  }

  // If memory or disk map is populated, return it immediately and refresh in background if stale
  if (globalTagMap && globalTagMap.size > 1000) {
    if (Date.now() - lastFetchedTime >= CACHE_TTL_MS && !isLoadingMap) {
      isLoadingMap = fetchAndCacheSummary(settings);
    }
    return globalTagMap;
  }

  // Otherwise, initialize fallback dictionary and await network fetch
  if (!globalTagMap) {
    globalTagMap = new Map(Object.entries(KNOWN_EXTRA_TAGS));
  }

  if (isLoadingMap) {
    return await isLoadingMap;
  }

  isLoadingMap = fetchAndCacheSummary(settings);
  return await isLoadingMap;
}

/**
 * Universal post tag classification for all Booru sites (Gelbooru, Rule34, Danbooru, Moebooru, Safebooru, Dapi, Pawchive, Rule34Video)
 * @param {string[]} rawTags - Raw tags array
 * @param {string} sourceUrl - Source link (Pixiv, Twitter, etc.)
 * @param {string} initialAuthor - Author known in advance
 * @param {object} settings - Application settings (for proxy resolution)
 * @returns {Promise<{ tagDetails: { artist: string[], copyright: string[], character: string[], general: string[], meta: string[] }, author: string }>}
 */
export async function classifyPostTags(rawTags = [], sourceUrl = '', initialAuthor = '', settings = {}) {
  const tags = (Array.isArray(rawTags) ? rawTags : []).map(t => decodeHtmlEntities(String(t || '').trim())).filter(Boolean);
  const tagMap = await loadGlobalTagSummary(settings);

  const artist = [];
  const copyright = [];
  const character = [];
  const meta = [];
  const general = [];

  const detectedSeriesSet = new Set();

  const addUnique = (arr, val) => {
    if (val && !arr.includes(val)) arr.push(val);
  };

  // Determine potential source author handle to assist matching
  let sourceHandle = '';
  if (sourceUrl && typeof sourceUrl === 'string') {
    const rawSrcAuthor = extractAuthorFromSource(tags, sourceUrl, '');
    if (rawSrcAuthor) {
      sourceHandle = rawSrcAuthor.replace(/^[@pixiv:]+/, '').trim().toLowerCase();
    }
  }

  for (const tag of tags) {
    if (!tag) continue;
    const originalTag = String(tag).trim();
    const lower = originalTag.toLowerCase();

    // 1. Explicit prefixes
    if (lower.startsWith('artist:') || lower.startsWith('creator:') || lower.startsWith('author:') || lower.startsWith('draw:') || lower.startsWith('channel:') || lower.startsWith('uploader:')) {
      const clean = originalTag.replace(/^(artist|creator|author|draw|channel|uploader):/i, '').trim();
      if (clean && !GENERIC_NON_ARTIST_TAGS.has(clean.toLowerCase())) {
        addUnique(artist, clean);
      }
      continue;
    }

    // by_* is only an artist if not an English preposition location tag (e.g. by_window, by_bed, by_pool)
    if (lower.startsWith('by_')) {
      const candidate = lower.slice(3).trim();
      if (!LOCATION_BY_NOUNS.has(candidate) && !GENERIC_NON_ARTIST_TAGS.has(candidate) && candidate.length > 2) {
        const clean = originalTag.slice(3).trim();
        if (tagMap && tagMap.get(candidate) === 1) {
          addUnique(artist, clean);
          continue;
        } else if (!tagMap || tagMap.get(candidate) !== 0) {
          addUnique(artist, clean);
          continue;
        }
      }
    }

    if (lower.startsWith('copyright:') || lower.startsWith('series:')) {
      const clean = originalTag.replace(/^(copyright|series):/i, '').trim();
      addUnique(copyright, clean || originalTag);
      continue;
    }

    if (lower.startsWith('character:')) {
      const clean = originalTag.replace(/^character:/i, '').trim();
      addUnique(character, clean || originalTag);
      continue;
    }

    if (lower.startsWith('meta:') || lower.startsWith('service:')) {
      const clean = originalTag.replace(/^(meta|service):/i, '').trim();
      addUnique(meta, clean || originalTag);
      continue;
    }

    // 2. Specific suffixes
    if (ARTIST_SUFFIXES.some(s => lower.endsWith(s))) {
      addUnique(artist, originalTag);
      continue;
    }

    if (COPYRIGHT_SUFFIXES.some(s => lower.endsWith(s))) {
      addUnique(copyright, originalTag);
      continue;
    }

    if (META_SUFFIXES.some(s => lower.endsWith(s)) || META_KEYWORDS.has(lower)) {
      addUnique(meta, originalTag);
      continue;
    }

    if (CHARACTER_SUFFIXES.some(s => lower.endsWith(s))) {
      addUnique(character, originalTag);
      continue;
    }

    // 3. Tag type dictionary lookup (PRIORITY OVER HEURISTICS)
    const type = tagMap ? (tagMap.get(lower) ?? tagMap.get(lower.replace(/^by_/i, ''))) : undefined;

    if (type === 1 && !GENERIC_NON_ARTIST_TAGS.has(lower)) {
      addUnique(artist, originalTag);
      continue;
    } else if (type === 3) {
      addUnique(copyright, originalTag);
      continue;
    } else if (type === 4) {
      addUnique(character, originalTag);
      continue;
    } else if (type === 6 || META_KEYWORDS.has(lower)) {
      addUnique(meta, originalTag);
      continue;
    }

    // 3.5. Check if tag matches known initial author
    if (initialAuthor && typeof initialAuthor === 'string') {
      const cleanInitial = initialAuthor.replace(/^[@pixiv:]+/, '').trim().toLowerCase().replace(/[\s_.-]+/g, '_');
      const cleanTagLower = lower.replace(/[\s_.-]+/g, '_');
      if (cleanInitial && (cleanTagLower === cleanInitial || cleanTagLower === `artist:${cleanInitial}`)) {
        addUnique(artist, originalTag);
        continue;
      }
    }

    // 4. Check if tag matches source handle (e.g. source is twitter.com/_yozo and tag is yozo_(stanky) or yozo)
    if (sourceHandle && sourceHandle.length >= 2 && !GENERIC_NON_ARTIST_TAGS.has(lower)) {
      const cleanLowerHandle = sourceHandle.replace(/^[_\s]+|[_\s]+$/g, '');
      if (cleanLowerHandle.length >= 2) {
        if (lower === cleanLowerHandle || lower.startsWith(`${cleanLowerHandle}_(`) || lower.startsWith(`${cleanLowerHandle}_`)) {
          addUnique(artist, originalTag);
          continue;
        }
      }
    }

    // 5. Universal Booru parenthesized character heuristic: name_(series)
    const parenMatch = lower.match(/^(.+?)_\(([^)]+)\)$/);
    if (parenMatch) {
      const suffix = parenMatch[2].trim();
      const isReserved = RESERVED_PAREN_WORDS.has(suffix);
      if (!isReserved) {
        const isKnownFranchise = KNOWN_EXTRA_TAGS[suffix] === 3 || copyright.some(c => c.toLowerCase() === suffix);
        const matchesPostTag = tags.some(t => {
          const tLow = t.toLowerCase();
          return tLow !== lower && (tLow === suffix || tLow.includes(suffix));
        });

        if (isKnownFranchise || matchesPostTag || suffix.length > 3) {
          addUnique(character, originalTag);
          detectedSeriesSet.add(suffix);
          continue;
        }
      }
    }

    // Default to general tag
    general.push(originalTag);
  }

  // 6. Post-pass: check if any general tags match detected series from character tags
  if (detectedSeriesSet.size > 0) {
    for (let i = general.length - 1; i >= 0; i--) {
      const gLower = general[i].toLowerCase();
      if (detectedSeriesSet.has(gLower) || KNOWN_EXTRA_TAGS[gLower] === 3) {
        addUnique(copyright, general[i]);
        general.splice(i, 1);
      }
    }
  }

  // 7. Author extraction and synchronization
  let author = '';
  if (initialAuthor && typeof initialAuthor === 'string' && initialAuthor.trim()) {
    author = initialAuthor.trim();
    author.split(',').forEach(a => {
      const cleanA = a.trim().replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      if (cleanA && !artist.includes(cleanA) && !artist.includes(a.trim())) {
        artist.push(cleanA);
      }
    });
  } else if (artist.length > 0) {
    const validArtists = artist
      .map(a => a.replace(/^(artist|creator|author|draw|channel|uploader):/i, '').replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/i, '').trim())
      .filter(a => a && !GENERIC_NON_ARTIST_TAGS.has(a.toLowerCase()) && !LOCATION_BY_NOUNS.has(a.toLowerCase()));
    if (validArtists.length > 0) {
      author = validArtists.join(', ');
    }
  } else if (sourceUrl) {
    const authorFromSource = extractAuthorFromSource(tags, sourceUrl, '');
    if (authorFromSource) {
      author = authorFromSource;
      const cleanA = author.replace(/^[@pixiv:]+/, '').replace(/\s+/g, '_');
      if (cleanA && !artist.includes(cleanA)) {
        artist.push(cleanA);
      }
    }
  }

  // Sort artist array so that visual creators always come first and audio/VA contributors come last
  if (artist.length > 1) {
    artist.sort((a, b) => {
      const aAudio = /_?\((audio|sfx|sound|voice|va|music)\)$/i.test(a) ? 1 : 0;
      const bAudio = /_?\((audio|sfx|sound|voice|va|music)\)$/i.test(b) ? 1 : 0;
      return aAudio - bAudio;
    });
  }

  return {
    tagDetails: { artist, copyright, character, general, meta },
    author
  };
}
