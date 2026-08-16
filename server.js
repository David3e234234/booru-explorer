import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import dns from 'dns';
import open from 'open';
import AdmZip from 'adm-zip';

// Принудительный выбор IPv4 в первую очередь для надежных сетевых запросов к зарубежным Booru
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Защита от аварийного падения сервера при разрывах сетевых потоков
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET' || err.message?.includes('terminated') || err.message?.includes('aborted')) {
    // Штатный разрыв соединения клиентом или CDN
    return;
  }
  console.error('[Process UncaughtException]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process UnhandledRejection]', reason);
});

// Директория хранилища и кэша
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const THUMBS_DIR = path.join(CACHE_DIR, 'thumbnails');
const VIDEOS_DIR = path.join(CACHE_DIR, 'videos');

[DATA_DIR, CACHE_DIR, THUMBS_DIR, VIDEOS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
const FAVORITE_AUTHORS_FILE = path.join(DATA_DIR, 'favorite_authors.json');
const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ==========================================
// 🚀 IN-MEMORY LRU/TTL КЭШ И ДИСКОВЫЙ МЕНЕДЖЕР
// ==========================================
class MemoryCache {
  constructor(maxItems = 300, defaultTtlMs = 6 * 60 * 1000) {
    this.cache = new Map();
    this.maxItems = maxItems;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // LRU сдвиг
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now > v.expiresAt) this.cache.delete(k);
    }
    return this.cache.size;
  }
}

export const apiPostsCache = new MemoryCache(400, 6 * 60 * 1000); // 6 минут кэш постов
export const tagAutocompleteCache = new MemoryCache(600, 30 * 60 * 1000); // 30 минут кэш тегов

function getDirectoryStats(dirPath) {
  let totalBytes = 0;
  const fileList = [];
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            totalBytes += stats.size;
            fileList.push({ path: fullPath, size: stats.size, mtime: stats.mtimeMs });
          }
        } catch {}
      }
    }
  } catch {}
  return { totalBytes, fileList };
}

export function cleanDiskCacheIfNeeded(maxBytes = 1.5 * 1024 * 1024 * 1024) {
  try {
    const thumbs = getDirectoryStats(THUMBS_DIR);
    const videos = getDirectoryStats(VIDEOS_DIR);
    let totalBytes = thumbs.totalBytes + videos.totalBytes;

    if (totalBytes > maxBytes) {
      logInfo('Cache', `Превышен лимит кэша (${(totalBytes / 1024 / 1024).toFixed(1)} MB / ${(maxBytes / 1024 / 1024).toFixed(1)} MB). Автоочистка LRU...`);
      const allFiles = [...thumbs.fileList, ...videos.fileList];
      allFiles.sort((a, b) => a.mtime - b.mtime);

      for (const f of allFiles) {
        if (totalBytes <= maxBytes * 0.75) break;
        try {
          fs.unlinkSync(f.path);
          totalBytes -= f.size;
        } catch {}
      }
      logInfo('Cache', `Автоочистка завершена. Новый размер кэша: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
    }
  } catch (err) {
    logError('Cache', 'Ошибка очистки дискового кэша', err);
  }
}

// Периодическая проверка раз в 30 минут
setInterval(() => cleanDiskCacheIfNeeded(), 30 * 60 * 1000);

const pendingWrites = new Map();
function writeJsonFileAsync(filePath, data, debounceMs = 150) {
  if (pendingWrites.has(filePath)) {
    clearTimeout(pendingWrites.get(filePath));
  }
  const timer = setTimeout(async () => {
    pendingWrites.delete(filePath);
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      logError('Storage', `Ошибка асинхронной записи ${filePath}`, err);
    }
  }, debounceMs);
  pendingWrites.set(filePath, timer);
}

const DEFAULT_AI_TAGS = [
  'ai_generated',
  'ai_art',
  'novelai',
  'stable_diffusion',
  'midjourney',
  'dall-e',
  'dall-e_3',
  'synthetic',
  'ai_assisted',
  'source_ai',
  'ai-generated',
  'generated_by_ai',
  'nai',
  'sd_xl',
  'comfyui',
  'pony_diffusion',
  'flux.1',
  'created_by_ai',
  'image_generation_model'
];

const FURRY_TAGS = [
  'furry',
  'anthro',
  'feral',
  'scalie',
  'animal_humanoid',
  'beast',
  'kemono',
  'furry_male',
  'furry_female',
  'anthro_female',
  'anthro_male',
  'furred',
  'canine',
  'feline',
  'e621'
];

const PREGNANT_TAGS = [
  'pregnant',
  'pregnancy',
  'hyper_pregnancy',
  'impregnation',
  'inflation',
  'belly_expansion',
  'maternity',
  'pregnant_belly',
  'birthing',
  'unbirth',
  'oviposition'
];

// Словари телосложения и типажей
const CURVY_INCLUDE_TAGS = [
  'milf',
  'mature_female',
  'mature',
  'tall_female',
  'tall',
  'curvy',
  'curvy_female',
  'wide_hips',
  'thick_thighs',
  'huge_breasts',
  'gigantic_breasts',
  'large_breasts',
  'big_breasts',
  'voluptuous',
  'plump',
  'chubby',
  'bbw',
  'mother',
  'housewife',
  'office_lady',
  'teacher',
  'cow_girl'
];

const CURVY_EXCLUDE_TAGS = [
  'loli',
  'shota',
  'petite',
  'flat_chest',
  'underage',
  'child',
  'kindergarten',
  'elementary_school_student',
  'middle_school_student',
  'chibi',
  'toddler',
  'preschooler'
];

const PETITE_INCLUDE_TAGS = [
  'loli',
  'shota',
  'petite',
  'flat_chest',
  'small_breasts',
  'short_female',
  'short_stature',
  'smol',
  'chibi',
  'schoolgirl',
  'young',
  'teenager',
  'underage',
  'middle_school_student',
  'elementary_school_student',
  'junior_high_school_student',
  'high_school_student',
  'preschooler',
  'kindergarten',
  'toddler'
];

const PETITE_EXCLUDE_TAGS = [
  'milf',
  'mature_female',
  'mature',
  'tall_female',
  'huge_breasts',
  'gigantic_breasts',
  'large_breasts',
  'big_breasts',
  'voluptuous',
  'curvy',
  'bbw'
];

const DEFAULT_SETTINGS = {
  theme: 'dark',
  gridColumns: 'auto',
  aiFilter: 'no-ai', // 'all', 'no-ai', 'only-ai'
  ratingFilter: 'all', // 'all', 'nsfw', 'sfw'
  typeFilter: 'all', // 'all', 'video', 'image'
  ageFilter: 'all', // 'all', 'adult', 'young'
  hideFurry: true,
  hidePregnant: true,
  showVideoStatusBanner: true,
  aiTags: DEFAULT_AI_TAGS,
  blacklist: ['guro', 'scat', 'snuff', 'vomit', 'fart'],
  videoAutoplayHover: true,
  videoAutoplayMobile: true,
  videoAutoplayViewer: true,
  previewQuality: 'medium', // 'low', 'medium', 'high', 'original'
  videoMutedDefault: true,
  itemsPerPage: 100,
  proxyVideoDefault: true,
  enablePaheal: true,
  defaultSite: 'danbooru',
  rule34ApiKey: '',
  rule34UserId: '',
  gelbooruApiKey: '',
  gelbooruUserId: '',
  danbooruApiKey: '',
  danbooruLogin: ''
};

// Информативный логгер
function logInfo(category, message, extra = '') {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] [${category}] ${message} ${extra ? JSON.stringify(extra) : ''}`);
}

function logError(category, message, error = null) {
  const time = new Date().toLocaleTimeString();
  console.error(`[${time}] ❌ [${category}] ${message}`, error ? (error.message || error) : '');
}

function readJsonFile(filePath, defaultData) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    logError('Storage', `Ошибка чтения ${filePath}`, err);
  }
  return defaultData;
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logError('Storage', `Ошибка записи ${filePath}`, err);
    return false;
  }
}

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false
}));

const SITES = {
  danbooru: {
    id: 'danbooru',
    name: 'Danbooru',
    baseUrl: 'https://danbooru.donmai.us',
    rating: 'all',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#3b82f6',
    description: 'Золотой стандарт каталогизации аниме и манга артов'
  },
  rule34video: {
    id: 'rule34video',
    name: 'Rule34Video',
    baseUrl: 'https://rule34video.com',
    rating: 'nsfw',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#ef4444',
    description: 'Крупнейший архив 3D/2D видеоанимаций в высоком качестве'
  },
  yandere: {
    id: 'yandere',
    name: 'Yande.re',
    baseUrl: 'https://yande.re',
    rating: 'all',
    supportsVideo: false,
    supportsTags: true,
    accentColor: '#ec4899',
    description: 'Высочайшее качество, сканы артбуков и обои без сжатия'
  },
  safebooru: {
    id: 'safebooru',
    name: 'Safebooru',
    baseUrl: 'https://safebooru.org',
    rating: 'safe',
    supportsVideo: false,
    supportsTags: true,
    accentColor: '#10b981',
    description: 'Чистый безопасный каталог без откровенного 18+ контента'
  },
  konachan: {
    id: 'konachan',
    name: 'Konachan',
    baseUrl: 'https://konachan.net',
    rating: 'safe_questionable',
    supportsVideo: false,
    supportsTags: true,
    accentColor: '#f97316',
    description: 'Аниме-обои и иллюстрации сверхвысокого разрешения'
  },
  rule34: {
    id: 'rule34',
    name: 'Rule34 (Paheal / XXX)',
    baseUrl: 'https://rule34.paheal.net',
    rating: 'nsfw',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#aae5a4',
    description: 'Огромный архив 18+ артов, анимаций и комиксов'
  },
  gelbooru: {
    id: 'gelbooru',
    name: 'Gelbooru',
    baseUrl: 'https://gelbooru.com',
    rating: 'all',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#6366f1',
    description: 'Каталог артов (поддержка API ключа в Настройках)'
  },
  xbooru: {
    id: 'xbooru',
    name: 'Xbooru',
    baseUrl: 'https://xbooru.com',
    rating: 'nsfw',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#f43f5e',
    description: '18+ хентай-архив на движке DAPI с быстрой выдачей'
  },
  hypnohub: {
    id: 'hypnohub',
    name: 'Hypnohub',
    baseUrl: 'https://hypnohub.net',
    rating: 'all',
    supportsVideo: true,
    supportsTags: true,
    accentColor: '#8b5cf6',
    description: 'Тематический Booru-архив с открытым DAPI каталогом'
  }
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 BooruExplorer/3.0';

/**
 * Безопасный парсер JSON ответа от внешних Booru API.
 * Предотвращает падения 'Unexpected end of JSON input' при пустых ответах, HTML-ошибках или сбоях сети.
 */
function safeJsonParse(text, fallback = null) {
  if (!text || typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<') || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return fallback;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return fallback;
  }
}

function checkIsAi(tagsArray, aiTagsList) {
  if (!Array.isArray(tagsArray)) return false;
  const lowerTags = tagsArray.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : ''));
  const checkList = (aiTagsList && aiTagsList.length > 0 ? aiTagsList : DEFAULT_AI_TAGS).map(t => t.toLowerCase().trim());
  return lowerTags.some(tag => checkList.includes(tag) || tag.includes('ai_gen') || tag.includes('novelai') || tag.includes('stable_diffusion') || tag.includes('midjourney'));
}

const SOUND_KEYWORDS = ['sound', 'audio', 'has_audio', 'with_sound', 'has_sound', 'music', 'voiced', 'voice', 'sound_warning', 'audible'];

function checkMediaTypes(url, fileExt = '', rawTags = []) {
  const lowerTags = Array.isArray(rawTags) ? rawTags.map(t => (typeof t === 'string' ? t.toLowerCase().trim() : '')) : [];
  const tagsStr = lowerTags.join(' ');
  const combined = ((url || '') + ' ' + (fileExt || '') + ' ' + tagsStr).toLowerCase();
  const isVideo = combined.includes('.mp4') || combined.includes('.webm') || combined.includes('.mkv') || combined.includes('.mov') || combined.includes('.m4v') || tagsStr.includes('video') || tagsStr.includes('animated') || tagsStr.includes('ugoira');
  const isGif = combined.includes('.gif') && !isVideo;
  const hasSound = isVideo && (lowerTags.some(t => SOUND_KEYWORDS.includes(t)) || combined.includes('has_audio') || combined.includes('with_sound') || combined.includes('sound_warning'));
  let ext = fileExt ? fileExt.toLowerCase().replace('.', '') : '';
  if (!ext && url) {
    const cleanUrl = url.split('?')[0];
    const match = cleanUrl.match(/\.([a-z0-9]+)$/i);
    if (match) ext = match[1].toLowerCase();
  }
  return { isVideo, isGif, hasSound, fileExt: ext || (isVideo ? 'mp4' : isGif ? 'gif' : 'jpg') };
}

