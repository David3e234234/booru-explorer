import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

export const ROOT_DIR = process.cwd();

export const PORT = process.env.PORT || 3000;

// Определение Serverless окружения (Vercel, AWS Lambda)
export const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);

// Директории хранилища и кэша
export const DATA_DIR = isServerless ? path.join(os.tmpdir(), 'booru_data') : path.join(ROOT_DIR, 'data');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const THUMBS_DIR = path.join(CACHE_DIR, 'thumbnails');
export const VIDEOS_DIR = path.join(CACHE_DIR, 'videos');

export const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');
export const FAVORITE_AUTHORS_FILE = path.join(DATA_DIR, 'favorite_authors.json');
export const LIKES_FILE = path.join(DATA_DIR, 'likes.json');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULT_AI_TAGS = [
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

export const FURRY_TAGS = [
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

export const PREGNANT_TAGS = [
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
export const CURVY_INCLUDE_TAGS = [
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

export const CURVY_EXCLUDE_TAGS = [
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

export const PETITE_INCLUDE_TAGS = [
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

export const PETITE_EXCLUDE_TAGS = [
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

export const LGBT_TAGS = [
  'yaoi',
  'gay',
  'bara',
  'males_only',
  'male_only',
  'male_on_male',
  'multiple_males',
  'shounen_ai',
  'boys_love',
  'dansei_shounen_ai',
  'otoko_no_ko',
  'femboy',
  'crossdressing',
  'trap',
  'futanari',
  'dickgirl',
  'futa',
  'shemale',
  'newhalf',
  'transgender',
  'trans_woman',
  'trans_man',
  'gender_bender',
  'genderswap',
  'yuri',
  'lesbian',
  'shoujo_ai',
  'girls_love',
  'lgbt',
  'lgbtq'
];

export const DEFAULT_SETTINGS = {
  theme: 'kotobox',
  gridColumns: 'auto',
  aiFilter: 'no-ai', // 'all', 'no-ai', 'only-ai'
  ratingFilter: 'all', // 'all', 'nsfw', 'sfw'
  typeFilter: 'all', // 'all', 'video', 'image'
  ageFilter: 'all', // 'all', 'adult', 'young'
  hideFurry: true,
  hidePregnant: true,
  hideLgbt: false,
  excludedInterestTags: [],
  showVideoStatusBanner: true,
  aiTags: DEFAULT_AI_TAGS,
  blacklist: ['guro', 'scat', 'snuff', 'vomit', 'fart'],
  curvyTags: CURVY_INCLUDE_TAGS,
  petiteTags: PETITE_INCLUDE_TAGS,
  videoAutoplayHover: true,
  videoAutoplayMobile: true,
  videoAutoplayViewer: true,
  previewQuality: 'medium', // 'low', 'medium', 'high', 'original'
  videoMutedDefault: true,
  itemsPerPage: 100,
  proxyThumbnails: true,
  proxyFullImages: true,
  proxyVideos: true,
  proxyDownloads: true,
  proxyVideoDefault: true,
  enableJsDemuxing: true,
  enablePaheal: true,
  defaultSite: 'danbooru',
  customSources: ['danbooru', 'gelbooru', 'rule34', 'yandere'],
  maxServerCacheMb: 1500,
  rule34ApiKey: '',
  rule34UserId: '',
  gelbooruApiKey: '',
  gelbooruUserId: '',
  danbooruApiKey: '',
  danbooruLogin: '',
  telegramBackupEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramBackupInterval: 'daily', // 'daily', 'every_3_days', 'weekly'
  telegramLastBackupAt: null
};

export const SITES = {
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
    name: 'Rule34',
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

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 BooruExplorer/3.0';
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const BOORU_USER_AGENT = 'BooruExplorer/3.0 (by booruexplorer)';
export const SOUND_KEYWORDS = ['sound', 'audio', 'has_audio', 'with_sound', 'has_sound', 'music', 'voiced', 'voice', 'sound_warning', 'audible'];
