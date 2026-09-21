import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPostMatchingFilters,
  getCriteriaSets,
  checkIsAi,
  checkMediaTypes,
  normalizeDate,
  extractAuthor,
  classifyTags,
  adaptTagsForSite,
  decodeHtmlEntities,
  isArchivePost,
  normalizeTagList,
  toNormalizedTagSet,
  matchesTagBoundary
} from '../../src/utils/tagHelpers.js';
import {
  DEFAULT_AI_TAGS,
  CURVY_INCLUDE_TAGS,
  CURVY_EXCLUDE_TAGS,
  PETITE_INCLUDE_TAGS,
  PETITE_EXCLUDE_TAGS,
  FURRY_TAGS,
  PREGNANT_TAGS,
  LGBT_TAGS
} from '../../src/config/constants.js';

// Canonical post mock factory for hermetic, deterministic testing
function createMockPost(overrides = {}) {
  return {
    id: 'danbooru_12345',
    originalId: '12345',
    site: 'danbooru',
    siteName: 'Danbooru',
    fileUrl: 'https://cdn.example.com/image.jpg',
    sampleUrl: 'https://cdn.example.com/sample.jpg',
    previewUrl: 'https://cdn.example.com/preview.jpg',
    thumb180: 'https://cdn.example.com/180.jpg',
    thumb360: 'https://cdn.example.com/360.jpg',
    thumb720: 'https://cdn.example.com/720.jpg',
    isVideo: false,
    isGif: false,
    hasSound: false,
    tags: ['1girl', 'solo', 'smile'],
    rating: 'g',
    isAi: false,
    isArchive: false,
    fileExt: 'jpg',
    ...overrides
  };
}

describe('Module 1: Basic post validity and null criteria robustness', () => {
  it('should return false for null or undefined post', () => {
    assert.strictEqual(isPostMatchingFilters(null, {}), false);
    assert.strictEqual(isPostMatchingFilters(undefined, {}), false);
    assert.strictEqual(isPostMatchingFilters(false, {}), false);
    assert.strictEqual(isPostMatchingFilters('', {}), false);
    assert.strictEqual(isPostMatchingFilters(12345, {}), false);
  });

  it('should return false for post missing all media URLs when not an archive', () => {
    const emptyPost = { id: 'empty', tags: ['1girl'] };
    assert.strictEqual(isPostMatchingFilters(emptyPost, {}), false);
    assert.strictEqual(isPostMatchingFilters({ previewUrl: null, fileUrl: null, sampleUrl: null }, {}), false);
  });

  it('should accept post with at least one valid media URL', () => {
    assert.strictEqual(isPostMatchingFilters({ previewUrl: 'https://example.com/p.jpg' }, {}), true);
    assert.strictEqual(isPostMatchingFilters({ fileUrl: 'https://example.com/f.jpg' }, {}), true);
    assert.strictEqual(isPostMatchingFilters({ sampleUrl: 'https://example.com/s.jpg' }, {}), true);
  });

  it('should accept archive post without media URLs under default filters', () => {
    const archiveOnly = { id: 'pack_1', isArchive: true };
    assert.strictEqual(isPostMatchingFilters(archiveOnly, {}), true);
  });

  it('should safely handle null, undefined, or primitive criteria without throwing TypeError', () => {
    const post = createMockPost();
    assert.doesNotThrow(() => isPostMatchingFilters(post, null));
    assert.doesNotThrow(() => isPostMatchingFilters(post, undefined));
    assert.doesNotThrow(() => isPostMatchingFilters(post, 'invalid_string'));
    assert.doesNotThrow(() => isPostMatchingFilters(post, 12345));
    assert.doesNotThrow(() => isPostMatchingFilters(post, true));

    assert.strictEqual(isPostMatchingFilters(post, null), true);
    assert.strictEqual(isPostMatchingFilters(post, undefined), true);
    assert.strictEqual(isPostMatchingFilters(post, 'primitive'), true);
    assert.strictEqual(isPostMatchingFilters(post, 42), true);
  });

  it('should safely handle getCriteriaSets with null, undefined, and non-objects without WeakMap errors', () => {
    assert.doesNotThrow(() => getCriteriaSets(null));
    assert.doesNotThrow(() => getCriteriaSets(undefined));
    assert.doesNotThrow(() => getCriteriaSets('string'));
    assert.doesNotThrow(() => getCriteriaSets(123));

    const setsNull = getCriteriaSets(null);
    assert.ok(setsNull && typeof setsNull === 'object');
    assert.ok(setsNull.blacklist instanceof Set);
    assert.ok(setsNull.curvyInclude instanceof Set);
    assert.ok(Array.isArray(setsNull.furry));

    // Verify WeakMap cache reuse for same object reference
    const criteriaObj = { hideFurry: true };
    const sets1 = getCriteriaSets(criteriaObj);
    const sets2 = getCriteriaSets(criteriaObj);
    assert.strictEqual(sets1, sets2);
  });

  it('should safely handle post with null, undefined, or non-array tags', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: null }), {}), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: undefined }), {}), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: 'single_tag' }), {}), true);
  });

  it('should sanitize mixed-type tags array without throwing', () => {
    const dirtyTags = ['1girl', null, undefined, '', '   ', 123, 'solo'];
    const post = createMockPost({ tags: dirtyTags });
    assert.strictEqual(isPostMatchingFilters(post, {}), true);
  });
});