function getFfmpegHeaders(targetUrl) {
  let referer = 'https://danbooru.donmai.us/';
  let authHeader = '';
  const currentSettings = getSettings();
  try {
    const parsed = new URL(targetUrl);
    if (parsed.hostname.includes('rule34video.com')) referer = 'https://rule34video.com/';
    else if (parsed.hostname.includes('paheal.net') || parsed.hostname.includes('paheal-cdn.net')) referer = 'https://rule34.paheal.net/';
    else if (parsed.hostname.includes('rule34.xxx')) referer = 'https://rule34.xxx/';
    else if (parsed.hostname.includes('donmai.us')) {
      referer = 'https://danbooru.donmai.us/';
      if (currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
        authHeader = `Authorization: Basic ${Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64')}\r\n`;
      }
    } else if (parsed.hostname.includes('yande.re')) referer = 'https://yande.re/';
    else if (parsed.hostname.includes('konachan')) referer = 'https://konachan.net/';
    else if (parsed.hostname.includes('gelbooru.com')) referer = 'https://gelbooru.com/';
    else if (parsed.hostname.includes('safebooru.org')) referer = 'https://safebooru.org/';
    else if (parsed.hostname.includes('xbooru.com')) referer = 'https://xbooru.com/';
    else if (parsed.hostname.includes('hypnohub.net')) referer = 'https://hypnohub.net/';
    else referer = `${parsed.protocol}//${parsed.host}/`;
  } catch {}
  return `User-Agent: ${BROWSER_USER_AGENT}\r\nReferer: ${referer}\r\n${authHeader}`;
}

function resolvePreviewUrl(previewUrl, fileUrl, sampleUrl, isVideo) {
  const isVideoExt = (url) => {
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return clean.endsWith('.mp4') || clean.endsWith('.webm') || clean.endsWith('.zip') || clean.endsWith('.mkv') || clean.endsWith('.mov') || clean.endsWith('.m4v');
  };

  if (!previewUrl || isVideoExt(previewUrl)) {
    if (isVideo && (fileUrl || sampleUrl)) {
      return `/api/video-thumbnail?url=${encodeURIComponent(fileUrl || sampleUrl)}`;
    }
    return (!isVideo && sampleUrl && !isVideoExt(sampleUrl)) ? sampleUrl : (fileUrl || '');
  }
  return previewUrl;
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BOORU_USER_AGENT = 'BooruExplorer/3.0 (by booruexplorer)';

async function fetchSafe(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 25000);
  const isBrowserTarget = url.includes('rule34video.com') || url.includes('rule34.xxx') || url.includes('paheal') || url.includes('gelbooru.com') || url.includes('xbooru.com') || url.includes('hypnohub.net');
  const ua = isBrowserTarget ? BROWSER_USER_AGENT : BOORU_USER_AGENT;
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/xml, text/html, */*',
        ...(options.headers || {})
      }
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Умная адаптация и нормализация тегов для разных Booru источников:
 * - Преобразует теги со скобками 'hu_tao_(genshin_impact)' -> 'hu_tao genshin_impact' для сайтов без скобок
 * - Применяет алиасы (petite -> small_breasts)
 * - Учитывает фильтр возраста (ageFilter)
 */
function adaptTagsForSite(site, rawTags = '', ageFilter = 'all', typeFilter = 'all') {
  let tags = (rawTags || '').trim();

  // 1. Адаптация тегов со скобками (например: hu_tao_(genshin_impact), hu tao (genshin impact))
  if (site !== 'danbooru' && tags) {
    // Преобразуем name_(franchise) или name (franchise) в 'name franchise'
    tags = tags.replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2');
    tags = tags.replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2');
    // Удаляем любые висящие скобки
    tags = tags.replace(/[()]/g, '');
  }

  // 2. Алиасы тегов для совместимости с Danbooru
  if (site === 'gelbooru' || site === 'rule34' || site === 'safebooru' || site === 'yandere' || site === 'konachan' || site === 'rule34video' || site === 'xbooru' || site === 'hypnohub') {
    tags = tags.replace(/\bpetite\b/gi, 'small_breasts');
  }

  const tagList = tags.split(/\s+/).filter(Boolean);

  // 3. Подмешивание тегов телосложения / типажей
  if (ageFilter === 'adult') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
      if (!tagList.some(t => t.startsWith('-loli'))) tagList.push('-loli');
      if (!tagList.some(t => t.startsWith('-shota'))) tagList.push('-shota');
      if (!tagList.some(t => t.startsWith('-flat_chest'))) tagList.push('-flat_chest');
    }
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
        tagList.push('mature_female');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('mature');
      }
    }
  } else if (ageFilter === 'young') {
    if (site === 'rule34' || site === 'gelbooru' || site === 'yandere' || site === 'konachan' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
      if (!tagList.some(t => t.startsWith('-milf'))) tagList.push('-milf');
      if (!tagList.some(t => t.startsWith('-huge_breasts'))) tagList.push('-huge_breasts');
    }
    // Если поиск пустой, подмешиваем категорию миниатюрности
    if (tagList.length === 0) {
      if (site === 'rule34' || site === 'gelbooru' || site === 'safebooru' || site === 'xbooru' || site === 'hypnohub') {
        tagList.push('small_breasts');
      } else if (site === 'yandere' || site === 'konachan') {
        tagList.push('loli');
      }
    }
  }

  return tagList.join(' ');
}

/**
 * Универсальная нормализация даты к ISO строке
 */
function normalizeDate(rawDate) {
  if (!rawDate) return '';
  try {
    if (typeof rawDate === 'number') {
      // Если timestamp в секундах
      const d = rawDate < 10000000000 ? new Date(rawDate * 1000) : new Date(rawDate);
      if (!isNaN(d.getTime())) return d.toISOString();
    } else if (typeof rawDate === 'string') {
      const trimmed = rawDate.trim();
      if (!trimmed) return '';
      if (/^\d{10}$/.test(trimmed)) {
        const d = new Date(parseInt(trimmed, 10) * 1000);
        if (!isNaN(d.getTime())) return d.toISOString();
      } else if (/^\d{13}$/.test(trimmed)) {
        const d = new Date(parseInt(trimmed, 10));
        if (!isNaN(d.getTime())) return d.toISOString();
      }
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch {}
  return '';
}

/**
 * Универсальное извлечение автора из тегов, источника и полей поста
 */
function extractAuthor(rawTags = [], source = '', itemAuthor = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  
  // 1. Поиск в явных тегах автора
  const explicitArtistTags = tags.filter(t => 
    t.startsWith('artist:') || t.startsWith('creator:') || t.startsWith('author:') || t.startsWith('draw:')
  ).map(t => t.replace(/^(artist|creator|author|draw):/, ''));
  if (explicitArtistTags.length > 0) {
    return explicitArtistTags.join(', ');
  }

  // 2. Поиск тегов со специальными маркерами: name_(artist), name_(creator), by_name, etc.
  const markerArtistTags = tags.filter(t => 
    t.endsWith('_(artist)') || t.endsWith('_(creator)') || t.endsWith('_(circle)') || t.endsWith('_(studio)') || t.startsWith('by_')
  ).map(t => t.replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/, ''));
  if (markerArtistTags.length > 0) {
    return markerArtistTags.join(', ');
  }

  // 3. Извлечение автора из ссылки источника (source)
  if (source && typeof source === 'string') {
    const s = source.trim();
    const twitterMatch = s.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)(?:\/status|\/|$)/i);
    if (twitterMatch && !['intent', 'i', 'home', 'search', 'post', 'status'].includes(twitterMatch[1].toLowerCase())) {
      return `@${twitterMatch[1]}`;
    }
    const pixivUserMatch = s.match(/pixiv\.net\/(?:en\/)?users\/(\d+)/i) || s.match(/pixiv\.me\/([a-zA-Z0-9_-]+)/i);
    if (pixivUserMatch) {
      return `pixiv:${pixivUserMatch[1]}`;
    }
    const artstationMatch = s.match(/artstation\.com\/([a-zA-Z0-9_-]+)/i);
    if (artstationMatch && !['artwork', 'projects', 'artist'].includes(artstationMatch[1].toLowerCase())) {
      return artstationMatch[1];
    }
    const deviantArtMatch = s.match(/deviantart\.com\/([a-zA-Z0-9_-]+)/i);
    if (deviantArtMatch && !['art', 'tag', 'topic', 'view'].includes(deviantArtMatch[1].toLowerCase())) {
      return deviantArtMatch[1];
    }
    const fanboxMatch = s.match(/([a-zA-Z0-9_-]+)\.fanbox\.cc/i);
    if (fanboxMatch) {
      return fanboxMatch[1];
    }
    const fantiaMatch = s.match(/fantia\.jp\/fanclubs\/(\d+)/i);
    if (fantiaMatch) {
      return `fantia:${fantiaMatch[1]}`;
    }
    const patreonMatch = s.match(/patreon\.com\/([a-zA-Z0-9_-]+)/i);
    if (patreonMatch && !['posts', 'join'].includes(patreonMatch[1].toLowerCase())) {
      return `patreon:${patreonMatch[1]}`;
    }
    const skebMatch = s.match(/skeb\.jp\/@([a-zA-Z0-9_-]+)/i);
    if (skebMatch) {
      return `@${skebMatch[1]}`;
    }
  }

  // 4. Использование поля itemAuthor если оно не мусорное
  if (itemAuthor && typeof itemAuthor === 'string') {
    const cleanAuthor = itemAuthor.trim();
    const isBad = !cleanAuthor || cleanAuthor === '0' || cleanAuthor === 'null' || cleanAuthor === 'undefined' || cleanAuthor.toLowerCase() === 'anonymous' || /^\d+$/.test(cleanAuthor);
    if (!isBad) {
      return cleanAuthor;
    }
  }

  return '';
}

/**
 * Умная классификация тегов по категориям
 */
function classifyTags(rawTags = [], author = '') {
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const artist = [];
  const character = [];
  const copyright = [];
  const meta = [];
  const general = [];

  if (author) {
    author.split(',').forEach(a => {
      const clean = a.trim().replace(/^@/, '').replace(/^pixiv:/, '').replace(/\s+/g, '_');
      if (clean && !artist.includes(clean)) artist.push(clean);
    });
  }

  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (t.startsWith('artist:') || t.endsWith('_(artist)') || t.endsWith('_(creator)') || t.startsWith('by_') || t.endsWith('_(circle)') || t.endsWith('_(studio)')) {
      const clean = tag.replace(/^(artist|creator|author|draw):/, '').replace(/_?\((artist|creator|circle|studio)\)$/i, '').replace(/^by_/, '');
      if (!artist.includes(clean)) artist.push(clean);
    } else if (t.startsWith('character:') || t.endsWith('_(character)') || t.endsWith('_(cosplay)')) {
      const clean = tag.replace(/^character:/, '').replace(/_?\((character|cosplay)\)$/i, '');
      if (!character.includes(clean)) character.push(clean);
    } else if (t.startsWith('copyright:') || t.endsWith('_(series)') || t.endsWith('_(game)') || t.endsWith('_(anime)') || t.endsWith('_(manga)') || t.endsWith('_(vtuber)') || t.endsWith('_(novel)')) {
      const clean = tag.replace(/^copyright:/, '').replace(/_?\((series|game|anime|manga|vtuber|novel)\)$/i, '');
      if (!copyright.includes(clean)) copyright.push(clean);
    } else if (t.startsWith('meta:') || ['highres', 'absurdres', '4k', 'sound', 'audio', 'video', 'animated', 'ugoira', 'translated', 'commentary', 'tagme'].includes(t)) {
      const clean = tag.replace(/^meta:/, '');
      if (!meta.includes(clean)) meta.push(clean);
    } else {
      general.push(tag);
    }
  }

  return { artist, character, copyright, general, meta };
}

