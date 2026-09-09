/**
 * Settings constants, default tag lists, site sort metadata, and proxy normalization helpers.
 */

export function normalizeProxyString(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw.trim();
  if (!clean) return '';
  let proto = 'http';
  const match = clean.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (match) {
    proto = match[1].toLowerCase();
    clean = clean.slice(match[0].length);
  }
  if (clean.includes('@')) return `${proto}://${clean}`;
  const parts = clean.split(':');
  if (parts.length === 4) {
    if (/^\d+$/.test(parts[1]) && !/^\d+$/.test(parts[3])) {
      return `${proto}://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`;
    }
    if (/^\d+$/.test(parts[3]) && !/^\d+$/.test(parts[1])) {
      return `${proto}://${encodeURIComponent(parts[0])}:${encodeURIComponent(parts[1])}@${parts[2]}:${parts[3]}`;
    }
  }
  return `${proto}://${clean}`;
}

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

export const DEFAULT_BLACKLIST = [
  'guro',
  'scat',
  'snuff',
  'vomit',
  'fart'
];

export const DEFAULT_CURVY_TAGS = [
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

export const DEFAULT_PETITE_TAGS = [
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

export const DEFAULT_FURRY_TAGS = [
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
  'feline'
];

export const DEFAULT_PREGNANT_TAGS = [
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

export const DEFAULT_PREGNANCY_TAGS = DEFAULT_PREGNANT_TAGS;

export const DEFAULT_LGBT_TAGS = [
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

export const DEFAULT_SITE_SORT_TAGS = {};

export const SITE_SORT_METADATA = {
  gelbooru: {
    hotPlaceholder: 'score:>5 (по умолчанию)',
    viewsPlaceholder: 'sort:views:desc',
    topPlaceholder: 'sort:score:desc',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'score:>5 (свежие с оценкой)',
    viewsBadge: 'sort:views:desc',
    topBadge: 'sort:score:desc',
    newBadge: 'пусто (хронология)',
    presets: ['score:>5', 'score:>10', 'sort:favcount', 'sort:score', 'sort:commentcount', 'sort:updated']
  },
  danbooru: {
    hotPlaceholder: 'order:rank (по умолчанию)',
    viewsPlaceholder: 'order:views',
    topPlaceholder: 'order:score',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'order:rank (тренды)',
    viewsBadge: 'order:views',
    topBadge: 'order:score',
    newBadge: 'пусто (хронология)',
    presets: ['order:rank', 'order:favcount', 'order:score', 'order:comment_count']
  },
  yandere: {
    hotPlaceholder: 'popular_recent (по умолчанию 1w)',
    viewsPlaceholder: 'order:vote',
    topPlaceholder: 'order:score',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'popular_recent (1 неделя)',
    viewsBadge: 'order:vote',
    topBadge: 'order:score',
    newBadge: 'пусто (хронология)',
    presets: ['order:vote', 'order:score', 'date:>2026-08-01 order:vote']
  },
  konachan: {
    hotPlaceholder: 'popular_recent (по умолчанию 1w)',
    viewsPlaceholder: 'order:vote',
    topPlaceholder: 'order:score',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'popular_recent (1 неделя)',
    viewsBadge: 'order:vote',
    topBadge: 'order:score',
    newBadge: 'пусто (хронология)',
    presets: ['order:vote', 'order:score', 'date:>2026-08-01 order:vote']
  },
  safebooru: {
    hotPlaceholder: 'id:>=recent sort:score:desc',
    viewsPlaceholder: 'sort:views:desc',
    topPlaceholder: 'sort:score:desc',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'свежие ID + sort:score',
    viewsBadge: 'sort:views:desc',
    topBadge: 'sort:score:desc',
    newBadge: 'пусто (хронология)',
    presets: ['score:>5', 'score:>10', 'sort:score:desc']
  },
  rule34: {
    hotPlaceholder: 'score:>=5 (по умолчанию)',
    viewsPlaceholder: 'order:score',
    topPlaceholder: 'order:score',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'score:>=5 (свежие с оценкой)',
    viewsBadge: 'order:score',
    topBadge: 'order:score',
    newBadge: 'пусто (хронология)',
    presets: ['score:>=5', 'score:>=10', 'order:score']
  },
  rule34video: {
    hotPlaceholder: 'sort_by=video_viewed_week',
    viewsPlaceholder: 'sort_by=video_viewed',
    topPlaceholder: 'sort_by=rating',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'sort_by=video_viewed_week',
    viewsBadge: 'sort_by=video_viewed',
    topBadge: 'sort_by=rating',
    newBadge: 'пусто (хронология)',
    presets: ['sort_by=video_viewed_today', 'sort_by=video_viewed_week', 'sort_by=video_viewed_month', 'sort_by=rating_week', 'sort_by=most_popular']
  },
  xbooru: {
    hotPlaceholder: 'id:>=recent sort:score:desc',
    viewsPlaceholder: 'sort:views:desc',
    topPlaceholder: 'sort:score:desc',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'свежие ID + sort:score',
    viewsBadge: 'sort:views:desc',
    topBadge: 'sort:score:desc',
    newBadge: 'пусто (хронология)',
    presets: ['score:>5', 'sort:score:desc']
  },
  hypnohub: {
    hotPlaceholder: 'id:>=recent sort:score:desc',
    viewsPlaceholder: 'sort:views:desc',
    topPlaceholder: 'sort:score:desc',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'свежие ID + sort:score',
    viewsBadge: 'sort:views:desc',
    topBadge: 'sort:score:desc',
    newBadge: 'пусто (хронология)',
    presets: ['score:>5', 'sort:score:desc']
  },
  tbib: {
    hotPlaceholder: 'По умолчанию пусто',
    viewsPlaceholder: 'По умолчанию пусто',
    topPlaceholder: 'По умолчанию пусто',
    newPlaceholder: 'По умолчанию пусто',
    hotBadge: 'авто',
    viewsBadge: 'авто',
    topBadge: 'авто',
    newBadge: 'пусто',
    presets: []
  },
  allgirl: {
    hotPlaceholder: 'По умолчанию глубокая выборка',
    viewsPlaceholder: 'По умолчанию сортировка по score',
    topPlaceholder: 'По умолчанию сортировка по score',
    newPlaceholder: 'По умолчанию хронология',
    hotBadge: 'авто',
    viewsBadge: 'по score',
    topBadge: 'по score',
    newBadge: 'хронология',
    presets: ['score:>10', 'score:>50']
  }
};