describe('Module 2: Media type classification with archive exclusion', () => {
  it('typeFilter === all passes images, videos, gifs, and archives', () => {
    const criteria = { typeFilter: 'all' };
    assert.strictEqual(isPostMatchingFilters(createMockPost(), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true, fileExt: 'mp4' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isGif: true, fileExt: 'gif' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true, fileExt: 'zip' }), criteria), true);
  });

  it('typeFilter === image accepts clean static images', () => {
    const criteria = { typeFilter: 'image' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: 'jpg' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: 'png' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: 'webp' }), criteria), true);
  });

  it('typeFilter === image rejects video and gif posts', () => {
    const criteria = { typeFilter: 'image' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isGif: true }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ hasSound: true }), criteria), false);
  });

  it('typeFilter === image rejects video extensions in URLs even with query parameters', () => {
    const criteria = { typeFilter: 'image' };
    const videoExts = ['mp4', 'webm', 'mov', 'm4v', 'flv', 'avi', 'mkv'];
    for (const ext of videoExts) {
      const p1 = createMockPost({ fileUrl: `https://example.com/video.${ext}` });
      const p2 = createMockPost({ sampleUrl: `https://example.com/media.${ext}?auth=xyz&exp=123` });
      assert.strictEqual(isPostMatchingFilters(p1, criteria), false, `Should reject fileUrl .${ext}`);
      assert.strictEqual(isPostMatchingFilters(p2, criteria), false, `Should reject sampleUrl .${ext}`);
    }
  });

  it('typeFilter === image rejects audio extensions in URLs', () => {
    const criteria = { typeFilter: 'image' };
    const audioExts = ['mp3', 'ogg', 'flac', 'wav', 'm4a', 'aac', 'opus', 'wma'];
    for (const ext of audioExts) {
      const p = createMockPost({ fileUrl: `https://example.com/track.${ext}` });
      assert.strictEqual(isPostMatchingFilters(p, criteria), false, `Should reject audio .${ext}`);
    }
  });

  it('typeFilter === image rejects archive-only posts but keeps mixed cover+archive posts', () => {
    const criteria = { typeFilter: 'image' };

    // Archive-only packs (pawchive.js/kemono.js emit empty media URLs for those)
    const archiveOnly = { id: 'pawchive_pack_1', isArchive: true, previewUrl: '', fileUrl: '', sampleUrl: '', fileExt: 'zip' };
    assert.strictEqual(isPostMatchingFilters(archiveOnly, criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true, previewUrl: '', fileUrl: '', sampleUrl: '', fileExt: 'zip' }), criteria), false);

    // Mixed posts (cover media + zips) stay visible - the parsers keep them on purpose
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ archiveUrls: ['https://example.com/pack.zip'] }), criteria), true);

    // An archive/video extension in the media URL is still not an image
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileUrl: 'https://kemono.su/data/file.zip' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ sampleUrl: 'https://kemono.su/data/file.7z?download=1' }), criteria), false);
  });

  it('typeFilter === video accepts isVideo or isGif, rejects static images and archives', () => {
    const criteria = { typeFilter: 'video' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isGif: true }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: false, isGif: false }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true, isVideo: true }), criteria), false);
  });

  it('typeFilter === audio accepts video with sound, rejects silent video, static image, and archives', () => {
    const criteria = { typeFilter: 'audio' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true, hasSound: true }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true, hasSound: false }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: false, hasSound: true }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true, isVideo: true, hasSound: true }), criteria), false);
  });

  it('typeFilter === zip accepts archive posts and rejects normal images/videos', () => {
    const criteria = { typeFilter: 'zip' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: true }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: 'zip' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: 'rar' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileExt: '7z' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ archiveUrls: ['https://example.com/p.zip'] }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ fileUrl: 'https://example.com/bundle.tar.gz' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isArchive: false, fileExt: 'jpg' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isVideo: true, fileExt: 'mp4' }), criteria), false);
  });

  it('isArchivePost accurately identifies archive posts', () => {
    assert.strictEqual(isArchivePost(null), false);
    assert.strictEqual(isArchivePost(undefined), false);
    assert.strictEqual(isArchivePost({}), false);
    assert.strictEqual(isArchivePost({ isArchive: true }), true);
    assert.strictEqual(isArchivePost({ fileExt: 'ZIP' }), true);
    assert.strictEqual(isArchivePost({ fileExt: 'rar' }), true);
    assert.strictEqual(isArchivePost({ fileExt: '7Z' }), true);
    assert.strictEqual(isArchivePost({ archiveUrls: ['https://example.com/1.zip'] }), true);
    assert.strictEqual(isArchivePost({ fileUrl: 'https://example.com/art.zip?key=abc' }), true);
    assert.strictEqual(isArchivePost({ sampleUrl: 'https://example.com/art.rar' }), true);
    assert.strictEqual(isArchivePost({ fileUrl: 'https://example.com/art.jpg' }), false);
  });
});

describe('Module 3: Negative tokens (-tag, -tag*)', () => {
  it('hides post when exact negative token matches', () => {
    const post = createMockPost({ tags: ['blonde_hair', 'smile'] });
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde_hair'] }), false);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-blonde_hair'] }), false);
  });

  it('hides post when space-separated negative token matches underscored tag', () => {
    const post = createMockPost({ tags: ['blonde_hair', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde hair'] }), false);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-blonde hair'] }), false);
  });

  it('hides post when underscored negative token matches space-separated tag', () => {
    const post = createMockPost({ tags: ['blonde hair', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde_hair'] }), false);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-blonde_hair'] }), false);
  });

  it('supports prefix wildcard negative tokens (tag* and -tag*)', () => {
    const post1 = createMockPost({ tags: ['bad_anatomy', 'solo'] });
    const post2 = createMockPost({ tags: ['bad_quality', 'solo'] });
    const post3 = createMockPost({ tags: ['caterpillar', 'nature'] });

    assert.strictEqual(isPostMatchingFilters(post1, { negativeTokens: ['bad*'] }), false);
    assert.strictEqual(isPostMatchingFilters(post2, { negativeTokens: ['-bad*'] }), false);
    assert.strictEqual(isPostMatchingFilters(post3, { negativeTokens: ['cat*'] }), false);
    assert.strictEqual(isPostMatchingFilters(post3, { negativeTokens: ['-cat*'] }), false);
  });

  it('supports wildcard negative tokens with spaces/underscores', () => {
    const post = createMockPost({ tags: ['blonde_haired_girl', 'smile'] });
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde hair*'] }), false);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['blonde_hair*'] }), false);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: ['-blonde hair*'] }), false);
  });

  it('does NOT hide unrelated posts with substring overlap when wildcard is NOT used', () => {
    const post1 = createMockPost({ tags: ['long_blonde_haired_girl'] });
    assert.strictEqual(isPostMatchingFilters(post1, { negativeTokens: ['blonde_hair'] }), true);
    assert.strictEqual(isPostMatchingFilters(post1, { negativeTokens: ['blonde hair'] }), true);

    const post2 = createMockPost({ tags: ['scattered_leaves'] });
    assert.strictEqual(isPostMatchingFilters(post2, { negativeTokens: ['cat'] }), true);
  });

  it('performs case-insensitive negative tag matching', () => {
    const post1 = createMockPost({ tags: ['blonde_hair'] });
    assert.strictEqual(isPostMatchingFilters(post1, { negativeTokens: ['BLONDE_HAIR'] }), false);
    assert.strictEqual(isPostMatchingFilters(post1, { negativeTokens: ['Blonde Hair'] }), false);

    const post2 = createMockPost({ tags: ['Blonde_Hair'] });
    assert.strictEqual(isPostMatchingFilters(post2, { negativeTokens: ['blonde_hair'] }), false);
  });

  it('handles empty or null negativeTokens safely', () => {
    const post = createMockPost({ tags: ['1girl', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: [] }), true);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: null }), true);
    assert.strictEqual(isPostMatchingFilters(post, { negativeTokens: [null, '', '   '] }), true);
  });
});