// 1. Danbooru (JSON REST)
async function fetchDanbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all' } = params;
  const userTagList = tags.trim().split(/\s+/).filter(Boolean);
  const queryTags = [];
  
  const prioritizeUserTags = settings?.prioritizeUserTags === true;
  const deepFetchPagesSetting = settings?.deepFetchPages ? parseInt(settings.deepFetchPages, 10) : 2;

  // Если приоритет у ручных тегов - сначала добавляем их
  if (prioritizeUserTags) {
    for (const t of userTagList) {
      if (queryTags.length < 2) queryTags.push(t);
    }
  }

  // Приоритет Видео/звук
  if (typeFilter === 'audio' || typeFilter === 'sound') {
    if (queryTags.length < 2) queryTags.push('sound');
  } else if (typeFilter === 'video') {
    if (queryTags.length < 2) queryTags.push('animated');
  }

  // Если ручные теги не в приоритете - добавляем их после медиа-фильтра
  if (!prioritizeUserTags) {
    for (const t of userTagList) {
      if (queryTags.length < 2) queryTags.push(t);
    }
  }

  // Приоритет Сортировка
  if (queryTags.length < 2) {
    if (category === 'top') queryTags.push('order:rank');          // Топ всех времён (индексированный рейтинг)
    else if (category === 'popular') queryTags.push('order:rank_week'); // Тренды за неделю
    else if (category === 'random') queryTags.push('order:random');
  }

  // Приоритет Рейтинг
  if (queryTags.length < 2) {
    if (ratingFilter === 'nsfw') queryTags.push('rating:q,e');
    else if (ratingFilter === 'sfw') queryTags.push('rating:g,s');
  }

  const isTagsDropped = userTagList.length + (typeFilter !== 'all' ? 1 : 0) + (ratingFilter !== 'all' ? 1 : 0) > 2;
  const shouldDeepFetch = isTagsDropped || deepFetchPagesSetting > 1;
  const fetchLimit = shouldDeepFetch ? Math.max(limit, 200) : limit;

  const finalTags = queryTags.join(' ');
  let allData = [];

  logInfo('Danbooru', `Поиск в API: tags="${finalTags}", deepFetch=${shouldDeepFetch ? deepFetchPagesSetting + ' стр.' : 'выкл'}, userPriority=${prioritizeUserTags}`);

  // Вспомогательная функция быстрой оценки соответствия поста
  const isPostMatch = (item) => {
    if (item.is_banned) return false;
    const rawTags = (item.tag_string || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (userTagList.length > 0) {
      const hasAll = userTagList.every(t => {
        const clean = t.toLowerCase();
        if (clean.startsWith('-')) return !rawTags.includes(clean.slice(1));
        if (clean.includes(':')) return true;
        return rawTags.includes(clean);
      });
      if (!hasAll) return false;
    }
    if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
      const variants = item.media_asset?.variants || [];
      const hasVideoVariant = variants.some(v => v.file_ext === 'mp4' || v.file_ext === 'webm' || v.url?.includes('.mp4') || v.url?.includes('.webm'));
      const isVidExt = item.file_ext === 'mp4' || item.file_ext === 'webm' || item.file_ext === 'zip' || (item.file_url && (item.file_url.endsWith('.mp4') || item.file_url.endsWith('.webm')));
      const isAnimTag = rawTags.includes('animated') || rawTags.includes('video') || rawTags.includes('ugoira');
      if (!hasVideoVariant && !isVidExt && !isAnimTag) return false;
    }
    if (ratingFilter === 'nsfw') {
      const r = (item.rating || '').toLowerCase();
      if (r !== 'e' && r !== 'q' && r !== 'explicit' && r !== 'questionable' && r !== 'sensitive') return false;
    } else if (ratingFilter === 'sfw') {
      const r = (item.rating || '').toLowerCase();
      if (r !== 's' && r !== 'g' && r !== 'general') return false;
    }
    if (params.ageFilter === 'adult') {
      if (CURVY_EXCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
      if (!userTagList.length && !CURVY_INCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
    } else if (params.ageFilter === 'young') {
      if (PETITE_EXCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
      if (!PETITE_INCLUDE_TAGS.some(t => rawTags.includes(t))) return false;
    }
    return true;
  };

  if (shouldDeepFetch) {
    const minDesiredPosts = 50; // Минимальная цель выдачи
    const maxIterations = Math.max(deepFetchPagesSetting * 2, 12); // До 12-15 страниц по 200 (до 3000 постов)
    let currentCursor = '';
    let matchedCount = 0;
    
    if (page > 1) {
      const startPageNum = (page - 1) * deepFetchPagesSetting + 1;
      if (startPageNum <= 5) {
        currentCursor = `page=${startPageNum}`;
      }
    }

    const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';

    for (let i = 0; i < maxIterations; i++) {
      let pageParam = currentCursor || `page=${(page - 1) * deepFetchPagesSetting + 1 + i}`;
      const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(finalTags)}&limit=${fetchLimit}${pageParam ? '&' + pageParam : ''}${authParam}`;
      
      let data = null;
      for (let retry = 0; retry < 2; retry++) {
        try {
          if (i > 0 || retry > 0) await new Promise(r => setTimeout(r, 150));
          const res = await fetchSafe(url);
          if (!res.ok) {
            if (res.status === 429) {
              await new Promise(r => setTimeout(r, 600));
              continue;
            }
            break;
          }
          const text = await res.text();
          const parsed = safeJsonParse(text, null);
          if (Array.isArray(parsed)) {
            data = parsed;
            break;
          }
        } catch (err) {
          if (retry === 0) {
            await new Promise(r => setTimeout(r, 300));
            continue;
          }
          logError('Danbooru', `Ошибка курсорного поиска на шаге ${i + 1}`, err);
          break;
        }
      }

      if (!data || data.length === 0) break;
      allData.push(...data);
      
      for (const item of data) {
        if (isPostMatch(item)) matchedCount++;
      }

      const ids = data.map(d => d.id).filter(id => typeof id === 'number');
      if (ids.length > 0) {
        const minId = Math.min(...ids);
        currentCursor = `page=b${minId}`;
      } else {
        break;
      }

      // Если уже набрали 50+ подходящих постов — прекращаем углубление
      if (matchedCount >= minDesiredPosts && i >= deepFetchPagesSetting - 1) {
        break;
      }

      if (data.length < fetchLimit) {
        // Конец архива
        break;
      }
    }
  } else {
    const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
      ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
      : '';
    const url = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(finalTags)}&page=${page}&limit=${fetchLimit}${authParam}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data)) allData = data;
      } else {
        logError('Danbooru', `API статус: ${res.status}`);
      }
    } catch (err) {
      logError('Danbooru', 'Ошибка стандартного fetch', err);
    }
  }

  // Если по прямому тегу ничего не найдено, а тег похож на автора/аккаунт (например ti_nira_n)
  if (allData.length === 0 && userTagList.length === 1 && !userTagList[0].includes(':')) {
    const rawTag = userTagList[0].replace(/^@/, '');
    const sourceQuery = `source:*${rawTag}*`;
    logInfo('Danbooru', `Прямой тег не вернул результатов, пробуем поиск по автору в источнике: tags="${sourceQuery}"`);
    try {
      const authParam = (settings?.danbooruLogin && settings?.danbooruApiKey)
        ? `&login=${encodeURIComponent(settings.danbooruLogin)}&api_key=${encodeURIComponent(settings.danbooruApiKey)}`
        : '';
      const fallbackUrl = `https://danbooru.donmai.us/posts.json?tags=${encodeURIComponent(sourceQuery)}&limit=${fetchLimit}${authParam}`;
      const res = await fetchSafe(fallbackUrl);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, null);
        if (Array.isArray(data) && data.length > 0) {
          allData = data;
        }
      }
    } catch (e) {}
  }

  logInfo('Danbooru', `Получено из API: ${allData.length} постов до локальной фильтрации`);

  const validItems = allData.filter(item => {
    if (item.is_banned) return false;
    const variants = item.media_asset?.variants || [];
    const hasMedia = !!(item.file_url || item.large_file_url || item.preview_file_url || variants.length > 0);
    return hasMedia;
  });

  return validItems.map(item => {
    const rawTags = (item.tag_string || '').split(' ').filter(Boolean);
    const variants = item.media_asset?.variants || [];
    
    // Поиск лучших MP4/WebM вариантов в media_asset (включая sample.webm / mp4 для Ugoira анимаций)
    const mp4_720p = variants.find(v => (v.type === '720p' || v.type === 'sample') && (v.file_ext === 'mp4' || v.url?.includes('.mp4')));
    const mp4_orig = variants.find(v => v.type === 'original' && (v.file_ext === 'mp4' || v.url?.includes('.mp4')));
    const webm_var = variants.find(v => (v.type === 'sample' || v.file_ext === 'webm') && (v.file_ext === 'webm' || v.url?.includes('.webm')));
    const any_video = mp4_720p || mp4_orig || webm_var || variants.find(v => v.file_ext === 'mp4' || v.file_ext === 'webm');

    // Извлечение ссылок
    let fileUrl = item.file_url || item.large_file_url || item.preview_file_url || '';
    let sampleUrl = item.large_file_url || item.file_url || '';

    if (any_video && any_video.url) {
      sampleUrl = mp4_720p?.url || webm_var?.url || any_video.url;
      fileUrl = mp4_orig?.url || any_video.url || fileUrl;
    }

    const { isVideo: checkVideo, isGif, hasSound: checkSound, fileExt: detectedExt } = checkMediaTypes(fileUrl, item.file_ext, rawTags);
    const hasPlayableVideo = (fileUrl.endsWith('.mp4') || fileUrl.endsWith('.webm') || sampleUrl.endsWith('.mp4') || sampleUrl.endsWith('.webm') || !!any_video);
    const isVideo = (checkVideo || hasPlayableVideo) && (!fileUrl.endsWith('.zip') || !!any_video);
    const hasSound = isVideo && (checkSound || rawTags.includes('sound') || rawTags.includes('audio') || variants.some(v => v.has_sound || v.audio));
    // Извлекаем все варианты изображений по типу для разных уровней качества
    const findImgVariant = (types) => variants.find(v => types.includes(v.type) && (v.file_ext === 'jpg' || v.file_ext === 'webp' || v.file_ext === 'png'));
    const thumb180 = findImgVariant(['180x180'])?.url || item.preview_file_url || '';
    const thumb360 = findImgVariant(['360x360'])?.url || '';
    const thumb720 = findImgVariant(['720x720'])?.url || '';
    const thumbSample = findImgVariant(['sample'])?.url || item.large_file_url || sampleUrl || '';
    const thumbOriginal = (!isVideo && (findImgVariant(['original'])?.url || item.file_url || fileUrl)) || '';
    const previewUrl = resolvePreviewUrl(thumb180 || item.preview_file_url, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList) || (item.tag_string_meta && item.tag_string_meta.includes('ai_generated'));

    const author = (item.tag_string_artist || '').split(' ').filter(Boolean).join(', ') || item.uploader_name || '';

    return {
      id: `danbooru_${item.id}`,
      originalId: String(item.id),
      site: 'danbooru',
      siteName: 'Danbooru',
      previewUrl,
      thumb180,
      thumb360,
      thumb720,
      thumbSample,
      thumbOriginal,
      sampleUrl,
      fileUrl,
      fileExt: isVideo ? (any_video?.file_ext || 'mp4') : detectedExt,
      isVideo,
      isGif,
      hasSound,
      author,
      tags: rawTags,
      tagDetails: {
        artist: (item.tag_string_artist || '').split(' ').filter(Boolean),
        character: (item.tag_string_character || '').split(' ').filter(Boolean),
        copyright: (item.tag_string_copyright || '').split(' ').filter(Boolean),
        general: (item.tag_string_general || '').split(' ').filter(Boolean),
        meta: (item.tag_string_meta || '').split(' ').filter(Boolean)
      },
      score: item.score || 0,
      rating: item.rating || 'g',
      width: item.image_width || 0,
      height: item.image_height || 0,
      source: item.source || '',
      createdAt: item.created_at || '',
      isAi
    };
  }).filter(p => p.fileUrl || p.sampleUrl || p.previewUrl);
}

// 2. Yande.re & Konachan
async function fetchMoebooru(siteId, siteUrl, siteName, params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    // Moebooru сайты не содержат видеороликов
    return [];
  }

  let finalTags = adaptTagsForSite(siteId, tags, ageFilter, typeFilter);
  let url = '';

  if (category === 'popular' && !tags) {
    url = `${siteUrl}/post/popular_by_week.json`;
  } else {
    if (category === 'top') finalTags = finalTags ? `${finalTags} order:score` : 'order:score';
    else if (category === 'popular') finalTags = finalTags ? `${finalTags} order:score` : 'order:score';
    else if (category === 'random') finalTags = finalTags ? `${finalTags} order:random` : 'order:random';

    if (ratingFilter === 'nsfw') {
      finalTags += ' rating:questionable,explicit';
    } else if (ratingFilter === 'sfw') {
      finalTags += ' rating:safe';
    }

    url = `${siteUrl}/post.json?tags=${encodeURIComponent(finalTags.trim())}&page=${page}&limit=${limit}`;
  }
  const res = await fetchSafe(url);
  if (!res.ok) {
    logError(siteName, `API статус: ${res.status}`);
    return [];
  }
  const text = await res.text();
  const data = safeJsonParse(text, []);
  if (!Array.isArray(data)) return [];

  return data.map(item => {
    const rawTags = (item.tags || '').split(' ').filter(Boolean);
    const fileUrl = item.file_url || item.jpeg_url || item.sample_url || item.preview_url;
    const sampleUrl = item.sample_url || item.jpeg_url || fileUrl;
    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList);
    const author = extractAuthor(rawTags, item.source, item.author);
    const tagDetails = classifyTags(rawTags, author);
    const createdAt = normalizeDate(item.created_at);

    return {
      id: `${siteId}_${item.id}`,
      originalId: String(item.id),
      site: siteId,
      siteName,
      previewUrl,
      sampleUrl,
      fileUrl,
      fileExt,
      isVideo,
      isGif,
      hasSound: isVideo && hasSound,
      author,
      tags: rawTags,
      tagDetails,
      score: item.score || 0,
      rating: item.rating || 's',
      width: parseInt(item.width, 10) || 0,
      height: parseInt(item.height, 10) || 0,
      source: item.source || '',
      createdAt,
      isAi
    };
  });
}

// 3. Safebooru
async function fetchSafebooru(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ratingFilter = 'all', ageFilter = 'all' } = params;
  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound' || ratingFilter === 'nsfw') {
    // Safebooru не содержит видео и NSFW контента
    return [];
  }

  let finalTags = adaptTagsForSite('safebooru', tags, ageFilter, typeFilter);
  if (category === 'top' || category === 'popular') finalTags += ' sort:score:desc';
  else if (category === 'random') finalTags += ' sort:random';

  const pid = Math.max(0, page - 1);
  const url = `https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(finalTags)}&pid=${pid}&limit=${limit}`;
  const res = await fetchSafe(url);
  if (!res.ok) return [];
  const text = await res.text();
  const data = safeJsonParse(text, []);
  const posts = Array.isArray(data) ? data : (data?.post || []);

  return posts.map(item => {
    const rawTags = (item.tags || '').split(' ').filter(Boolean);
    let fileUrl = item.file_url || '';
    if (fileUrl.startsWith('//')) fileUrl = 'https:' + fileUrl;
    else if (fileUrl.startsWith('/')) fileUrl = 'https://safebooru.org' + fileUrl;

    let sampleUrl = item.sample_url || fileUrl;
    if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;
    else if (sampleUrl.startsWith('/')) sampleUrl = 'https://safebooru.org' + sampleUrl;

    let previewUrlRaw = item.preview_url || item.sample_url || fileUrl;
    if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;
    else if (previewUrlRaw.startsWith('/')) previewUrlRaw = 'https://safebooru.org' + previewUrlRaw;

    const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
    const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
    const isAi = checkIsAi(rawTags, aiTagsList);
    const author = extractAuthor(rawTags, item.source, item.author || item.owner);
    const tagDetails = classifyTags(rawTags, author);
    const createdAt = normalizeDate(item.created_at || item.change);

    return {
      id: `safebooru_${item.id}`,
      originalId: String(item.id),
      site: 'safebooru',
      siteName: 'Safebooru',
      previewUrl,
      sampleUrl,
      fileUrl,
      fileExt,
      isVideo,
      isGif,
      hasSound: isVideo && hasSound,
      author,
      tags: rawTags,
      tagDetails,
      score: parseInt(item.score, 10) || 0,
      rating: item.rating || 's',
      width: parseInt(item.width, 10) || 0,
      height: parseInt(item.height, 10) || 0,
      source: item.source || '',
      createdAt,
      isAi
    };
  });
}

// 4. Rule34.xxx (Поддержка DAPI JSON + автоматический HTML Scraper парсинг + Paheal fallback)
async function fetchRule34(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ageFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('rule34', tags, ageFilter, typeFilter);

  if (category === 'top') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'popular') {
    searchTags = searchTags ? `${searchTags} sort:updated:desc` : 'sort:updated:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
  }

  const pid = Math.max(0, page - 1);

  // 1. Попытка через официальный DAPI если есть API ключ
  if (settings.rule34ApiKey && settings.rule34UserId) {
    const url = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}&api_key=${encodeURIComponent(settings.rule34ApiKey)}&user_id=${encodeURIComponent(settings.rule34UserId)}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        if (!text.includes('Missing authentication')) {
          const data = safeJsonParse(text, null);
          if (Array.isArray(data) && data.length > 0) {
            return data.map(item => {
              const rawTags = (item.tags || '').split(' ').filter(Boolean);
              let fileUrl = item.file_url || (item.image && item.directory ? `https://us.rule34.xxx/images/${item.directory}/${item.image}` : '');
              const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, item.image || '', rawTags);
              let sampleUrl = item.sample_url || fileUrl;
              let previewUrl = item.preview_url || '';
              if (isVideo) {
                if (sampleUrl && (sampleUrl.endsWith('.jpg') || sampleUrl.endsWith('.jpeg') || sampleUrl.endsWith('.png'))) {
                  if (!previewUrl) previewUrl = sampleUrl;
                }
                sampleUrl = fileUrl;
              }
              previewUrl = resolvePreviewUrl(previewUrl, fileUrl, sampleUrl, isVideo);
              const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
              const tagDetails = classifyTags(rawTags, author);
              const createdAt = normalizeDate(item.created_at || item.change);
              return {
                id: `rule34_${item.id}`,
                originalId: String(item.id),
                site: 'rule34',
                siteName: 'Rule34.xxx',
                previewUrl,
                sampleUrl,
                fileUrl,
                fileExt,
                isVideo,
                isGif,
                hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
                author,
                tags: rawTags,
                tagDetails,
                score: parseInt(item.score, 10) || 0,
                rating: item.rating || 'e',
                width: parseInt(item.width, 10) || 0,
                height: parseInt(item.height, 10) || 0,
                source: item.source || '',
                createdAt,
                isAi: checkIsAi(rawTags, aiTagsList)
              };
            });
          }
        }
      }
    } catch (err) {
      logError('Rule34.xxx DAPI', 'Ошибка DAPI запроса, переключение на HTML парсинг', err);
    }
  }

  // 2. Универсальный веб-парсер Rule34.xxx (открытая выдача без API ключа)
  const htmlUrl = `https://rule34.xxx/index.php?page=post&s=list&tags=${encodeURIComponent(searchTags)}&pid=${pid * 42}`;
  try {
    const res = await fetchSafe(htmlUrl);
    if (res.ok) {
      const html = await res.text();
      const posts = [];
      const spanRegex = /<span id="s(\d+)" class="thumb"[^>]*>([\s\S]*?)<\/span>/g;
      let match;
      while ((match = spanRegex.exec(html)) !== null) {
        const id = match[1];
        const block = match[2];

        const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
        const thumbUrl = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';

        const titleMatch = block.match(/title="([^"]*)"/);
        const altMatch = block.match(/alt="([^"]*)"/);
        const titleAttr = (titleMatch ? titleMatch[1] : (altMatch ? altMatch[1] : '')).replace(/&amp;/g, '&');

        const classMatch = block.match(/class="([^"]*)"/);
        const classAttr = classMatch ? classMatch[1] : '';

        if (!id || !thumbUrl) continue;

        let score = 0;
        const scoreMatch = titleAttr.match(/score:(-?\d+)/);
        if (scoreMatch) score = parseInt(scoreMatch[1], 10);

        let rating = 'e';
        const ratingMatch = titleAttr.match(/rating:(\w+)/);
        if (ratingMatch) rating = ratingMatch[1].charAt(0).toLowerCase();

        const cleanTitleTags = titleAttr.replace(/score:-?\d+/g, '').replace(/rating:\w+/g, '').trim();
        const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

        const isVideoClass = classAttr.includes('webm-thumb') || classAttr.includes('video-thumb');
        const isVideoTag = rawTags.includes('video') || rawTags.includes('animated') || rawTags.includes('webm') || rawTags.includes('mp4');
        const isVideo = isVideoClass || isVideoTag;

        const cleanThumb = thumbUrl.split('?')[0];
        const thumbMatch = cleanThumb.match(/\/thumbnails\/+(\d+)\/thumbnail_([a-f0-9]+)\./i);

        let fileUrl = '';
        let sampleUrl = '';
        const previewUrl = thumbUrl;
        let fileExt = isVideo ? 'mp4' : 'jpg';

        if (thumbMatch) {
          const dir = thumbMatch[1];
          const hash = thumbMatch[2];
          const host = cleanThumb.includes('wimg.rule34.xxx') ? 'https://wimg.rule34.xxx' : (cleanThumb.includes('us.rule34.xxx') ? 'https://us.rule34.xxx' : 'https://rule34.xxx');
          if (isVideo) {
            fileUrl = `${host}/images/${dir}/${hash}.mp4`;
            sampleUrl = fileUrl;
            fileExt = 'mp4';
          } else {
            fileUrl = `${host}/images/${dir}/${hash}.jpg`;
            sampleUrl = `${host}/samples/${dir}/sample_${hash}.jpg`;
          }
        } else {
          fileUrl = thumbUrl.replace('/thumbnails/', '/images/').replace('thumbnail_', '').split('?')[0];
          sampleUrl = thumbUrl.replace('/thumbnails/', '/samples/').replace('thumbnail_', 'sample_').split('?')[0];
        }

        const source = `https://rule34.xxx/index.php?page=post&s=view&id=${id}`;
        const author = extractAuthor(rawTags, source, '');
        const tagDetails = classifyTags(rawTags, author);

        posts.push({
          id: `rule34_${id}`,
          originalId: id,
          site: 'rule34',
          siteName: 'Rule34.xxx',
          previewUrl,
          sampleUrl,
          fileUrl,
          fileExt,
          isVideo,
          isGif: rawTags.includes('gif'),
          hasSound: isVideo && (rawTags.includes('sound') || rawTags.includes('audio')),
          author,
          tags: rawTags,
          tagDetails,
          score,
          rating,
          width: 0,
          height: 0,
          source,
          createdAt: '',
          isAi: checkIsAi(rawTags, aiTagsList)
        });
      }

      if (posts.length > 0) {
        return posts.slice(0, limit);
      }
    }
  } catch (err) {
    logError('Rule34.xxx HTML', 'Ошибка веб-парсинга Rule34.xxx', err);
  }

  // 3. Fallback: Открытый Paheal API
  if (settings && settings.enablePaheal === false) {
    return [];
  }
  let pahealSearchTags = adaptTagsForSite('rule34', tags, ageFilter, typeFilter);
  const fetchPahealLimit = category === 'popular' ? Math.max(limit, 70) : limit;
  if (category === 'top') {
    pahealSearchTags = pahealSearchTags ? `order:score ${pahealSearchTags}` : 'order:score';
  }
  const pahealUrl = `https://rule34.paheal.net/api/danbooru/post/index.xml?tags=${encodeURIComponent(pahealSearchTags)}&limit=${fetchPahealLimit}&page=${page}`;
  try {
    const pahealRes = await fetchSafe(pahealUrl);
    if (!pahealRes.ok) return [];
    const text = await pahealRes.text();

    const posts = [];
    const tagRegex = /<tag\s+([^>]+)>/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
      const attrsStr = match[1];
      const attrs = {};
      const attrRegex = /([a-z0-9_]+)=['"]([^'"]*)['"]/gi;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
        attrs[attrMatch[1]] = attrMatch[2];
      }
      if (attrs.file_url) {
        const rawTags = (attrs.tags || '').split(' ').filter(Boolean);
        const fileName = attrs.file_name || '';
        let { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(attrs.file_url, fileName, rawTags);
        if (fileName.toLowerCase().endsWith('.mp4') || fileName.toLowerCase().endsWith('.webm')) {
          isVideo = true;
          fileExt = fileName.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
        }
        const previewUrl = resolvePreviewUrl(attrs.preview_url, attrs.file_url, attrs.file_url, isVideo);
        const author = extractAuthor(rawTags, attrs.source, attrs.author);
        const tagDetails = classifyTags(rawTags, author);
        const createdAt = normalizeDate(attrs.created_at || attrs.date);
        posts.push({
          id: `paheal_${attrs.id}`,
          originalId: attrs.id,
          site: 'rule34',
          siteName: 'Rule34',
          previewUrl,
          sampleUrl: attrs.file_url,
          fileUrl: attrs.file_url,
          fileExt,
          isVideo,
          isGif,
          hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
          author,
          tags: rawTags,
          tagDetails,
          score: parseInt(attrs.score, 10) || 0,
          rating: 'e',
          width: parseInt(attrs.width, 10) || 0,
          height: parseInt(attrs.height, 10) || 0,
          source: attrs.source || '',
          createdAt,
          isAi: checkIsAi(rawTags, aiTagsList)
        });
      }
    }

    if (category === 'popular' && posts.length > 0) {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return posts.slice(0, limit);
  } catch (err) {
    logError('Rule34 Paheal', 'Ошибка запроса Paheal', err);
    return [];
  }
}