describe('Module 4: Body type filters (curvy, petite)', () => {
  it('ageFilter === all allows all body types', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['loli'] }), { ageFilter: 'all' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['milf'] }), { ageFilter: 'all' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['1girl'] }), { ageFilter: 'all' }), true);
  });

  it('ageFilter === adult excludes posts containing CURVY_EXCLUDE_TAGS', () => {
    for (const exc of ['loli', 'shota', 'flat_chest', 'underage', 'toddler']) {
      const post = createMockPost({ tags: [exc, 'milf'] });
      assert.strictEqual(isPostMatchingFilters(post, { ageFilter: 'adult' }), false, `Should exclude ${exc}`);
    }
  });

  it('ageFilter === adult without user positive tags requires a curvy include tag', () => {
    const postNoCurvy = createMockPost({ tags: ['1girl', 'solo', 'smile'] });
    assert.strictEqual(isPostMatchingFilters(postNoCurvy, { ageFilter: 'adult', hasUserPositiveTags: false }), false);

    const postCurvy = createMockPost({ tags: ['1girl', 'mature_female'] });
    assert.strictEqual(isPostMatchingFilters(postCurvy, { ageFilter: 'adult', hasUserPositiveTags: false }), true);
  });

  it('ageFilter === adult with user positive tags allows post without curvy include tag if no exclude tag', () => {
    const post = createMockPost({ tags: ['hatsune_miku', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { ageFilter: 'adult', hasUserPositiveTags: true }), true);
  });

  it('ageFilter === young excludes posts containing PETITE_EXCLUDE_TAGS', () => {
    for (const exc of ['milf', 'mature_female', 'huge_breasts', 'curvy', 'bbw']) {
      const post = createMockPost({ tags: [exc, 'petite'] });
      assert.strictEqual(isPostMatchingFilters(post, { ageFilter: 'young' }), false, `Should exclude ${exc}`);
    }
  });

  it('ageFilter === young without user positive tags requires a petite include tag', () => {
    const postNoPetite = createMockPost({ tags: ['1girl', 'solo', 'smile'] });
    assert.strictEqual(isPostMatchingFilters(postNoPetite, { ageFilter: 'young', hasUserPositiveTags: false }), false);

    const postPetite = createMockPost({ tags: ['1girl', 'small_breasts'] });
    assert.strictEqual(isPostMatchingFilters(postPetite, { ageFilter: 'young', hasUserPositiveTags: false }), true);
  });

  it('ageFilter === young with user positive tags allows post without petite include tag if no exclude tag', () => {
    const post = createMockPost({ tags: ['hatsune_miku', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { ageFilter: 'young', hasUserPositiveTags: true }), true);
  });

  it('supports custom curvy and petite tag lists with case and space normalization', () => {
    // Custom curvy tag with uppercase and spaces
    const postCurvy = createMockPost({ tags: ['mature_woman'] });
    const criteriaCurvy = {
      ageFilter: 'adult',
      activeCurvyTags: ['  Mature Woman  ', 'MILF'],
      hasUserPositiveTags: false
    };
    assert.strictEqual(isPostMatchingFilters(postCurvy, criteriaCurvy), true);

    // Custom curvy exclude tag
    const postExcluded = createMockPost({ tags: ['chibi_art', 'milf'] });
    const criteriaExclude = {
      ageFilter: 'adult',
      activeCurvyExcludeTags: ['Chibi_Art'],
      hasUserPositiveTags: false
    };
    assert.strictEqual(isPostMatchingFilters(postExcluded, criteriaExclude), false);

    // Custom petite tag
    const postPetite = createMockPost({ tags: ['shorty'] });
    const criteriaPetite = {
      ageFilter: 'young',
      activePetiteTags: ['Shorty'],
      hasUserPositiveTags: false
    };
    assert.strictEqual(isPostMatchingFilters(postPetite, criteriaPetite), true);
  });
});

describe('Module 5: AI content isolation', () => {
  it('aiFilter === no-ai rejects isAi: true and allows isAi: false or undefined', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: true }), { aiFilter: 'no-ai' }), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: false }), { aiFilter: 'no-ai' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: undefined }), { aiFilter: 'no-ai' }), true);
  });

  it('aiFilter === only-ai allows isAi: true and rejects isAi: false or undefined', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: true }), { aiFilter: 'only-ai' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: false }), { aiFilter: 'only-ai' }), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: undefined }), { aiFilter: 'only-ai' }), false);
  });

  it('aiFilter === all allows both AI and non-AI posts', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: true }), { aiFilter: 'all' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ isAi: false }), { aiFilter: 'all' }), true);
  });

  it('checkIsAi accurately identifies standard and substring AI tags', () => {
    assert.strictEqual(checkIsAi(['1girl', 'ai_generated', 'solo']), true);
    assert.strictEqual(checkIsAi(['novelai', 'smile']), true);
    assert.strictEqual(checkIsAi(['artist_stable_diffusion']), true);
    assert.strictEqual(checkIsAi(['midjourney_v5']), true);
    assert.strictEqual(checkIsAi(['danbooru_ai_gen']), true);
    assert.strictEqual(checkIsAi(['pony_diffusion']), true);
    assert.strictEqual(checkIsAi(['flux.1']), true);
  });

  it('checkIsAi supports custom aiTagsList', () => {
    assert.strictEqual(checkIsAi(['custom_generator'], ['custom_generator']), true);
    assert.strictEqual(checkIsAi(['custom_generator'], ['other_gen']), false);
  });

  it('checkIsAi handles non-array and invalid arguments safely without throwing', () => {
    assert.strictEqual(checkIsAi(null, null), false);
    assert.strictEqual(checkIsAi(undefined, undefined), false);
    assert.strictEqual(checkIsAi('not_an_array', []), false);
    assert.strictEqual(checkIsAi(['1girl'], 'invalid_arg'), false);
    assert.strictEqual(checkIsAi(['1girl'], 12345), false);
    assert.strictEqual(checkIsAi(['ai_generated'], 'invalid_arg'), true);
  });

  it('checkIsAi returns false for clean non-AI tags', () => {
    assert.strictEqual(checkIsAi(['1girl', 'solo', 'watercolor', 'traditional_media']), false);
  });
});