// 6. Gelbooru (Поддержка DAPI JSON + автоматический HTML Scraper парсинг)
async function fetchGelbooru(params, aiTagsList, settings) {
  const { tags = '', page = 1, limit = 40, category = '', typeFilter = 'all', ageFilter = 'all' } = params;
  
  let searchTags = adaptTagsForSite('gelbooru', tags, ageFilter, typeFilter);

  if (category === 'top') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'popular') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
  }

  const pid = Math.max(0, page - 1);

  // 1. Попытка через официальный DAPI если есть ключ
  if (settings.gelbooruApiKey && settings.gelbooruUserId) {
    const url = `https://gelbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}&api_key=${encodeURIComponent(settings.gelbooruApiKey)}&user_id=${encodeURIComponent(settings.gelbooruUserId)}`;
    try {
      const res = await fetchSafe(url);
      if (res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text, []);
        const posts = data?.post || (Array.isArray(data) ? data : []);
        if (Array.isArray(posts) && posts.length > 0) {
          return posts.map(item => {
            const rawTags = (item.tags || '').split(' ').filter(Boolean);
            const fileUrl = item.file_url || '';
            const sampleUrl = item.sample_url || fileUrl;
            const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
            const previewUrl = resolvePreviewUrl(item.preview_url, fileUrl, sampleUrl, isVideo);
            const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
            const tagDetails = classifyTags(rawTags, author);
            const createdAt = normalizeDate(item.created_at || item.change);
            return {
              id: `gelbooru_${item.id}`,
              originalId: String(item.id),
              site: 'gelbooru',
              siteName: 'Gelbooru',
              previewUrl,
              sampleUrl,
              fileUrl,
              fileExt,
              isVideo,
              isGif,
              hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
              author,
              tags: rawTags,
              tagDetails,
              score: parseInt(item.score, 10) || 0,
              rating: item.rating || 's',
              width: parseInt(item.width, 10) || 0,
              height: parseInt(item.height, 10) || 0,
              source: item.source || '',
              createdAt,
              isAi: checkIsAi(rawTags, aiTagsList)
            };
          });
        }
      }
    } catch (err) {
      logError('Gelbooru DAPI', 'Ошибка DAPI запроса, переключение на HTML парсинг', err);
    }
  }

  // 2. Универсальный fallback через открытую веб-выдачу Gelbooru HTML
  const htmlUrl = `https://gelbooru.com/index.php?page=post&s=list&tags=${encodeURIComponent(searchTags)}&pid=${pid * 42}`;
  try {
    const res = await fetchSafe(htmlUrl);
    if (!res.ok) return [];
    const html = await res.text();

    const posts = [];
    const articleRegex = /<article\s+class="thumbnail-preview"[^>]*>[\s\S]*?<\/article>/g;
    let match;
    while ((match = articleRegex.exec(html)) !== null) {
      const block = match[0];
      const idMatch = block.match(/id="p(\d+)"/) || block.match(/id=(\d+)/);
      const id = idMatch ? idMatch[1] : '';
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/);
      const thumbUrl = imgMatch ? imgMatch[1] : '';
      const titleMatch = block.match(/title="([^"]*)"/);
      const titleAttr = titleMatch ? titleMatch[1] : '';

      if (!id || !thumbUrl) continue;

      let score = 0;
      const scoreMatch = titleAttr.match(/score:(-?\d+)/);
      if (scoreMatch) score = parseInt(scoreMatch[1], 10);

      let rating = 's';
      const ratingMatch = titleAttr.match(/rating:(\w+)/);
      if (ratingMatch) rating = ratingMatch[1].charAt(0).toLowerCase();

      const cleanTitleTags = titleAttr.replace(/score:-?\d+/g, '').replace(/rating:\w+/g, '').trim();
      const rawTags = cleanTitleTags.split(/\s+/).filter(Boolean);

      const fileUrl = thumbUrl.replace('/thumbnails/', '/images/').replace('thumbnail_', '');
      const sampleUrl = thumbUrl.replace('/thumbnails/', '/samples/').replace('thumbnail_', 'sample_');
      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(thumbUrl, fileUrl, sampleUrl, isVideo);
      const author = extractAuthor(rawTags, `https://gelbooru.com/index.php?page=post&s=view&id=${id}`, '');
      const tagDetails = classifyTags(rawTags, author);

      posts.push({
        id: `gelbooru_${id}`,
        originalId: id,
        site: 'gelbooru',
        siteName: 'Gelbooru',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && hasSound,
        author,
        tags: rawTags,
        tagDetails,
        score,
        rating,
        width: 0,
        height: 0,
        source: `https://gelbooru.com/index.php?page=post&s=view&id=${id}`,
        createdAt: '',
        isAi: checkIsAi(rawTags, aiTagsList)
      });
    }

    return posts;
  } catch (err) {
    logError('Gelbooru HTML', 'Ошибка веб-парсинга Gelbooru', err);
    return [];
  }
}

// 7. Rule34Video (Video Archive)
async function fetchRule34Video(params, aiTagsList) {
  const { tags = '', page = 1, limit = 80, category = '', ratingFilter = 'all', ageFilter = 'all' } = params;
  if (ratingFilter === 'sfw') {
    // Rule34Video - 18+ ресурс
    return [];
  }

  // Адаптация тегов возраста для Rule34Video (поиск по тегу в запросе)
  let rawTags = tags.trim();
  if (ageFilter === 'young' && !rawTags) {
    rawTags = 'small tits';
  } else if (ageFilter === 'adult' && !rawTags) {
    rawTags = 'big tits';
  }

  const cleanQuery = rawTags.replace(/[_+\s]+/g, '-').replace(/-+/g, '-').toLowerCase();
  
  // Загружаем пакет из 4 страниц сайта параллельно (4 страницы x 38 = ~150 видео за один запрос!)
  const pagesPerBatch = 4;
  const startFrom = (page - 1) * pagesPerBatch + 1;
  const pageNumbers = Array.from({ length: pagesPerBatch }, (_, i) => startFrom + i);

  const allPosts = [];
  const seenIds = new Set();

  const fetchPromises = pageNumbers.map(async (p) => {
    let url = '';
    const isPopular = (category === 'popular' || category === 'top');
    if (cleanQuery) {
      const sortByParam = isPopular ? '&sort_by=most_popular' : '';
      url = `https://rule34video.com/search/${encodeURIComponent(cleanQuery)}/?mode=async&function=get_block&block_id=custom_list_videos_videos_list_search&q=${encodeURIComponent(cleanQuery)}${sortByParam}&from_videos=${p}`;
    } else if (isPopular) {
      url = `https://rule34video.com/top-rated/?mode=async&function=get_block&block_id=custom_list_videos_common_videos&from=${p}`;
    } else {
      url = `https://rule34video.com/latest-updates/?mode=async&function=get_block&block_id=custom_list_videos_latest_videos_list&from=${p}`;
    }

    try {
      const res = await fetchSafe(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Requested-With': 'XMLHttpRequest'
        },
        timeout: 10000
      });
      if (!res.ok) return [];
      const html = await res.text();

      const blocks = html.split('<div class="item').slice(1);
      const pageResults = [];

      for (const block of blocks) {
        const linkMatch = block.match(/href="([^"]*video\/(\d+)\/([^"]*))"\s+title="([^"]*)"/);
        const thumbMatch = block.match(/data-original="([^"]*)"/) || block.match(/src="([^"]*)"/);
        const previewMatch = block.match(/data-preview="([^"]*)"/);
        if (!linkMatch) continue;

        const id = linkMatch[2];
        const pageUrl = linkMatch[1];
        const slug = linkMatch[3] || '';
        const rawTitle = linkMatch[4] || 'Rule34 Video';
        const title = rawTitle.replace(/&#34;/g, '"').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const thumb = thumbMatch ? thumbMatch[1] : '';
        const previewMp4 = previewMatch ? previewMatch[1] : '';

        // Извлечение автора из названия видео (форматы: "Title | Author", "Title by Author", "[Author] Title")
        let author = '';
        const authorBracketMatch = title.match(/^\[([^\]]+)\]/);
        const authorPipeMatch = title.match(/\|\s*([a-zA-Z0-9_\- ]+)$/);
        const authorByMatch = title.match(/by\s+([a-zA-Z0-9_\- ]+)/i);

        if (authorPipeMatch) {
          author = authorPipeMatch[1].trim();
        } else if (authorByMatch) {
          author = authorByMatch[1].trim();
        } else if (authorBracketMatch) {
          const bracketTag = authorBracketMatch[1].trim();
          if (!['pmv', 'hmv', 'sfx', '3d', '2d', 'zzz', '4k', '60fps', 'hd'].includes(bracketTag.toLowerCase())) {
            author = bracketTag;
          }
        }

        const rawTagsSet = new Set(['video', 'animated']);
        slug.split(/[-_/]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s.toLowerCase()));
        title.toLowerCase().split(/[\s,()\[\]\-_/|"]+/).filter(s => s.length > 1).forEach(s => rawTagsSet.add(s));

        if (cleanQuery) {
          cleanQuery.split('-').filter(Boolean).forEach(q => rawTagsSet.add(q));
          rawTagsSet.add(cleanQuery.replace(/-/g, '_'));
        }
        if (author) {
          rawTagsSet.add(author.toLowerCase().replace(/\s+/g, '_'));
          rawTagsSet.add(author.toLowerCase());
        }

        const rawTags = Array.from(rawTagsSet);
        const isAi = checkIsAi(rawTags, aiTagsList);
        const tagDetails = classifyTags(rawTags, author);

        pageResults.push({
          id: `rule34video_${id}`,
          originalId: String(id),
          site: 'rule34video',
          siteName: 'Rule34Video',
          title,
          author,
          previewUrl: resolvePreviewUrl(thumb, previewMp4, previewMp4, true),
          sampleUrl: previewMp4,
          fileUrl: previewMp4,
          fileExt: 'mp4',
          isVideo: true,
          isGif: false,
          hasSound: true,
          tags: rawTags,
          tagDetails,
          score: 100,
          rating: 'e',
          width: 1280,
          height: 720,
          source: pageUrl,
          createdAt: '',
          isAi
        });
      }
      return pageResults;
    } catch (err) {
      logError('Rule34Video', `Ошибка загрузки страницы ${p}`, err);
      return [];
    }
  });

  const batchResults = await Promise.all(fetchPromises);
  for (const pagePosts of batchResults) {
    for (const post of pagePosts) {
      if (!seenIds.has(post.originalId)) {
        seenIds.add(post.originalId);
        allPosts.push(post);
      }
    }
  }

  return allPosts;
}

// 8. Xbooru (Gelbooru DAPI)
async function fetchXbooru(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;
  if (ratingFilter === 'sfw') {
    // Xbooru - 18+ NSFW ресурс
    return [];
  }

  let searchTags = adaptTagsForSite('xbooru', tags, ageFilter, typeFilter);
  if (category === 'top' || category === 'popular') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
  }

  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    searchTags = searchTags ? `${searchTags} animated` : 'animated';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://xbooru.com/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, {
      headers: {
        'Referer': 'https://xbooru.com/'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return posts.map(item => {
      const rawTags = (item.tags || '').split(' ').filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://img.xbooru.com/images/${item.directory}/${item.image}`;
      } else if (fileUrl.startsWith('//')) {
        fileUrl = 'https:' + fileUrl;
      }

      let sampleUrl = item.sample_url || fileUrl;
      if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;

      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://img.xbooru.com/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
      const tagDetails = classifyTags(rawTags, author);
      const createdAt = normalizeDate(item.created_at || item.change);

      return {
        id: `xbooru_${item.id}`,
        originalId: String(item.id),
        site: 'xbooru',
        siteName: 'Xbooru',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'e',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    });
  } catch (err) {
    logError('Xbooru', 'Ошибка загрузки постов', err);
    return [];
  }
}

// 9. Hypnohub (DAPI)
async function fetchHypnohub(params, aiTagsList) {
  const { tags = '', page = 1, limit = 40, category = '', ratingFilter = 'all', typeFilter = 'all', ageFilter = 'all' } = params;

  let searchTags = adaptTagsForSite('hypnohub', tags, ageFilter, typeFilter);
  if (category === 'top' || category === 'popular') {
    searchTags = searchTags ? `${searchTags} sort:score:desc` : 'sort:score:desc';
  } else if (category === 'random') {
    searchTags = searchTags ? `${searchTags} sort:random` : 'sort:random';
  }

  if (ratingFilter === 'nsfw') {
    searchTags = searchTags ? `${searchTags} rating:e` : 'rating:e';
  } else if (ratingFilter === 'sfw') {
    searchTags = searchTags ? `${searchTags} rating:s` : 'rating:s';
  }

  if (typeFilter === 'video' || typeFilter === 'audio' || typeFilter === 'sound') {
    searchTags = searchTags ? `${searchTags} animated` : 'animated';
  }

  const pid = Math.max(0, page - 1);
  const url = `https://hypnohub.net/index.php?page=dapi&s=post&q=index&json=1&tags=${encodeURIComponent(searchTags)}&pid=${pid}&limit=${limit}`;

  try {
    const res = await fetchSafe(url, {
      headers: {
        'Referer': 'https://hypnohub.net/'
      }
    });
    if (!res.ok) return [];
    const text = await res.text();
    const data = safeJsonParse(text, []);
    const posts = data?.post || (Array.isArray(data) ? data : []);

    return posts.map(item => {
      const rawTags = (item.tags || '').split(' ').filter(Boolean);
      let fileUrl = item.file_url || '';
      if (!fileUrl && item.directory && item.image) {
        fileUrl = `https://hypnohub.net/images/${item.directory}/${item.image}`;
      } else if (fileUrl.startsWith('//')) {
        fileUrl = 'https:' + fileUrl;
      }

      let sampleUrl = item.sample_url || fileUrl;
      if (sampleUrl.startsWith('//')) sampleUrl = 'https:' + sampleUrl;

      let previewUrlRaw = item.preview_url || (item.directory && item.image ? `https://hypnohub.net/thumbnails/${item.directory}/thumbnail_${item.image}` : fileUrl);
      if (previewUrlRaw.startsWith('//')) previewUrlRaw = 'https:' + previewUrlRaw;

      const { isVideo, isGif, hasSound, fileExt } = checkMediaTypes(fileUrl, '', rawTags);
      const previewUrl = resolvePreviewUrl(previewUrlRaw, fileUrl, sampleUrl, isVideo);
      const author = extractAuthor(rawTags, item.source, item.owner || item.creator_id || item.author);
      const tagDetails = classifyTags(rawTags, author);
      const createdAt = normalizeDate(item.created_at || item.change);

      return {
        id: `hypnohub_${item.id}`,
        originalId: String(item.id),
        site: 'hypnohub',
        siteName: 'Hypnohub',
        previewUrl,
        sampleUrl,
        fileUrl,
        fileExt,
        isVideo,
        isGif,
        hasSound: isVideo && (hasSound || rawTags.includes('sound') || rawTags.includes('audio')),
        author,
        tags: rawTags,
        tagDetails,
        score: parseInt(item.score, 10) || 0,
        rating: item.rating || 'q',
        width: parseInt(item.width, 10) || 0,
        height: parseInt(item.height, 10) || 0,
        source: item.source || '',
        createdAt,
        isAi: checkIsAi(rawTags, aiTagsList)
      };
    });
  } catch (err) {
    logError('Hypnohub', 'Ошибка загрузки постов', err);
    return [];
  }
}

// Диспетчер
async function fetchPosts(site, params, aiTagsList, settings) {
  switch (site) {
    case 'danbooru':
      return await fetchDanbooru(params, aiTagsList, settings);
    case 'rule34video':
      return await fetchRule34Video(params, aiTagsList);
    case 'yandere':
      return await fetchMoebooru('yandere', 'https://yande.re', 'Yande.re', params, aiTagsList);
    case 'safebooru':
      return await fetchSafebooru(params, aiTagsList);
    case 'konachan':
      return await fetchMoebooru('konachan', 'https://konachan.net', 'Konachan', params, aiTagsList);
    case 'rule34':
      return await fetchRule34(params, aiTagsList, settings);
    case 'gelbooru':
      return await fetchGelbooru(params, aiTagsList, settings);
    case 'xbooru':
      return await fetchXbooru(params, aiTagsList);
    case 'hypnohub':
      return await fetchHypnohub(params, aiTagsList);
    case 'all': {
      let mainSites = ['danbooru', 'yandere', 'safebooru', 'konachan', 'rule34', 'gelbooru', 'rule34video', 'xbooru', 'hypnohub'];
      if (params.typeFilter === 'video' || params.typeFilter === 'audio' || params.typeFilter === 'sound') {
        mainSites = ['rule34video', 'danbooru', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
      } else if (params.ratingFilter === 'nsfw') {
        mainSites = ['rule34video', 'danbooru', 'yandere', 'rule34', 'gelbooru', 'xbooru', 'hypnohub'];
      }
      const perSiteLimit = Math.max(25, Math.ceil((params.limit || 100) / mainSites.length));
      const results = await Promise.allSettled(
        mainSites.map(s => fetchPosts(s, { ...params, limit: perSiteLimit }, aiTagsList, settings))
      );
      const lists = [];
      results.forEach(res => {
        if (res.status === 'fulfilled' && Array.isArray(res.value) && res.value.length > 0) {
          lists.push(res.value);
        }
      });
      // Чередование (Round-Robin) постов с разных сайтов для равномерного разнообразия
      const combined = [];
      const maxLength = Math.max(0, ...lists.map(l => l.length));
      for (let i = 0; i < maxLength; i++) {
        for (let j = 0; j < lists.length; j++) {
          if (i < lists[j].length) {
            combined.push(lists[j][i]);
          }
        }
      }
      return combined;
    }
    default:
      return await fetchDanbooru(params, aiTagsList, settings);
  }
}

// API Эндпоинты

app.get('/api/sites', (req, res) => {
  res.json({ sites: Object.values(SITES) });
});

app.get('/api/posts', async (req, res) => {
  try {
    const site = req.query.site || 'danbooru';
    const tags = req.query.tags || '';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 100;
    const category = req.query.category || 'new';
    const aiFilter = req.query.aiFilter || 'no-ai';
    const ratingFilter = req.query.ratingFilter || 'all'; // 'all', 'nsfw', 'sfw'
    const typeFilter = req.query.typeFilter || 'all'; // 'all', 'video', 'audio', 'image'
    const ageFilter = req.query.ageFilter || 'all'; // 'all', 'adult', 'young'
    const hideFurry = req.query.hideFurry === 'true' || req.query.hideFurry === '1';
    const hidePregnant = req.query.hidePregnant === 'true' || req.query.hidePregnant === '1';

    // Проверка кэша в оперативной памяти (для всего кроме random)
    const cacheKey = `${site}:${tags}:${page}:${limit}:${category}:${aiFilter}:${ratingFilter}:${typeFilter}:${ageFilter}:${hideFurry}:${hidePregnant}`;
    if (category !== 'random') {
      const cached = apiPostsCache.get(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const settings = readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
    const aiTagsList = settings.aiTags || DEFAULT_AI_TAGS;
    const blacklist = settings.blacklist || [];

    logInfo('Search', `Запрос: site=${site}, tags="${tags}", page=${page}, rating=${ratingFilter}, type=${typeFilter}, age=${ageFilter}`);

    let posts = await fetchPosts(site, { tags, page, limit, category, ratingFilter, typeFilter, ageFilter }, aiTagsList, settings);

    // Фильтр типа контента (Видео / Со звуком / Фото)
    if (typeFilter === 'audio' || typeFilter === 'sound') {
      posts = posts.filter(p => p.isVideo && p.hasSound);
    } else if (typeFilter === 'video') {
      posts = posts.filter(p => p.isVideo || p.isGif);
    } else if (typeFilter === 'image') {
      posts = posts.filter(p => !p.isVideo && !p.isGif);
    }

    // Фильтр телосложения и типажей (Мамочки/Пышные vs Лоли/Мини)
    if (ageFilter === 'adult') {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        if (CURVY_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        // Если поиск пустой, требуем наличие хотя бы одного тега пышности/зрелости
        if (!tags && !CURVY_INCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        return true;
      });
    } else if (ageFilter === 'young') {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        if (PETITE_EXCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        if (!tags && !PETITE_INCLUDE_TAGS.some(tag => postTags.includes(tag))) return false;
        return true;
      });
    }

    // Локальная фильтрация по запрошенным тегам
    if (tags && site !== 'rule34video') {
      const searchTokens = tags
        .toLowerCase()
        .replace(/([a-zA-Z0-9_-]+)_\(([^)]+)\)/g, '$1 $2')
        .replace(/([a-zA-Z0-9_-]+)\s*\(([^)]+)\)/g, '$1 $2')
        .replace(/[()]/g, '')
        .split(/\s+/)
        .map(t => t.trim())
        .filter(Boolean);

      if (searchTokens.length > 0) {
        posts = posts.filter(post => {
          const postTags = Array.isArray(post.tags) ? post.tags.map(t => (typeof t === 'string' ? t.toLowerCase() : String(t || '').toLowerCase())) : [];
          const postTagsFlat = postTags.join(' ');
          const titleLower = String(post.title || '').toLowerCase();
          const authorLower = String(post.author || '').toLowerCase();

          return searchTokens.every(token => {
            if (token.startsWith('-')) {
              const neg = token.substring(1).replace(/_/g, ' ');
              const negUnderscore = token.substring(1);
              return !postTags.includes(negUnderscore) && !postTagsFlat.includes(neg) && !titleLower.includes(neg);
            }
            if (token.includes(':')) return true; // Игнорируем спец-теги вроде rating: или order:

            const tokenNorm = token.replace(/_/g, ' ');
            const inTags = postTags.some(t => t === token || t === tokenNorm || t.includes(token) || t.includes(tokenNorm)) || 
                           postTagsFlat.includes(token) || 
                           postTagsFlat.includes(tokenNorm);
            const inTitle = titleLower.includes(tokenNorm) || titleLower.includes(token);
            const inAuthor = authorLower.includes(tokenNorm) || authorLower.includes(token);

            return inTags || inTitle || inAuthor;
          });
        });
      }
    }

    // AI Фильтр
    if (aiFilter === 'no-ai') {
      posts = posts.filter(p => !p.isAi);
    } else if (aiFilter === 'only-ai') {
      posts = posts.filter(p => p.isAi);
    }

    // Возрастной рейтинг
    if (ratingFilter === 'nsfw') {
      posts = posts.filter(p => {
        const r = (p.rating || '').toLowerCase();
        return r === 'e' || r === 'q' || r === 'explicit' || r === 'questionable' || r === 'sensitive' || r === '?';
      });
    } else if (ratingFilter === 'sfw') {
      posts = posts.filter(p => {
        const r = (p.rating || '').toLowerCase();
        return r === 's' || r === 'g' || r === 'safe' || r === 'general';
      });
    }

    // Фильтр фурри
    if (hideFurry || settings.hideFurry) {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !FURRY_TAGS.some(fTag => postTags.some(t => t === fTag || t.startsWith(fTag + '_') || t.endsWith('_' + fTag)));
      });
    }

    // Фильтр беременности
    if (hidePregnant || settings.hidePregnant) {
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !PREGNANT_TAGS.some(pTag => postTags.some(t => t === pTag || t.includes(pTag)));
      });
    }

    // Черный список
    if (blacklist.length > 0) {
      const lowerBlacklist = blacklist.map(b => b.toLowerCase().trim()).filter(Boolean);
      posts = posts.filter(post => {
        const postTags = Array.isArray(post.tags) ? post.tags.map(t => t.toLowerCase()) : [];
        return !lowerBlacklist.some(blackTag => postTags.includes(blackTag));
      });
    }

    // Локальная сортировка
    if ((category === 'popular' || category === 'top') && site !== 'all') {
      posts.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    // Фильтрация невалидных/пустых постов
    posts = posts.filter(post => post && (post.fileUrl || post.sampleUrl || post.previewUrl));

    logInfo('Search', `Успешно: найдено ${posts.length} постов для выдачи`);

    const responsePayload = {
      success: true,
      site,
      page,
      count: posts.length,
      posts
    };

    if (category !== 'random' && posts.length > 0) {
      apiPostsCache.set(cacheKey, responsePayload);
    }

    res.json(responsePayload);
  } catch (err) {
    logError('Search', `Ошибка при поиске`, err);
    res.json({
      success: true,
      site: req.query.site || 'danbooru',
      page: 1,
      count: 0,
      posts: []
    });
  }
});

// Скачивание и распаковка ZIP
app.post('/api/download', async (req, res) => {
  try {
    const { url, isZip, site, id, ext } = req.body;
    if (!url) return res.json({ success: false, error: 'URL не указан' });

    const downloadsDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

    const filename = `${site}_${id}.${ext || (isZip ? 'zip' : 'jpg')}`;
    const filePath = path.join(downloadsDir, filename);

    logInfo('Download', `Скачивание: ${url}`);
    const response = await fetchSafe(url, { timeout: 60000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));

    if (isZip) {
      logInfo('Download', `Распаковка ZIP: ${filePath}`);
      const zip = new AdmZip(filePath);
      const extractPath = path.join(downloadsDir, `${site}_${id}_unzipped`);
      zip.extractAllTo(extractPath, true);
      open(extractPath);
    } else {
      open(downloadsDir);
    }

    res.json({ success: true });
  } catch (err) {
    logError('Download', 'Ошибка скачивания', err);
    res.json({ success: false, error: err.message });
  }
});