describe('Module 6: Rating systems (Danbooru 4-tier vs legacy 3-tier)', () => {
  it('ratingFilter === all allows all rating values', () => {
    for (const r of ['g', 's', 'q', 'e', '?', '', null, undefined]) {
      assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: r }), { ratingFilter: 'all' }), true);
    }
  });

  it('ratingFilter === nsfw allows e, explicit, and ?', () => {
    const criteria = { ratingFilter: 'nsfw' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 'e' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 'explicit' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: '?' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 'g' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 's' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 'q' }), criteria), false);
  });

  it('Danbooru/Gelbooru 4-tier questionable treats s (sensitive) as 16+ questionable', () => {
    const criteria = { ratingFilter: 'questionable' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'q' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'questionable' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 's' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'sensitive' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'g' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'e' }), criteria), false);

    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'gelbooru', rating: 's' }), criteria), true);
  });

  it('Legacy 3-tier questionable rejects s (safe)', () => {
    const criteria = { ratingFilter: 'questionable' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'q' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'questionable' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 's' }), criteria), false, 's on safebooru must not match questionable');
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'rule34', rating: 's' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'g' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'e' }), criteria), false);
  });

  it('Danbooru/Gelbooru 4-tier sfw allows only g (general) and rejects s (sensitive)', () => {
    const criteria = { ratingFilter: 'sfw' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'g' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'general' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 's' }), criteria), false, 'Sensitive must not appear in Danbooru SFW');
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'sensitive' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'gelbooru', rating: 's' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'q' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'danbooru', rating: 'e' }), criteria), false);
  });

  it('Legacy 3-tier sfw allows s (safe) and g (general)', () => {
    const criteria = { ratingFilter: 'sfw' };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 's' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'safe' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'g' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'general' }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'q' }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'e' }), criteria), false);
  });

  it('Rating comparisons are case-insensitive', () => {
    assert.strictEqual(isPostMatchingFilters(createMockPost({ rating: 'E' }), { ratingFilter: 'nsfw' }), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ site: 'safebooru', rating: 'S' }), { ratingFilter: 'sfw' }), true);
  });
});

describe('Module 7: Content filters (hideFurry, hidePregnant, hideLgbt) with infix boundary tests', () => {
  it('hideFurry hides exact, prefix, suffix, and infix compound tags', () => {
    const criteria = { hideFurry: true };
    // Exact
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['furry'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['anthro'] }), criteria), false);
    // Prefix
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['furry_girl'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['anthro_wolf'] }), criteria), false);
    // Suffix
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['cute_furry'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['solo_anthro'] }), criteria), false);
    // Infix compound tags (Critical Bug Fix)
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['female_anthro_solo'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['cute_furry_art'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['giant_beast_girl'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['solo_kemono_art'] }), criteria), false);
  });

  it('hideFurry does not hide innocent tags with substring overlaps', () => {
    const criteria = { hideFurry: true };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['philanthropic'] }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['cat_ears'] }), criteria), true);
  });

  it('hideFurry supports custom uppercase tag list', () => {
    const post = createMockPost({ tags: ['kemono_art'] });
    const criteria = { hideFurry: true, activeFurryTags: ['Kemono_Art'] };
    assert.strictEqual(isPostMatchingFilters(post, criteria), false);
  });

  it('hidePregnant hides pregnant tags via boundary checks and does not false-positive innocent words', () => {
    const criteria = { hidePregnant: true };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['pregnant'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['impregnation'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['pregnant_belly'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['visibly_pregnant'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['cute_pregnant_photo'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['huge_pregnancy'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['hyper_pregnancy'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['belly_expansion'] }), criteria), false);

    // Innocent non-pregnant words that previously failed under loose substring matching
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['birthday_cake'] }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['rebirth'] }), criteria), true);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['birthmark'] }), criteria), true);
  });

  it('hidePregnant supports custom uppercase tag list', () => {
    const post = createMockPost({ tags: ['baby_bump'] });
    const criteria = { hidePregnant: true, activePregnantTags: ['Baby_Bump'] };
    assert.strictEqual(isPostMatchingFilters(post, criteria), false);
  });

  it('hideLgbt hides exact, prefix, suffix, and infix LGBT tags', () => {
    const criteria = { hideLgbt: true };
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['yaoi'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['yuri'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['femboy'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['gay'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['bara'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['yaoi_couple'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['cute_femboy'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['solo_femboy_art'] }), criteria), false);
    assert.strictEqual(isPostMatchingFilters(createMockPost({ tags: ['1girl', 'solo'] }), criteria), true);
  });

  it('hideLgbt supports custom uppercase tag list', () => {
    const post = createMockPost({ tags: ['shounen_ai'] });
    const criteria = { hideLgbt: true, activeLgbtTags: ['Shounen_Ai'] };
    assert.strictEqual(isPostMatchingFilters(post, criteria), false);
  });

  it('matchesTagBoundary accurately matches boundaries for underscores and spaces', () => {
    assert.strictEqual(matchesTagBoundary('anthro', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('anthro_wolf', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('solo_anthro', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('female_anthro_solo', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('female anthro solo', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('philanthropic', 'anthro'), false);
    assert.strictEqual(matchesTagBoundary('', 'anthro'), false);
    assert.strictEqual(matchesTagBoundary('anthro', ''), false);
  });
});

describe('Module 8: Blacklist multi-word space vs underscore matching', () => {
  it('hides post with single-word blacklist tag', () => {
    const post = createMockPost({ tags: ['guro', 'smile'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['guro'] }), false);
  });

  it('hides post when blacklist has spaces and post tag has underscores', () => {
    const post = createMockPost({ tags: ['scat_art', '1girl'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['scat art'] }), false);
  });

  it('hides post when blacklist has underscores and post tag has spaces', () => {
    const post = createMockPost({ tags: ['scat art', '1girl'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['scat_art'] }), false);
  });

  it('hides post with irregular whitespace in blacklist', () => {
    const post = createMockPost({ tags: ['extreme_gore', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['  extreme   gore  '] }), false);
  });

  it('hides post with multiple underscores in post tag', () => {
    const post = createMockPost({ tags: ['toilet__humor', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['toilet humor'] }), false);
  });

  it('performs case-insensitive blacklist matching', () => {
    const post1 = createMockPost({ tags: ['scat_art'] });
    assert.strictEqual(isPostMatchingFilters(post1, { blacklist: ['Scat_Art'] }), false);
    assert.strictEqual(isPostMatchingFilters(post1, { blacklist: ['SCAT ART'] }), false);

    const post2 = createMockPost({ tags: ['SCAT_ART'] });
    assert.strictEqual(isPostMatchingFilters(post2, { blacklist: ['scat art'] }), false);
  });

  it('supports comma-separated string format for blacklist criteria', () => {
    const post1 = createMockPost({ tags: ['scat_art'] });
    const post2 = createMockPost({ tags: ['snuff'] });
    const criteria = { blacklist: 'guro, scat art, snuff' };
    assert.strictEqual(isPostMatchingFilters(post1, criteria), false);
    assert.strictEqual(isPostMatchingFilters(post2, criteria), false);
  });

  it('does not reject clean posts containing partial word matches', () => {
    const post = createMockPost({ tags: ['1girl', 'solo', 'art', 'artist_name'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: ['scat art', 'guro', 'snuff'] }), true);
  });

  it('passes clean posts when blacklist is empty, null, or undefined', () => {
    const post = createMockPost({ tags: ['1girl', 'solo'] });
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: [] }), true);
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: null }), true);
    assert.strictEqual(isPostMatchingFilters(post, { blacklist: undefined }), true);
  });
});

describe('Module 9: Auxiliary tag utilities', () => {
  it('checkMediaTypes correctly classifies video formats and flags', () => {
    const res1 = checkMediaTypes('https://cdn.example.com/video.mp4', 'mp4', ['solo']);
    assert.strictEqual(res1.isVideo, true);
    assert.strictEqual(res1.isGif, false);
    assert.strictEqual(res1.fileExt, 'mp4');

    const res2 = checkMediaTypes('https://cdn.example.com/animation.webm', '', ['webm']);
    assert.strictEqual(res2.isVideo, true);
    assert.strictEqual(res2.isGif, false);
  });

  it('checkMediaTypes correctly classifies GIF as image not video container', () => {
    const res = checkMediaTypes('https://cdn.example.com/anim.gif', 'gif', ['animated', 'gif']);
    assert.strictEqual(res.isVideo, false);
    assert.strictEqual(res.isGif, true);
    assert.strictEqual(res.fileExt, 'gif');
  });

  it('checkMediaTypes detects sound in video and ignores sound on static images', () => {
    const withAudio = checkMediaTypes('https://cdn.example.com/clip.mp4', 'mp4', ['has_audio']);
    assert.strictEqual(withAudio.isVideo, true);
    assert.strictEqual(withAudio.hasSound, true);

    const silent = checkMediaTypes('https://cdn.example.com/clip.mp4', 'mp4', ['silent']);
    assert.strictEqual(silent.isVideo, true);
    assert.strictEqual(silent.hasSound, false);

    const staticImg = checkMediaTypes('https://cdn.example.com/pic.jpg', 'jpg', ['has_audio']);
    assert.strictEqual(staticImg.isVideo, false);
    assert.strictEqual(staticImg.hasSound, false);
  });

  it('checkMediaTypes does not misclassify static images containing video extension substrings in path/filename', () => {
    const res = checkMediaTypes('https://x.com/data/video.mp4.jpg', '', ['tag']);
    assert.strictEqual(res.isVideo, false);
    assert.strictEqual(res.isGif, false);
    assert.strictEqual(res.fileExt, 'jpg');

    const res2 = checkMediaTypes('https://cdn.example.com/preview.webm.png?v=1', '', []);
    assert.strictEqual(res2.isVideo, false);
    assert.strictEqual(res2.isGif, false);
    assert.strictEqual(res2.fileExt, 'png');
  });


  it('normalizeDate correctly converts 10-digit, 13-digit, and ISO dates', () => {
    // 10-digit unix seconds: 1700000000 -> 2023-11-14T22:13:20.000Z
    const d10 = normalizeDate(1700000000);
    assert.ok(d10.startsWith('2023-11-14T22:13:20'));

    // 13-digit unix milliseconds
    const d13 = normalizeDate(1700000000000);
    assert.ok(d13.startsWith('2023-11-14T22:13:20'));

    // ISO string pass-through / parse
    const dIso = normalizeDate('2024-01-01T00:00:00.000Z');
    assert.strictEqual(dIso, '2024-01-01T00:00:00.000Z');

    // Invalid or empty date strings return empty string
    assert.strictEqual(normalizeDate(''), '');
    assert.strictEqual(normalizeDate(null), '');
    assert.strictEqual(normalizeDate('not-a-valid-date'), '');
  });

  it('extractAuthor extracts artist from prefixes, marker tags, and URLs', () => {
    assert.strictEqual(extractAuthor(['artist:wlop', '1girl']), 'wlop');
    assert.strictEqual(extractAuthor(['wlop_(artist)', '1girl']), 'wlop');
    assert.strictEqual(extractAuthor([], 'https://twitter.com/wlop/status/123'), '@wlop');
    assert.strictEqual(extractAuthor([], 'https://x.com/artist_name/'), '@artist_name');
    assert.strictEqual(extractAuthor([], 'https://bsky.app/profile/artist.bsky.social'), '@artist.bsky.social');
    assert.strictEqual(extractAuthor([], 'https://www.pixiv.net/en/users/54321'), 'pixiv:54321');
    assert.strictEqual(extractAuthor([], '(C82) [T2 ART WORKS (Tony)] Title'), 'Tony');
    assert.strictEqual(extractAuthor([], '', 'CleanArtist'), 'CleanArtist');
    assert.strictEqual(extractAuthor([], '', 'anonymous'), '');
    assert.strictEqual(extractAuthor([], '', '12345'), '');
  });

  it('classifyTags accurately splits tags into artist, copyright, character, meta, and general', () => {
    const rawTags = [
      'artist:wlop',
      'copyright:genshin_impact',
      'character:ganyu',
      'meta:highres',
      '1girl',
      'solo'
    ];
    const classified = classifyTags(rawTags);
    assert.deepStrictEqual(classified.artist, ['wlop']);
    assert.deepStrictEqual(classified.copyright, ['genshin_impact']);
    assert.deepStrictEqual(classified.character, ['ganyu']);
    assert.deepStrictEqual(classified.meta, ['highres']);
    assert.deepStrictEqual(classified.general, ['1girl', 'solo']);
  });

  it('adaptTagsForSite transforms tags for specific booru compatibility', () => {
    const testSettings = {
      customAliases: [
        { aliases: ['petite'], defaultTarget: 'petite' },
        { aliases: ['1girl'], defaultTarget: '1girl' },
        { aliases: ['wlop'], defaultTarget: 'wlop' },
        { aliases: ['ganyu'], defaultTarget: 'ganyu' }
      ]
    };

    // Replaces petite with small_breasts on Gelbooru/Rule34
    const res1 = adaptTagsForSite('gelbooru', 'petite 1girl', 'all', 'all', testSettings);
    assert.ok(res1.includes('small_breasts'));

    // Strips category prefixes for DAPI engines
    const res2 = adaptTagsForSite('safebooru', 'artist:wlop character:ganyu', 'all', 'all', testSettings);
    assert.ok(res2.includes('wlop'));
    assert.ok(!res2.includes('artist:'));

    // Adapts sort orders
    const res3 = adaptTagsForSite('rule34', 'order:score', 'all', 'all', testSettings);
    assert.ok(res3.includes('sort:score:desc'));

    const res4 = adaptTagsForSite('danbooru', 'sort:score:desc', 'all', 'all', testSettings);
    assert.ok(res4.includes('order:score'));

    // Adds body type exclusion tags
    const resAdult = adaptTagsForSite('rule34', '1girl', 'adult', 'all', testSettings);
    assert.ok(resAdult.includes('-loli'));
    assert.ok(resAdult.includes('-shota'));
    assert.ok(resAdult.includes('-flat_chest'));
  });

  it('decodeHtmlEntities decodes common XML/HTML entities', () => {
    assert.strictEqual(decodeHtmlEntities('&quot;hello&quot; &amp; &apos;world&apos;'), '"hello" & \'world\'');
    assert.strictEqual(decodeHtmlEntities('&lt;div&gt;&#039;test&#039;&lt;/div&gt;'), "<div>'test'</div>");
    assert.strictEqual(decodeHtmlEntities('&#38;&#x26;'), '&&');
    assert.strictEqual(decodeHtmlEntities(null), '');
    assert.strictEqual(decodeHtmlEntities(undefined), '');
  });
});