// Автокомплит тегов с кэшированием
app.get('/api/tags/autocomplete', async (req, res) => {
  const query = (req.query.q || '').trim();
  const site = req.query.site || 'danbooru';
  if (!query) return res.json({ tags: [] });

  const cacheKey = `${site}:${query.toLowerCase()}`;
  const cached = tagAutocompleteCache.get(cacheKey);
  if (cached) {
    return res.json({ tags: cached });
  }

  try {
    let tagsResult = [];

    if (site === 'danbooru' || site === 'all' || site === 'rule34') {
      try {
        const url = `https://danbooru.donmai.us/tags.json?search[name_matches]=${encodeURIComponent(query)}*&limit=15&search[order]=count`;
        const resp = await fetchSafe(url, { timeout: 4000 });
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data)) {
            tagsResult = data.map(item => ({
              value: item.name,
              label: item.name.replace(/_/g, ' '),
              count: item.post_count || 0,
              category: item.category === 1 ? 'artist' : item.category === 3 ? 'copyright' : item.category === 4 ? 'character' : item.category === 5 ? 'meta' : 'general'
            }));
          }
        }
      } catch {}
      
      // Fallback на Safebooru если Danbooru недоступен
      if (tagsResult.length === 0) {
        try {
          const fallbackUrl = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
          const resp = await fetchSafe(fallbackUrl, { timeout: 3500 });
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data)) {
              tagsResult = data.map(item => ({
                value: item.value,
                label: item.label || item.value.replace(/_/g, ' '),
                count: parseInt(item.total, 10) || 0,
                category: 'general'
              }));
            }
          }
        } catch {}
      }
    } else if (site === 'yandere' || site === 'konachan') {
      const base = site === 'yandere' ? 'https://yande.re' : 'https://konachan.net';
      const url = `${base}/tag.json?name=${encodeURIComponent(query)}&limit=15`;
      const resp = await fetchSafe(url, { timeout: 4000 });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          tagsResult = data.map(item => ({
            value: item.name,
            label: item.name.replace(/_/g, ' '),
            count: item.count || 0,
            category: item.type === 1 ? 'artist' : item.type === 3 ? 'copyright' : item.type === 4 ? 'character' : 'general'
          }));
        }
      }
    } else {
      const url = `https://safebooru.org/autocomplete.php?q=${encodeURIComponent(query.toLowerCase())}`;
      const resp = await fetchSafe(url, { timeout: 4000 });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          tagsResult = data.map(item => ({
            value: item.value,
            label: item.label || item.value.replace(/_/g, ' '),
            count: parseInt(item.total, 10) || 0,
            category: 'general'
          }));
        }
      }
    }

    if (tagsResult.length > 0) {
      tagAutocompleteCache.set(cacheKey, tagsResult);
    }

    res.json({ tags: tagsResult });
  } catch (err) {
    res.json({ tags: [] });
  }
});

// Прокси медиа с кэшированием изображений на диске
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const cleanPath = targetUrl.split('?')[0].toLowerCase();
    const isImage = cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg') || cleanPath.endsWith('.png') || cleanPath.endsWith('.webp') || cleanPath.endsWith('.gif');
    const isRangeReq = Boolean(req.headers.range);

    // Дисковый кэш для картинок
    if (isImage && !isRangeReq) {
      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      let ext = 'jpg';
      if (cleanPath.endsWith('.png')) ext = 'png';
      else if (cleanPath.endsWith('.webp')) ext = 'webp';
      else if (cleanPath.endsWith('.gif')) ext = 'gif';

      const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${ext}`);
      if (fs.existsSync(cacheFilePath) && fs.statSync(cacheFilePath).size > 0) {
        res.setHeader('Cache-Control', 'public, max-age=604800');
        return res.sendFile(cacheFilePath);
      }
    }

    const isBrowserTarget = targetUrl.includes('rule34video.com') || targetUrl.includes('rule34.xxx') || targetUrl.includes('paheal') || targetUrl.includes('gelbooru.com') || targetUrl.includes('xbooru.com') || targetUrl.includes('hypnohub.net');
    const ua = isBrowserTarget ? BROWSER_USER_AGENT : BOORU_USER_AGENT;

    const headers = {
      'User-Agent': ua,
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': isImage ? 'image' : 'video',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site'
    };

    const currentSettings = getSettings();
    try {
      const parsed = new URL(targetUrl);
      if (parsed.hostname.includes('paheal.net') || parsed.hostname.includes('paheal-cdn.net')) {
        headers['Referer'] = 'https://rule34.paheal.net/';
      } else if (parsed.hostname.includes('rule34.xxx')) {
        headers['Referer'] = 'https://rule34.xxx/';
      } else if (parsed.hostname.includes('donmai.us')) {
        headers['Referer'] = 'https://danbooru.donmai.us/';
        if (currentSettings.danbooruLogin && currentSettings.danbooruApiKey) {
          headers['Authorization'] = 'Basic ' + Buffer.from(`${currentSettings.danbooruLogin}:${currentSettings.danbooruApiKey}`).toString('base64');
        }
      } else if (parsed.hostname.includes('yande.re')) {
        headers['Referer'] = 'https://yande.re/';
      } else if (parsed.hostname.includes('konachan')) {
        headers['Referer'] = 'https://konachan.net/';
      } else if (parsed.hostname.includes('hypnohub.net')) {
        headers['Referer'] = 'https://hypnohub.net/';
      } else if (parsed.hostname.includes('xbooru.com')) {
        headers['Referer'] = 'https://xbooru.com/';
      } else {
        headers['Referer'] = `${parsed.protocol}//${parsed.host}/`;
      }
    } catch {}

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const controller = new AbortController();
    const abortTimeout = setTimeout(() => controller.abort(), 20000);
    req.on('close', () => {
      clearTimeout(abortTimeout);
      try { controller.abort(); } catch {}
    });

    const response = await fetch(targetUrl, {
      headers,
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(abortTimeout);

    res.status(response.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Accept-Ranges', 'bytes');

    const forwardHeaders = ['content-type', 'content-length', 'content-range', 'cache-control', 'last-modified', 'etag'];
    forwardHeaders.forEach(h => {
      let val = response.headers.get(h);
      if (val) {
        if (h === 'content-type' && val.includes(',')) {
          val = val.split(',')[0].trim();
        }
        res.setHeader(h, val);
      }
    });

    let currentType = res.getHeader('content-type') || '';
    if (!currentType || currentType.includes('octet-stream') || currentType.includes('text/plain')) {
      if (cleanPath.endsWith('.mp4') || cleanPath.endsWith('.m4v')) res.setHeader('Content-Type', 'video/mp4');
      else if (cleanPath.endsWith('.webm')) res.setHeader('Content-Type', 'video/webm');
      else if (cleanPath.endsWith('.gif')) res.setHeader('Content-Type', 'image/gif');
      else if (cleanPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else if (cleanPath.endsWith('.webp')) res.setHeader('Content-Type', 'image/webp');
      else if (cleanPath.endsWith('.jpg') || cleanPath.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
    }

    if (!res.getHeader('cache-control')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
    }

    if (isImage && !isRangeReq && response.ok) {
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
      let ext = 'jpg';
      if (cleanPath.endsWith('.png')) ext = 'png';
      else if (cleanPath.endsWith('.webp')) ext = 'webp';
      else if (cleanPath.endsWith('.gif')) ext = 'gif';

      const cacheFilePath = path.join(THUMBS_DIR, `${hash}.${ext}`);
      fs.promises.writeFile(cacheFilePath, buf).catch(() => {});
      return res.send(buf);
    }

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body);
      
      nodeStream.on('error', () => {
        try {
          if (!res.headersSent) res.status(502).end();
          else res.end();
        } catch {}
      });

      req.on('close', () => {
        try { nodeStream.destroy(); } catch {}
      });

      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err.name === 'AbortError' || err.code === 'ABORT_ERR' || err.message?.includes('aborted')) {
      return; // Клиент сам закрыл соединение (быстрый скролл)
    }
    logError('Proxy', `Не удалось проксировать ${targetUrl}`, err);
    if (!res.headersSent) {
      res.status(502).send('Ошибка загрузки медиа');
    }
  }
});

// Генерация превью для видео через FFmpeg с очисткой процессов при обрыве соединения
app.get('/api/video-thumbnail', async (req, res) => {
  const targetUrl = req.query.url;
  const quality = req.query.quality || 'medium'; // 'low', 'medium', 'high', 'original'
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const hash = crypto.createHash('md5').update(`${targetUrl}_${quality}`).digest('hex');
    const thumbPath = path.join(THUMBS_DIR, `${hash}_${quality}.jpg`);

    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(thumbPath);
    }

    const headers = getFfmpegHeaders(targetUrl);

    let scaleFilter = 'scale=480:-1';
    let qScale = '2';
    if (quality === 'low') {
      scaleFilter = 'scale=280:-1';
      qScale = '4';
    } else if (quality === 'high') {
      scaleFilter = 'scale=854:-1';
      qScale = '2';
    } else if (quality === 'original') {
      scaleFilter = 'scale=1280:-1';
      qScale = '1';
    }

    const extractFrame = (ssTime) => {
      return new Promise((resolve) => {
        const args = [
          '-headers', headers,
          '-ss', ssTime,
          '-i', targetUrl,
          '-vframes', '1',
          '-vf', scaleFilter,
          '-q:v', qScale,
          '-y',
          thumbPath
        ];
        const proc = spawn('ffmpeg', args);
        
        req.on('close', () => {
          try {
            if (proc && !proc.killed) proc.kill('SIGKILL');
          } catch {}
        });

        proc.on('close', (code) => {
          resolve(code === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0);
        });
        proc.on('error', () => resolve(false));
      });
    };

    let success = await extractFrame('00:00:01');
    if (!success) {
      success = await extractFrame('00:00:00');
    }

    if (success) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return res.sendFile(thumbPath);
    } else {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" fill="#1e293b"><rect width="100%" height="100%"/><text x="50%" y="50%" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle" font-size="14" font-family="sans-serif">🎬 Видео</text></svg>`);
    }
  } catch (err) {
    logError('Thumbnail', `Ошибка генерации превью для ${targetUrl}`, err);
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" fill="#1e293b"><rect width="100%" height="100%"/><text x="50%" y="50%" fill="#94a3b8" dominant-baseline="middle" text-anchor="middle" font-size="14" font-family="sans-serif">🎬 Видео</text></svg>`);
  }
});

// Транскодирование видео в совместимый браузерный формат H.264/AAC через FFmpeg
const activeTranscodes = new Map();

app.get('/api/transcode-video', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Требуется параметр url');

  try {
    const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
    const videoPath = path.join(VIDEOS_DIR, `${hash}.mp4`);
    const tempPath = path.join(VIDEOS_DIR, `${hash}_temp.mp4`);

    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      return res.sendFile(videoPath, { acceptRanges: true });
    }

    if (activeTranscodes.has(hash)) {
      try {
        await activeTranscodes.get(hash);
        if (fs.existsSync(videoPath)) {
          return res.sendFile(videoPath, { acceptRanges: true });
        }
      } catch {}
    }

    logInfo('FFmpeg', `Начало транскодирования видео в H.264/AAC: ${targetUrl}`);

    const headers = getFfmpegHeaders(targetUrl);
    const transcodePromise = new Promise((resolve, reject) => {
      const args = [
        '-headers', headers,
        '-i', targetUrl,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        tempPath
      ];

      const proc = spawn('ffmpeg', args);
      
      req.on('close', () => {
        try {
          if (proc && !proc.killed) proc.kill('SIGKILL');
        } catch {}
      });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
          try {
            fs.renameSync(tempPath, videoPath);
            logInfo('FFmpeg', `Транскодирование успешно завершено: ${hash}.mp4 (${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(2)} MB)`);
            resolve(true);
          } catch (err) {
            reject(err);
          }
        } else {
          if (fs.existsSync(tempPath)) {
            try { fs.unlinkSync(tempPath); } catch {}
          }
          reject(new Error(`FFmpeg вернул код ошибки ${code}`));
        }
      });

      proc.on('error', (err) => {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch {}
        }
        reject(err);
      });
    });

    activeTranscodes.set(hash, transcodePromise);

    await transcodePromise;
    activeTranscodes.delete(hash);

    return res.sendFile(videoPath, { acceptRanges: true });
  } catch (err) {
    logError('FFmpeg', `Ошибка транскодирования ${targetUrl}`, err);
    if (!res.headersSent) {
      return res.status(500).send('Ошибка транскодирования видео: ' + err.message);
    }
  }
});

// Управление кэшем
app.get('/api/cache-info', (req, res) => {
  const thumbs = getDirectoryStats(THUMBS_DIR);
  const videos = getDirectoryStats(VIDEOS_DIR);
  const totalDiskBytes = thumbs.totalBytes + videos.totalBytes;
  
  res.json({
    success: true,
    diskCacheBytes: totalDiskBytes,
    diskCacheMB: (totalDiskBytes / (1024 * 1024)).toFixed(1),
    thumbsCount: thumbs.fileList.length,
    videosCount: videos.fileList.length,
    ramCacheEntries: apiPostsCache.size() + tagAutocompleteCache.size()
  });
});