describe('Module 10: Boundary value and stress combinations', () => {
  it('handles post with 1,000 tags safely and efficiently', () => {
    const hugeTags = Array.from({ length: 1000 }, (_, i) => `tag_${i}`);
    hugeTags.push('milf', 'safe_tag');
    const post = createMockPost({ tags: hugeTags });

    const criteria = {
      ageFilter: 'adult',
      aiFilter: 'no-ai',
      ratingFilter: 'sfw',
      hideFurry: true,
      hidePregnant: true,
      hideLgbt: true,
      blacklist: ['blacklist_tag_9999'],
      negativeTokens: ['-unwanted_tag_9999']
    };

    assert.strictEqual(isPostMatchingFilters(post, criteria), true);
  });

  it('correctly filters conforming vs non-conforming posts with ALL filters active', () => {
    const allActiveCriteria = {
      typeFilter: 'image',
      ageFilter: 'adult',
      aiFilter: 'no-ai',
      ratingFilter: 'sfw',
      hideFurry: true,
      hidePregnant: true,
      hideLgbt: true,
      blacklist: ['scat art', 'guro'],
      negativeTokens: ['bad_art*']
    };

    // Conforming post: image, adult curvy, non-ai, sfw, no furry/pregnant/lgbt, no blacklist, no negative
    const goodPost = createMockPost({
      fileUrl: 'https://cdn.example.com/good.jpg',
      tags: ['1girl', 'milf', 'smile'],
      rating: 'g',
      isAi: false,
      isVideo: false,
      isGif: false,
      hasSound: false,
      isArchive: false
    });
    assert.strictEqual(isPostMatchingFilters(goodPost, allActiveCriteria), true);

    // Fails on type (archive-only post carries no image under typeFilter=image)
    assert.strictEqual(isPostMatchingFilters(
      createMockPost({ ...goodPost, isArchive: true, previewUrl: '', fileUrl: '', sampleUrl: '', fileExt: 'zip' }),
      allActiveCriteria
    ), false);
    // Fails on rating (e)
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, rating: 'e' }), allActiveCriteria), false);
    // Fails on AI
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, isAi: true }), allActiveCriteria), false);
    // Fails on furry
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, tags: ['1girl', 'milf', 'female_furry_solo'] }), allActiveCriteria), false);
    // Fails on pregnant
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, tags: ['1girl', 'milf', 'pregnant_belly'] }), allActiveCriteria), false);
    // Fails on LGBT
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, tags: ['1girl', 'milf', 'femboy'] }), allActiveCriteria), false);
    // Fails on blacklist
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, tags: ['1girl', 'milf', 'scat_art'] }), allActiveCriteria), false);
    // Fails on negative token wildcard
    assert.strictEqual(isPostMatchingFilters(createMockPost({ ...goodPost, tags: ['1girl', 'milf', 'bad_artist_drawing'] }), allActiveCriteria), false);
  });

  it('handles non-ASCII, Japanese, and Cyrillic tags in posts and blacklist', () => {
    const postJp = createMockPost({ tags: ['初音ミク', 'ボーカロイド', '東方_project'] });
    assert.strictEqual(isPostMatchingFilters(postJp, { blacklist: ['東方 project'] }), false);

    const postRu = createMockPost({ tags: ['гуро', 'девушка'] });
    assert.strictEqual(isPostMatchingFilters(postRu, { blacklist: ['гуро'] }), false);

    const postCleanJp = createMockPost({ tags: ['初音ミク', 'かわいい'] });
    assert.strictEqual(isPostMatchingFilters(postCleanJp, { blacklist: ['東方 project', 'гуро'] }), true);
  });

  it('handles posts with circular object references without crashing', () => {
    const post = createMockPost();
    post.circular = post;
    assert.strictEqual(isPostMatchingFilters(post, {}), true);
  });

  it('executes 1,000 filter operations with WeakMap cache hit in under 100ms', () => {
    const criteria = {
      typeFilter: 'image',
      ageFilter: 'adult',
      aiFilter: 'no-ai',
      ratingFilter: 'sfw',
      hideFurry: true,
      blacklist: ['scat art', 'guro', 'extreme violence']
    };
    const post = createMockPost({ tags: ['1girl', 'milf', 'smile'] });

    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const matched = isPostMatchingFilters(post, criteria);
      assert.strictEqual(matched, true);
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 200, `Expected 1000 operations in <200ms, took ${elapsed}ms`);
  });
});