app.post('/api/cache-clear', (req, res) => {
  try {
    apiPostsCache.clear();
    tagAutocompleteCache.clear();

    const thumbs = getDirectoryStats(THUMBS_DIR);
    const videos = getDirectoryStats(VIDEOS_DIR);

    for (const f of [...thumbs.fileList, ...videos.fileList]) {
      try { fs.unlinkSync(f.path); } catch {}
    }

    logInfo('Cache', 'Кэш полностью очищен по запросу пользователя');
    res.json({ success: true, message: 'Кэш успешно очищен' });
  } catch (err) {
    logError('Cache', 'Ошибка очистки кэша', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Настройки
let inMemorySettings = null;
function getSettings() {
  if (!inMemorySettings) {
    inMemorySettings = readJsonFile(SETTINGS_FILE, DEFAULT_SETTINGS);
  }
  // Поддержка переменных окружения (например, на Render / Docker)
  const envOverrides = {};
  if (process.env.RULE34_API_KEY) envOverrides.rule34ApiKey = process.env.RULE34_API_KEY;
  if (process.env.RULE34_USER_ID) envOverrides.rule34UserId = process.env.RULE34_USER_ID;
  if (process.env.GELBOORU_API_KEY) envOverrides.gelbooruApiKey = process.env.GELBOORU_API_KEY;
  if (process.env.GELBOORU_USER_ID) envOverrides.gelbooruUserId = process.env.GELBOORU_USER_ID;
  if (process.env.DANBOORU_API_KEY) envOverrides.danbooruApiKey = process.env.DANBOORU_API_KEY;
  if (process.env.DANBOORU_LOGIN) envOverrides.danbooruLogin = process.env.DANBOORU_LOGIN;

  return { ...inMemorySettings, ...envOverrides };
}

app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

app.post('/api/settings', (req, res) => {
  const current = getSettings();
  inMemorySettings = { ...current, ...(req.body || {}) };
  writeJsonFileAsync(SETTINGS_FILE, inMemorySettings);
  res.json({ success: true, settings: inMemorySettings });
});

// Избранное
app.get('/api/favorites', (req, res) => {
  const favorites = readJsonFile(FAVORITES_FILE, []);
  res.json({ success: true, favorites });
});

app.post('/api/favorites', (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const favorites = readJsonFile(FAVORITES_FILE, []);
  const existsIndex = favorites.findIndex(f => f.id === post.id);

  if (existsIndex >= 0) {
    favorites.splice(existsIndex, 1);
    writeJsonFileAsync(FAVORITES_FILE, favorites);
    return res.json({ success: true, isFavorite: false, count: favorites.length });
  } else {
    favorites.unshift({ ...post, savedAt: new Date().toISOString() });
    writeJsonFileAsync(FAVORITES_FILE, favorites);
    return res.json({ success: true, isFavorite: true, count: favorites.length });
  }
});

app.post('/api/favorites/sync', (req, res) => {
  const { favorites } = req.body || {};
  if (!Array.isArray(favorites)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив избранного' });
  }
  const current = readJsonFile(FAVORITES_FILE, []);
  const map = new Map();
  current.forEach(f => { if (f && f.id) map.set(f.id, f); });
  favorites.forEach(f => { if (f && f.id) map.set(f.id, f); });
  const merged = Array.from(map.values());

  writeJsonFileAsync(FAVORITES_FILE, merged);
  res.json({ success: true, count: merged.length, favorites: merged });
});

app.delete('/api/favorites/:id', (req, res) => {
  const id = req.params.id;
  const favorites = readJsonFile(FAVORITES_FILE, []);
  const filtered = favorites.filter(f => f.id !== id);
  writeJsonFileAsync(FAVORITES_FILE, filtered);
  res.json({ success: true, count: filtered.length });
});

// Любимые авторы (Favorite Authors)
app.get('/api/favorite-authors', (req, res) => {
  const authors = readJsonFile(FAVORITE_AUTHORS_FILE, []);
  res.json({ success: true, authors });
});

app.post('/api/favorite-authors', (req, res) => {
  const body = req.body;
  if (!body || !body.name || !body.name.trim()) {
    return res.status(400).json({ success: false, message: 'Имя автора не указано' });
  }

  const rawName = body.name.trim();
  const cleanName = rawName.replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const displayName = body.displayName ? body.displayName.trim() : rawName;
  const previewUrl = body.previewUrl || '';
  const site = body.site || 'danbooru';

  const authors = readJsonFile(FAVORITE_AUTHORS_FILE, []);
  const existsIndex = authors.findIndex(a => (a.name || '').toLowerCase() === cleanName);

  if (existsIndex >= 0) {
    authors.splice(existsIndex, 1);
    writeJsonFileAsync(FAVORITE_AUTHORS_FILE, authors);
    return res.json({ success: true, isFavorite: false, count: authors.length, authors });
  } else {
    const newAuthor = {
      id: cleanName,
      name: cleanName,
      displayName: displayName,
      previewUrl: previewUrl,
      site: site,
      createdAt: new Date().toISOString()
    };
    authors.unshift(newAuthor);
    writeJsonFileAsync(FAVORITE_AUTHORS_FILE, authors);
    return res.json({ success: true, isFavorite: true, count: authors.length, authors, author: newAuthor });
  }
});

app.post('/api/favorite-authors/sync', (req, res) => {
  const { authors } = req.body || {};
  if (!Array.isArray(authors)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив авторов' });
  }
  const current = readJsonFile(FAVORITE_AUTHORS_FILE, []);
  const map = new Map();
  current.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  authors.forEach(a => { if (a && a.name) map.set((a.name || '').toLowerCase(), a); });
  const merged = Array.from(map.values());

  writeJsonFileAsync(FAVORITE_AUTHORS_FILE, merged);
  res.json({ success: true, count: merged.length, authors: merged });
});

// Отправка лайка/апвоута на внешние Booru API
async function sendBooruLike(site, postId, isLike, settings) {
  try {
    if (site === 'danbooru' && settings.danbooruLogin && settings.danbooruApiKey) {
      const auth = Buffer.from(`${settings.danbooruLogin}:${settings.danbooruApiKey}`).toString('base64');
      if (isLike) {
        // Добавление в favorites на Danbooru
        await fetch(`https://danbooru.donmai.us/favorites.json?post_id=${encodeURIComponent(postId)}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'User-Agent': BROWSER_USER_AGENT
          }
        }).catch(() => {});
        // Апвоут поста (score=1)
        await fetch(`https://danbooru.donmai.us/posts/${encodeURIComponent(postId)}/votes.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_USER_AGENT
          },
          body: JSON.stringify({ score: 1 })
        }).catch(() => {});
      } else {
        // Удаление из favorites на Danbooru
        await fetch(`https://danbooru.donmai.us/favorites/${encodeURIComponent(postId)}.json`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Basic ${auth}`,
            'User-Agent': BROWSER_USER_AGENT
          }
        }).catch(() => {});
      }
    }
  } catch (err) {
    logError('LikeSync', `Ошибка отправки лайка на ${site}:`, err);
  }
}

// Лайки (Likes & Sync)
app.get('/api/likes', (req, res) => {
  const likes = readJsonFile(LIKES_FILE, []);
  res.json({ success: true, likes });
});

app.post('/api/like', async (req, res) => {
  const post = req.body;
  if (!post || !post.id) return res.status(400).json({ success: false, message: 'Некорректные данные' });

  const likes = readJsonFile(LIKES_FILE, []);
  const existsIndex = likes.findIndex(l => l.id === post.id);
  const settings = getSettings();
  let isLiked = false;

  if (existsIndex >= 0) {
    likes.splice(existsIndex, 1);
    writeJsonFileAsync(LIKES_FILE, likes);
    isLiked = false;
  } else {
    likes.unshift({ ...post, likedAt: new Date().toISOString() });
    writeJsonFileAsync(LIKES_FILE, likes);
    isLiked = true;
  }

  // Фоновая отправка в Booru API
  sendBooruLike(post.site || 'danbooru', post.id, isLiked, settings).catch(() => {});

  return res.json({ success: true, isLiked, count: likes.length });
});

app.post('/api/likes/sync', (req, res) => {
  const { likes } = req.body || {};
  if (!Array.isArray(likes)) {
    return res.status(400).json({ success: false, message: 'Ожидается массив лайков' });
  }
  const current = readJsonFile(LIKES_FILE, []);
  const map = new Map();
  current.forEach(l => { if (l && l.id) map.set(l.id, l); });
  likes.forEach(l => { if (l && l.id) map.set(l.id, l); });
  const merged = Array.from(map.values());

  writeJsonFileAsync(LIKES_FILE, merged);
  res.json({ success: true, count: merged.length, likes: merged });
});

app.delete('/api/favorite-authors/:name', (req, res) => {
  const rawName = (req.params.name || '').trim().replace(/^@/, '').replace(/^pixiv:/i, '').replace(/\s+/g, '_').toLowerCase();
  const authors = readJsonFile(FAVORITE_AUTHORS_FILE, []);
  const filtered = authors.filter(a => (a.name || '').toLowerCase() !== rawName);
  writeJsonFileAsync(FAVORITE_AUTHORS_FILE, filtered);
  res.json({ success: true, count: filtered.length, authors: filtered });
});

function getLocalIpAddress() {
  const nets = os.networkInterfaces();
  const candidates = [];

  const isVirtualOrVpn = (name) => {
    const lower = name.toLowerCase();
    return (
      lower.includes('radmin') ||
      lower.includes('hamachi') ||
      lower.includes('tailscale') ||
      lower.includes('zerotier') ||
      lower.includes('virtualbox') ||
      lower.includes('vmware') ||
      lower.includes('vbox') ||
      lower.includes('vethernet') ||
      lower.includes('hyper-v') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('teredo') ||
      lower.includes('loopback') ||
      lower.includes('tap') ||
      lower.includes('tun') ||
      lower.includes('nordlynx') ||
      lower.includes('wireguard')
    );
  };

  const isPrivateIp = (ip) => {
    if (ip.startsWith('192.168.')) return 3;
    if (ip.startsWith('10.')) return 2;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return 1;
    return 0;
  };

  for (const name of Object.keys(nets)) {
    const isVpn = isVirtualOrVpn(name);
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const priority = isPrivateIp(net.address);
        candidates.push({
          name,
          address: net.address,
          isVpn,
          priority: isVpn ? -1 : priority
        });
      }
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);

  if (candidates.length > 0) {
    return candidates[0].address;
  }
  return 'localhost';
}

function startServer(port) {
  // Туннель
  let tunnelProcess = null;
  let tunnelUrl = '';

  app.get('/api/tunnel', (req, res) => {
    const localIp = getLocalIpAddress();
    const localUrl = `http://${localIp}:${port}`;

    if (req.query.action === 'start' && !tunnelProcess && !tunnelUrl) {
      logInfo('Tunnel', `Запуск Localtunnel для http://localhost:${port}...`);
      try {
        tunnelProcess = spawn(/^win/.test(process.platform) ? 'npx.cmd' : 'npx', ['-y', 'localtunnel', '--port', port.toString()], { shell: true });

        tunnelProcess.stdout.on('data', (data) => {
          const text = data.toString();
          const match = text.match(/your url is: (https:\/\/[a-z0-9-]+\.loca\.lt)/i);
          if (match && !tunnelUrl) {
            tunnelUrl = match[1];
            logInfo('Tunnel', `Туннель запущен: ${tunnelUrl}`);
          }
        });

        tunnelProcess.stderr.on('data', (data) => {
          console.error('[Tunnel Error]', data.toString());
        });

        tunnelProcess.on('close', () => {
          logInfo('Tunnel', 'Туннель закрыт.');
          tunnelProcess = null;
          tunnelUrl = '';
        });
        
        tunnelProcess.on('error', (err) => {
          logError('Tunnel', 'Ошибка туннеля', err);
          tunnelProcess = null;
          tunnelUrl = '';
        });
      } catch (err) {
        logError('Tunnel', 'Сбой запуска туннеля', err);
      }
    }

    res.json({
      success: true,
      localUrl,
      tunnelUrl: tunnelUrl || null,
      isStartingTunnel: !!tunnelProcess && !tunnelUrl
    });
  });

  const srv = app.listen(port, async () => {
    const url = `http://localhost:${port}`;
    console.log(`\n======================================================`);
    console.log(`🚀 Booru Explorer запущен на ${url}`);
    console.log(`✨ Легковесный медиа-клиент с поддержкой видео, тегов и фильтра ИИ`);
    console.log(`======================================================\n`);

    if (!process.argv.includes('--no-open')) {
      try {
        await open(url);
      } catch (err) {
        console.log(`Откройте в браузере: ${url}`);
      }
    }
  });

  srv.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[!] Порт ${port} занят, пробуем порт ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Ошибка запуска сервера:', err);
    }
  });
}

startServer(Number(PORT));

export default app;