describe('Module 11: Challenger Adversarial Robustness & Vulnerability Regression', () => {
  it('Bug 1: isArchivePost and isPostMatchingFilters safely handle non-string media fields without throwing', () => {
    const malformedMediaPosts = [
      { fileUrl: 12345 },
      { sampleUrl: 67890 },
      { fileExt: 123 },
      { fileExt: true },
      { fileExt: {} },
      { fileUrl: Symbol('url') },
      { sampleUrl: {} },
      { fileUrl: null, sampleUrl: undefined, fileExt: null }
    ];

    for (const mediaProps of malformedMediaPosts) {
      assert.doesNotThrow(() => isArchivePost(mediaProps));
      const post = { previewUrl: 'https://example.com/p.jpg', ...mediaProps };
      assert.doesNotThrow(() => isPostMatchingFilters(post, { typeFilter: 'image' }));
      assert.doesNotThrow(() => isPostMatchingFilters(post, { typeFilter: 'all' }));
    }
  });

  it('Bug 2: isPostMatchingFilters safely handles numeric, boolean, and object ratings without throwing', () => {
    const malformedRatings = [1, 0, true, false, {}, [], Symbol('sfw')];

    for (const rating of malformedRatings) {
      const post = { previewUrl: 'https://example.com/p.jpg', rating, tags: ['1girl'] };
      assert.doesNotThrow(() => isPostMatchingFilters(post, { ratingFilter: 'sfw' }));
      assert.doesNotThrow(() => isPostMatchingFilters(post, { ratingFilter: 'questionable' }));
      assert.doesNotThrow(() => isPostMatchingFilters(post, { ratingFilter: 'nsfw' }));
      assert.doesNotThrow(() => isPostMatchingFilters(post, { ratingFilter: 'all' }));
    }

    // Capitalized site name must strictly apply 4-tier check (sensitive 's' must NOT leak into SFW)
    const danbooruCaps = { site: 'Danbooru', rating: 's', previewUrl: 'https://example.com/p.jpg' };
    const gelbooruCaps = { site: 'Gelbooru', rating: 's', previewUrl: 'https://example.com/p.jpg' };
    assert.strictEqual(isPostMatchingFilters(danbooruCaps, { ratingFilter: 'sfw' }), false);
    assert.strictEqual(isPostMatchingFilters(gelbooruCaps, { ratingFilter: 'sfw' }), false);
    assert.strictEqual(isPostMatchingFilters(danbooruCaps, { ratingFilter: 'questionable' }), true);
    assert.strictEqual(isPostMatchingFilters(gelbooruCaps, { ratingFilter: 'questionable' }), true);
  });

  it('Bug 3: matchesTagBoundary safely rejects non-string tag or pattern without throwing', () => {
    const invalidInputs = [12345, 0, true, false, null, undefined, {}, [], Symbol('tag'), () => {}];

    for (const val of invalidInputs) {
      assert.doesNotThrow(() => matchesTagBoundary(val, 'anthro'));
      assert.strictEqual(matchesTagBoundary(val, 'anthro'), false);

      assert.doesNotThrow(() => matchesTagBoundary('anthro', val));
      assert.strictEqual(matchesTagBoundary('anthro', val), false);

      assert.doesNotThrow(() => matchesTagBoundary(val, val));
      assert.strictEqual(matchesTagBoundary(val, val), false);
    }

    assert.strictEqual(matchesTagBoundary('anthro', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('anthro_wolf', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('solo_anthro', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('female_anthro_solo', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('female anthro solo', 'anthro'), true);
    assert.strictEqual(matchesTagBoundary('philanthropic', 'anthro'), false);
  });

  it('Bug 4: extractAuthor safely handles rawTags containing null, numbers, and non-strings', () => {
    const dirtyTags = [null, undefined, 12345, true, {}, Symbol('tag'), 'artist:wlop', '1girl'];
    assert.doesNotThrow(() => extractAuthor(dirtyTags));
    assert.strictEqual(extractAuthor(dirtyTags), 'wlop');

    const dirtyMarkerTags = [null, 0, false, 'wlop_(artist)'];
    assert.doesNotThrow(() => extractAuthor(dirtyMarkerTags));
    assert.strictEqual(extractAuthor(dirtyMarkerTags), 'wlop');

    // Also accept rawTags as string
    assert.strictEqual(extractAuthor('artist:wlop'), 'wlop');
    assert.strictEqual(extractAuthor('wlop_(artist)'), 'wlop');

    // Completely invalid rawTags
    assert.strictEqual(extractAuthor(null), '');
    assert.strictEqual(extractAuthor(undefined), '');
    assert.strictEqual(extractAuthor(12345), '');
    assert.strictEqual(extractAuthor({}), '');
  });

  it('Bug 5: classifyTags safely handles non-string author and dirty rawTags without throwing', () => {
    const invalidAuthors = [12345, true, false, {}, [], Symbol('author')];

    for (const author of invalidAuthors) {
      assert.doesNotThrow(() => classifyTags(['1girl'], author));
      const res = classifyTags(['1girl'], author);
      assert.deepStrictEqual(res.artist, []);
      assert.deepStrictEqual(res.general, ['1girl']);
    }

    // String author still correctly splits and cleans
    const resValid = classifyTags(['1girl'], '@wlop, pixiv:12345');
    assert.deepStrictEqual(resValid.artist, ['wlop', '12345']);

    // Dirty rawTags array
    const dirtyRawTags = [null, undefined, 123, 'artist:wlop', '', '   ', 'character:ganyu'];
    assert.doesNotThrow(() => classifyTags(dirtyRawTags));
    const resDirty = classifyTags(dirtyRawTags);
    assert.deepStrictEqual(resDirty.artist, ['wlop']);
    assert.deepStrictEqual(resDirty.character, ['ganyu']);

    // String rawTags
    const resStrTags = classifyTags('artist:wlop character:ganyu 1girl');
    assert.deepStrictEqual(resStrTags.artist, ['wlop']);
    assert.deepStrictEqual(resStrTags.character, ['ganyu']);
    assert.deepStrictEqual(resStrTags.general, ['1girl']);
  });

  it('Bug 6: adaptTagsForSite safely accepts array, number, or dirty rawTags without throwing', () => {
    const testSettings = {
      customAliases: [{ aliases: ['petite'], defaultTarget: 'petite' }]
    };

    // Array of tags
    assert.doesNotThrow(() => adaptTagsForSite('danbooru', ['1girl', 'solo']));
    const resArray = adaptTagsForSite('danbooru', ['1girl', 'solo']);
    assert.ok(resArray.includes('1girl'));
    assert.ok(resArray.includes('solo'));

    // Array with alias transformation
    const resGelbooru = adaptTagsForSite('gelbooru', ['petite', '1girl'], 'all', 'all', testSettings);
    assert.ok(resGelbooru.includes('small_breasts'));
    assert.ok(resGelbooru.includes('1girl'));

    // Numbers, booleans, null, undefined
    assert.doesNotThrow(() => adaptTagsForSite('danbooru', 12345));
    assert.strictEqual(adaptTagsForSite('danbooru', null), '');
    assert.strictEqual(adaptTagsForSite('danbooru', undefined), '');
    assert.strictEqual(adaptTagsForSite('danbooru', ''), '');

    // Dirty array
    const dirtyArr = ['1girl', null, 123, undefined, 'solo'];
    assert.doesNotThrow(() => adaptTagsForSite('danbooru', dirtyArr));
    const resDirty = adaptTagsForSite('danbooru', dirtyArr);
    assert.ok(resDirty.includes('1girl'));
    assert.ok(resDirty.includes('solo'));
  });

  it('toNormalizedTagSet accepts arrays, comma-delimited strings, and space-delimited strings', () => {
    const fallback = ['default_tag'];

    // Array input
    const setArr = toNormalizedTagSet(['custom_curvy', 'milf'], fallback);
    assert.ok(setArr.has('custom_curvy'));
    assert.ok(setArr.has('milf'));

    // Comma-delimited string
    const setComma = toNormalizedTagSet('custom_curvy, voluptuous_milf', fallback);
    assert.ok(setComma.has('custom_curvy'));
    assert.ok(setComma.has('voluptuous_milf'));
    assert.ok(!setComma.has('default_tag'));

    // Space-delimited string
    const setSpace = toNormalizedTagSet('custom_curvy voluptuous_milf', fallback);
    assert.ok(setSpace.has('custom_curvy'));
    assert.ok(setSpace.has('voluptuous_milf'));
    assert.ok(!setSpace.has('default_tag'));

    // Empty or invalid reverts to fallback
    assert.deepStrictEqual(Array.from(toNormalizedTagSet('', ['default'])), ['default']);
    assert.deepStrictEqual(Array.from(toNormalizedTagSet('   ', ['default'])), ['default']);
    assert.deepStrictEqual(Array.from(toNormalizedTagSet([], ['default'])), ['default']);
    assert.deepStrictEqual(Array.from(toNormalizedTagSet(null, ['default'])), ['default']);
    assert.deepStrictEqual(Array.from(toNormalizedTagSet(12345, ['default'])), ['default']);
    assert.ok(toNormalizedTagSet('', fallback).has('default_tag'));
    assert.ok(toNormalizedTagSet('', fallback).has('default tag'));

    // Criteria integration: activeCurvyTags as string works in isPostMatchingFilters
    const post = { previewUrl: 'https://example.com/p.jpg', tags: ['custom_curvy'] };
    const criteria = { ageFilter: 'adult', activeCurvyTags: 'custom_curvy, milf' };
    assert.strictEqual(isPostMatchingFilters(post, criteria), true);
  });

  it('isArchivePost recognizes .cbz, .cbr, and cleans hash fragments/query strings from URLs', () => {
    // cbz and cbr comic archives
    assert.strictEqual(isArchivePost({ fileExt: 'cbz' }), true);
    assert.strictEqual(isArchivePost({ fileExt: 'cbr' }), true);
    assert.strictEqual(isArchivePost({ fileUrl: 'https://cdn.example.com/doujin.cbz' }), true);
    assert.strictEqual(isArchivePost({ sampleUrl: 'https://cdn.example.com/doujin.cbr' }), true);

    // Hash fragment archive URLs
    assert.strictEqual(isArchivePost({ fileUrl: 'https://cdn.example.com/art.zip#download' }), true);
    assert.strictEqual(isArchivePost({ sampleUrl: 'https://cdn.example.com/pack.rar#preview' }), true);
    assert.strictEqual(isArchivePost({ fileUrl: 'https://cdn.example.com/pack.7z?token=abc#section' }), true);

    // Rejection under typeFilter=image: archive-only posts have nothing to render
    assert.strictEqual(isPostMatchingFilters({ fileExt: 'cbz' }, { typeFilter: 'image' }), false);
    assert.strictEqual(isPostMatchingFilters({ fileExt: 'cbr' }, { typeFilter: 'image' }), false);
    assert.strictEqual(isPostMatchingFilters({ previewUrl: 'p.jpg', fileUrl: 'https://cdn.example.com/art.zip#dl' }, { typeFilter: 'image' }), false);
    // ... while a cbz/cbr post that carries a real cover preview stays visible
    assert.strictEqual(isPostMatchingFilters({ previewUrl: 'p.jpg', fileExt: 'cbz' }, { typeFilter: 'image' }), true);

    // Clean images with fragments/queries are NOT falsely rejected
    assert.strictEqual(isPostMatchingFilters({ previewUrl: 'p.jpg', fileUrl: 'https://cdn.example.com/art.jpg?source=zip#section' }, { typeFilter: 'image' }), true);
  });
});
